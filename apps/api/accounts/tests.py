import base64
import hashlib
import json
import re
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

from django.contrib.auth import get_user_model
from django.core import mail, signing
from django.test import Client, TestCase, override_settings

from integrations.models import GoogleCalendarConnection

from .api import GOOGLE_AUTH_STATE_SALT
from .models import EmailVerificationCode
from .tokens import authenticate_access_token, issue_access_token


class AccountNameTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.user_model = get_user_model()
        self.user = self.user_model.objects.create_user(
            username="old-id",
            email="account@example.com",
            password="test-password-123",
            first_name="Old nickname",
        )
        self.authorization = f"Bearer {issue_access_token(self.user)}"

    def test_profile_name_change_also_changes_login_id(self):
        response = self.client.patch(
            "/api/auth/me",
            data=json.dumps({"displayName": "new-id"}),
            content_type="application/json",
            HTTP_AUTHORIZATION=self.authorization,
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["username"], "new-id")
        self.assertEqual(response.json()["displayName"], "new-id")

        self.user.refresh_from_db()
        self.assertEqual(self.user.username, "new-id")
        self.assertEqual(self.user.first_name, "new-id")

        old_login = self.client.post(
            "/api/auth/login",
            data=json.dumps({"identifier": "old-id", "password": "test-password-123"}),
            content_type="application/json",
        )
        new_login = self.client.post(
            "/api/auth/login",
            data=json.dumps({"identifier": "new-id", "password": "test-password-123"}),
            content_type="application/json",
        )
        email_login = self.client.post(
            "/api/auth/login",
            data=json.dumps(
                {"identifier": "account@example.com", "password": "test-password-123"}
            ),
            content_type="application/json",
        )

        self.assertEqual(old_login.status_code, 401)
        self.assertEqual(new_login.status_code, 200)
        self.assertEqual(email_login.status_code, 200)

    def test_profile_name_must_be_unique_across_login_identifiers(self):
        self.user_model.objects.create_user(
            username="another-id",
            email="another@example.com",
            password="test-password-123",
        )

        response = self.client.patch(
            "/api/auth/me",
            data=json.dumps({"displayName": "another@example.com"}),
            content_type="application/json",
            HTTP_AUTHORIZATION=self.authorization,
        )

        self.assertEqual(response.status_code, 400)
        self.user.refresh_from_db()
        self.assertEqual(self.user.username, "old-id")

    def test_profile_always_exposes_username_as_display_name(self):
        response = self.client.get(
            "/api/auth/me",
            HTTP_AUTHORIZATION=self.authorization,
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["username"], "old-id")
        self.assertEqual(response.json()["displayName"], "old-id")


@override_settings(
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
    DEFAULT_FROM_EMAIL="Daily Todo <test@example.com>",
    EMAIL_VERIFICATION_CODE_TTL_MINUTES=10,
    EMAIL_VERIFICATION_RESEND_SECONDS=60,
)
class AndroidRegistrationTests(TestCase):
    def setUp(self):
        self.client = Client()

    def request_code(self, email: str) -> str:
        response = self.client.post(
            "/api/auth/android/register/code",
            data=json.dumps({"email": email}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 202)
        self.assertEqual(len(mail.outbox), 1)
        match = re.search(r"\b(\d{6})\b", mail.outbox[0].body)
        self.assertIsNotNone(match)
        return match.group(1)

    def test_android_registration_requires_emailed_code(self):
        email = "verified@example.com"
        code = self.request_code(email)

        response = self.client.post(
            "/api/auth/android/register",
            data=json.dumps(
                {
                    "username": "verified-user",
                    "email": email,
                    "password": "Orange!9462-Complex",
                    "verificationCode": code,
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertIn("accessToken", response.json())
        self.assertTrue(get_user_model().objects.filter(email=email).exists())
        self.assertIsNotNone(EmailVerificationCode.objects.get(email=email).consumed_at)

    def test_android_registration_rejects_incorrect_code(self):
        email = "wrong-code@example.com"
        self.request_code(email)

        response = self.client.post(
            "/api/auth/android/register",
            data=json.dumps(
                {
                    "username": "wrong-code-user",
                    "email": email,
                    "password": "Orange!9462-Complex",
                    "verificationCode": "000000",
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertFalse(get_user_model().objects.filter(email=email).exists())
        self.assertEqual(
            EmailVerificationCode.objects.get(email=email).failed_attempts,
            1,
            response.content,
        )

    def test_android_registration_code_request_is_rate_limited(self):
        email = "limited@example.com"
        self.request_code(email)

        response = self.client.post(
            "/api/auth/android/register/code",
            data=json.dumps({"email": email}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 429)
        self.assertEqual(len(mail.outbox), 1)


@override_settings(
    GOOGLE_CALENDAR_CLIENT_ID="google-client",
    GOOGLE_CALENDAR_CLIENT_SECRET="google-secret",
    GOOGLE_AUTH_REDIRECT_URI="https://daily-todo.test/api/auth/google/callback",
    ANDROID_GOOGLE_AUTH_RETURN_URL="daily-todo://auth/google",
)
class GoogleLoginTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.user_model = get_user_model()

    def test_google_login_prefers_existing_bound_account(self):
        bound_user = self.user_model.objects.create_user(
            username="ryan",
            email="ryan@example.com",
            password="test-password-123",
        )
        self.user_model.objects.create_user(
            username="email-match",
            email="google@example.com",
            password="test-password-123",
        )
        GoogleCalendarConnection.objects.create(
            user=bound_user,
            access_token="old-token",
            google_subject="google-subject-1",
            google_email="google@example.com",
        )
        state = signing.dumps(
            {"return_url": "https://app.test"},
            salt=GOOGLE_AUTH_STATE_SALT,
        )

        with (
            patch("accounts.api.exchange_code_for_tokens", return_value={"access_token": "token"}),
            patch(
                "accounts.api.fetch_google_userinfo",
                return_value={
                    "sub": "google-subject-1",
                    "email": "google@example.com",
                    "name": "Ryan Tang",
                },
            ),
        ):
            response = self.client.get(
                "/api/auth/google/callback",
                {"code": "google-code", "state": state},
            )

        self.assertEqual(response.status_code, 302)
        query = parse_qs(urlparse(response["Location"]).query)
        signed_in_user = authenticate_access_token(query["accessToken"][0])
        self.assertEqual(signed_in_user, bound_user)

    def test_android_google_login_uses_pkce_bound_one_time_exchange(self):
        user = self.user_model.objects.create_user(
            username="android-google",
            email="android-google@example.com",
            password="test-password-123",
        )
        verifier = "v" * 43
        digest = hashlib.sha256(verifier.encode("ascii")).digest()
        challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")

        start = self.client.post(
            "/api/auth/android/google",
            data=json.dumps({"codeChallenge": challenge}),
            content_type="application/json",
        )
        self.assertEqual(start.status_code, 200)
        self.assertEqual(start.json()["redirectUrl"], "daily-todo://auth/google")
        state = parse_qs(urlparse(start.json()["authorizationUrl"]).query)["state"][0]

        with (
            patch("accounts.api.exchange_code_for_tokens", return_value={"access_token": "token"}),
            patch(
                "accounts.api.fetch_google_userinfo",
                return_value={
                    "sub": "android-google-subject",
                    "email": user.email,
                    "email_verified": True,
                    "name": "Android User",
                },
            ),
        ):
            callback = self.client.get(
                "/api/auth/google/callback",
                {"code": "google-code", "state": state},
            )

        self.assertEqual(callback.status_code, 302)
        callback_query = parse_qs(urlparse(callback["Location"]).query)
        self.assertEqual(callback_query["googleAuth"], ["success"])
        self.assertNotIn("accessToken", callback_query)
        exchange_code = callback_query["code"][0]

        exchange = self.client.post(
            "/api/auth/android/google/exchange",
            data=json.dumps({"code": exchange_code, "codeVerifier": verifier}),
            content_type="application/json",
        )
        self.assertEqual(exchange.status_code, 200)
        signed_in_user = authenticate_access_token(exchange.json()["accessToken"])
        self.assertEqual(signed_in_user, user)

        reused = self.client.post(
            "/api/auth/android/google/exchange",
            data=json.dumps({"code": exchange_code, "codeVerifier": verifier}),
            content_type="application/json",
        )
        self.assertEqual(reused.status_code, 400)
