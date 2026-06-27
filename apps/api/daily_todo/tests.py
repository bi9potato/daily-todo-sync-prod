import json
from unittest.mock import patch

from django.test import TestCase


class MobileReleaseManifestTests(TestCase):
    def test_returns_latest_android_release_manifest(self):
        manifest = {
            "versionName": "1.0.0",
            "versionCode": 42,
            "buildSha": "abc123",
            "architecture": "arm64-v8a",
            "apkUrl": "https://example.com/app.apk",
            "releaseUrl": "https://example.com/releases/latest",
            "publishedAt": "2026-06-27T10:00:00Z",
        }

        with patch("pathlib.Path.read_text", return_value=json.dumps(manifest)):
            response = self.client.get("/api/mobile/releases/latest")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), manifest)
        self.assertEqual(response.headers["Cache-Control"], "no-store")

    def test_returns_service_unavailable_before_first_release(self):
        with patch("pathlib.Path.read_text", side_effect=FileNotFoundError):
            response = self.client.get("/api/mobile/releases/latest")

        self.assertEqual(response.status_code, 503)
