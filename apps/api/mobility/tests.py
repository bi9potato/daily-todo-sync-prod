import json
from datetime import datetime
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import Client, TestCase

from accounts.tokens import issue_access_token


class MobilityApiTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="walker",
            email="walker@example.com",
            password="test-password-123",
        )
        self.client = Client()
        self.authorization = f"Bearer {issue_access_token(self.user)}"

    def post(self, path: str, payload=None):
        return self.client.post(
            path,
            data=json.dumps(payload) if payload is not None else None,
            content_type="application/json",
            HTTP_AUTHORIZATION=self.authorization,
        )

    def put(self, path: str, payload):
        return self.client.put(
            path,
            data=json.dumps(payload),
            content_type="application/json",
            HTTP_AUTHORIZATION=self.authorization,
        )

    def test_start_is_idempotent_and_stop_closes_recording(self):
        first = self.post("/api/mobility/recordings/start")
        second = self.post("/api/mobility/recordings/start")

        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 201)
        self.assertEqual(first.json()["id"], second.json()["id"])

        stopped = self.post(
            f"/api/mobility/recordings/{first.json()['id']}/stop"
        )
        self.assertEqual(stopped.status_code, 200)
        self.assertFalse(stopped.json()["isActive"])
        self.assertIsNotNone(stopped.json()["endedAt"])

    def test_points_are_deduplicated_and_distance_is_calculated(self):
        started_at = datetime.fromisoformat("2026-06-30T07:59:00+08:00")
        with patch("mobility.api.timezone.now", return_value=started_at):
            recording = self.post("/api/mobility/recordings/start").json()
        point_batch = {
            "points": [
                {
                    "clientId": "point-1",
                    "recordedAt": "2026-06-30T08:00:00+08:00",
                    "latitude": 39.990000,
                    "longitude": 116.300000,
                    "accuracy": 8,
                    "placeName": "起点",
                },
                {
                    "clientId": "point-2",
                    "recordedAt": "2026-06-30T08:02:00+08:00",
                    "latitude": 39.991000,
                    "longitude": 116.300000,
                    "accuracy": 8,
                },
            ]
        }
        first = self.post(
            f"/api/mobility/recordings/{recording['id']}/points",
            point_batch,
        )
        duplicate = self.post(
            f"/api/mobility/recordings/{recording['id']}/points",
            point_batch,
        )

        self.assertEqual(first.status_code, 200)
        self.assertEqual(duplicate.status_code, 200)
        self.assertGreater(first.json()["distanceMeters"], 100)
        self.assertAlmostEqual(
            first.json()["distanceMeters"],
            duplicate.json()["distanceMeters"],
        )

        day = self.client.get(
            "/api/mobility/days/2026-06-30",
            HTTP_AUTHORIZATION=self.authorization,
        )
        self.assertEqual(day.status_code, 200)
        self.assertEqual(len(day.json()["points"]), 2)
        self.assertEqual(day.json()["points"][0]["placeName"], "起点")

    def test_step_samples_are_idempotent_per_watcher(self):
        recording = self.post("/api/mobility/recordings/start").json()
        path = f"/api/mobility/recordings/{recording['id']}/steps"

        self.put(
            path,
            {
                "sourceId": "watcher-a",
                "stepCount": 20,
                "recordedAt": "2026-06-30T08:10:00+08:00",
            },
        )
        lower = self.put(
            path,
            {
                "sourceId": "watcher-a",
                "stepCount": 15,
                "recordedAt": "2026-06-30T08:11:00+08:00",
            },
        )
        combined = self.put(
            path,
            {
                "sourceId": "watcher-b",
                "stepCount": 7,
                "recordedAt": "2026-06-30T08:12:00+08:00",
            },
        )

        self.assertEqual(lower.json()["stepCount"], 20)
        self.assertEqual(combined.json()["stepCount"], 27)

    def test_health_connect_replaces_sensor_samples_and_can_correct_downward(self):
        recording = self.post("/api/mobility/recordings/start").json()
        path = f"/api/mobility/recordings/{recording['id']}/steps"
        self.put(
            path,
            {
                "sourceId": "pedometer-process-a",
                "stepCount": 40,
                "recordedAt": "2026-06-30T08:10:00+08:00",
            },
        )
        health = self.put(
            path,
            {
                "sourceId": "health-connect",
                "stepCount": 35,
                "recordedAt": "2026-06-30T08:11:00+08:00",
            },
        )
        corrected = self.put(
            path,
            {
                "sourceId": "health-connect",
                "stepCount": 32,
                "recordedAt": "2026-06-30T08:12:00+08:00",
            },
        )
        ignored_sensor = self.put(
            path,
            {
                "sourceId": "pedometer-process-b",
                "stepCount": 10,
                "recordedAt": "2026-06-30T08:13:00+08:00",
            },
        )

        self.assertEqual(health.json()["stepCount"], 35)
        self.assertEqual(corrected.json()["stepCount"], 32)
        self.assertEqual(ignored_sensor.json()["stepCount"], 32)

    def test_user_cannot_access_another_users_recording(self):
        recording = self.post("/api/mobility/recordings/start").json()
        other = get_user_model().objects.create_user(
            username="other",
            email="other@example.com",
            password="test-password-123",
        )
        response = self.client.post(
            f"/api/mobility/recordings/{recording['id']}/stop",
            HTTP_AUTHORIZATION=f"Bearer {issue_access_token(other)}",
        )
        self.assertEqual(response.status_code, 404)
