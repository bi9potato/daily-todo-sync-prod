from urllib.parse import parse_qs, urlparse
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core import signing
from django.test import Client, TestCase, override_settings

from integrations.models import GoogleCalendarConnection

from .api import GOOGLE_AUTH_STATE_SALT
from .tokens import authenticate_access_token


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
