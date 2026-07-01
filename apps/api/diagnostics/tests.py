from django.test import TestCase
from django.utils import timezone

from accounts.models import User
from accounts.tokens import issue_access_token

from .models import ClientLogEntry


class ClientLogUploadTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="logger",
            email="logger@example.com",
            password="secret-pass",
        )
        self.access_token = issue_access_token(self.user)

    def test_upload_client_logs(self):
        response = self.client.post(
            "/api/diagnostics/client-logs",
            data={
                "sessionId": "session-1",
                "deviceId": "device-1",
                "appVersion": "1.0.0",
                "buildSha": "development",
                "platform": "android",
                "osVersion": "35",
                "entries": [
                    {
                        "clientId": "log-1",
                        "occurredAt": timezone.now().isoformat(),
                        "level": "fatal",
                        "source": "global-error",
                        "message": "App crashed",
                        "stack": "stack trace",
                        "context": {"route": "today"},
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.access_token}",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json(), {"accepted": 1})
        entry = ClientLogEntry.objects.get()
        self.assertEqual(entry.user, self.user)
        self.assertEqual(entry.client_id, "log-1")
        self.assertEqual(entry.level, "fatal")
        self.assertEqual(entry.context, {"route": "today"})

    def test_duplicate_client_ids_are_ignored(self):
        payload = {
            "sessionId": "session-1",
            "entries": [
                {
                    "clientId": "log-1",
                    "occurredAt": timezone.now().isoformat(),
                    "level": "error",
                    "source": "console",
                    "message": "first",
                }
            ],
        }

        for _ in range(2):
            response = self.client.post(
                "/api/diagnostics/client-logs",
                data=payload,
                content_type="application/json",
                HTTP_AUTHORIZATION=f"Bearer {self.access_token}",
            )
            self.assertEqual(response.status_code, 201)

        self.assertEqual(ClientLogEntry.objects.count(), 1)
