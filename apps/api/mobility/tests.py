import json
from datetime import datetime, timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import Client, TestCase
from django.utils import timezone

from accounts.tokens import issue_access_token
from mobility.models import LocationPoint, MobilityRecording
from mobility.segmentation import build_day_segments


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

    def test_day_response_includes_segments(self):
        started_at = datetime.fromisoformat("2026-06-30T07:59:00+08:00")
        with patch("mobility.api.timezone.now", return_value=started_at):
            recording = self.post("/api/mobility/recordings/start").json()
        self.post(
            f"/api/mobility/recordings/{recording['id']}/points",
            {
                "points": [
                    {
                        "clientId": "p1",
                        "recordedAt": "2026-06-30T08:00:00+08:00",
                        "latitude": 39.9900,
                        "longitude": 116.3000,
                        "accuracy": 8,
                    },
                    {
                        "clientId": "p2",
                        "recordedAt": "2026-06-30T08:20:00+08:00",
                        "latitude": 39.9901,
                        "longitude": 116.3000,
                        "accuracy": 8,
                    },
                ]
            },
        )

        day = self.client.get(
            "/api/mobility/days/2026-06-30",
            HTTP_AUTHORIZATION=self.authorization,
        )

        self.assertEqual(day.status_code, 200)
        segments = day.json()["segments"]
        self.assertEqual(len(segments), 1)
        self.assertEqual(segments[0]["type"], "visit")

    def test_clear_history_deletes_all_recordings_and_points(self):
        recording = self.post("/api/mobility/recordings/start").json()
        self.post(
            f"/api/mobility/recordings/{recording['id']}/points",
            {
                "points": [
                    {
                        "clientId": "p1",
                        "recordedAt": "2026-06-30T08:00:00+08:00",
                        "latitude": 39.9900,
                        "longitude": 116.3000,
                        "accuracy": 8,
                    }
                ]
            },
        )

        response = self.client.delete(
            "/api/mobility/history", HTTP_AUTHORIZATION=self.authorization
        )

        self.assertEqual(response.status_code, 204)
        self.assertEqual(MobilityRecording.objects.filter(user=self.user).count(), 0)
        self.assertEqual(
            LocationPoint.objects.filter(recording__user=self.user).count(), 0
        )

    def test_clear_history_only_affects_requesting_user(self):
        other = get_user_model().objects.create_user(
            username="other-clearer",
            email="other-clearer@example.com",
            password="test-password-123",
        )
        MobilityRecording.objects.create(user=other, started_at=timezone.now())
        self.post("/api/mobility/recordings/start")

        self.client.delete("/api/mobility/history", HTTP_AUTHORIZATION=self.authorization)

        self.assertEqual(MobilityRecording.objects.filter(user=other).count(), 1)
        self.assertEqual(MobilityRecording.objects.filter(user=self.user).count(), 0)

    def test_export_returns_google_timeline_objects(self):
        started_at = datetime.fromisoformat("2026-06-30T07:59:00+08:00")
        with patch("mobility.api.timezone.now", return_value=started_at):
            recording = self.post("/api/mobility/recordings/start").json()
        self.post(
            f"/api/mobility/recordings/{recording['id']}/points",
            {
                "points": [
                    {
                        "clientId": "p1",
                        "recordedAt": "2026-06-30T08:00:00+08:00",
                        "latitude": 39.9900,
                        "longitude": 116.3000,
                        "accuracy": 8,
                    },
                    {
                        "clientId": "p2",
                        "recordedAt": "2026-06-30T08:20:00+08:00",
                        "latitude": 39.9901,
                        "longitude": 116.3000,
                        "accuracy": 8,
                    },
                ]
            },
        )

        response = self.client.get(
            "/api/mobility/export?start=2026-06-30&end=2026-06-30",
            HTTP_AUTHORIZATION=self.authorization,
        )

        self.assertEqual(response.status_code, 200)
        payload = json.loads(response.content)
        self.assertIn("timelineObjects", payload)
        self.assertEqual(len(payload["timelineObjects"]), 1)
        self.assertIn("placeVisit", payload["timelineObjects"][0])

    def test_export_rejects_end_before_start(self):
        response = self.client.get(
            "/api/mobility/export?start=2026-06-30&end=2026-06-29",
            HTTP_AUTHORIZATION=self.authorization,
        )
        self.assertEqual(response.status_code, 400)


class MobilitySegmentationTests(TestCase):
    @staticmethod
    def make_point(lat: float, lng: float, minutes_offset: int, accuracy: float = 8):
        base = timezone.make_aware(datetime.fromisoformat("2026-06-30T08:00:00"))
        return LocationPoint(
            latitude=lat,
            longitude=lng,
            accuracy=accuracy,
            recorded_at=base + timedelta(minutes=minutes_offset),
        )

    def test_empty_points_returns_no_segments(self):
        self.assertEqual(build_day_segments([]), [])

    def test_partitions_trip_visit_trip(self):
        points = [
            self.make_point(39.9000, 116.3000, 0),
            self.make_point(39.9050, 116.3000, 10),
            self.make_point(39.9100, 116.3000, 20),
            self.make_point(39.9100, 116.30002, 22),
            self.make_point(39.9100, 116.30003, 30),
            self.make_point(39.9100, 116.30001, 40),
            self.make_point(39.9200, 116.3000, 50),
            self.make_point(39.9300, 116.3000, 60),
        ]

        segments = build_day_segments(points, dwell_minutes=5)

        self.assertEqual([segment["type"] for segment in segments], ["trip", "visit", "trip"])
        self.assertGreater(segments[0]["distanceMeters"], 400)
        self.assertGreaterEqual(segments[1]["durationMinutes"], 15)
        self.assertGreater(segments[2]["distanceMeters"], 400)

    def test_single_cluster_all_day_is_one_visit_no_trip(self):
        points = [
            self.make_point(39.9000, 116.3000, offset)
            for offset in (0, 5, 10, 15, 20)
        ]

        segments = build_day_segments(points, dwell_minutes=5)

        self.assertEqual([segment["type"] for segment in segments], ["visit"])

    def test_short_dwell_does_not_qualify_as_visit(self):
        points = [
            self.make_point(39.9000, 116.3000, 0),
            self.make_point(39.9000, 116.3000, 2),
            self.make_point(39.9200, 116.3000, 5),
        ]

        segments = build_day_segments(points, dwell_minutes=5)

        self.assertTrue(all(segment["type"] == "trip" for segment in segments))
