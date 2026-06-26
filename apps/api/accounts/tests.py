import json
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

from django.contrib.auth import get_user_model
from django.core import signing
from django.test import Client, TestCase, override_settings

from integrations.models import GoogleCalendarConnection

from .api import GOOGLE_AUTH_STATE_SALT
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
    GOOGLE_CALENDAR_CLIENT_ID="google-client",
    GOOGLE_CALENDAR_CLIENT_SECRET="google-secret",
    GOOGLE_AUTH_REDIRECT_URI="https://daily-todo.test/api/auth/google/callback",
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
