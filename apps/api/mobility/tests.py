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
    def make_point(
        lat: float,
        lng: float,
        minutes_offset: float,
        accuracy: float = 8,
        speed: float | None = None,
    ):
        base = timezone.make_aware(datetime.fromisoformat("2026-06-30T08:00:00"))
        return LocationPoint(
            latitude=lat,
            longitude=lng,
            accuracy=accuracy,
            speed=speed,
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

    def test_walking_pace_with_fractional_minutes_is_not_cycling(self):
        # ~189m between fixes every 90 seconds is a brisk walk (~2.1 m/s).
        # Flooring the 4.5 minute span to 4 minutes used to inflate the
        # average speed past the walking threshold and label it CYCLING.
        points = [
            self.make_point(39.9000 + 0.0017 * step, 116.3000, 1.5 * step)
            for step in range(4)
        ]

        segments = build_day_segments(points, dwell_minutes=5)

        self.assertEqual([segment["type"] for segment in segments], ["trip"])
        self.assertEqual(segments[0]["mode"], "WALKING")

    def test_short_noisy_trip_defaults_to_walking(self):
        # Two fixes 150m apart within 30 seconds is indistinguishable from a
        # GPS drift jump; it must not show up as a cycling trip.
        points = [
            self.make_point(39.9000, 116.3000, 0),
            self.make_point(39.90135, 116.3000, 0.5),
        ]

        segments = build_day_segments(points, dwell_minutes=5)

        self.assertEqual([segment["type"] for segment in segments], ["trip"])
        self.assertEqual(segments[0]["mode"], "WALKING")

    def test_cycling_pace_is_detected(self):
        # ~451m between fixes every 90 seconds (~5 m/s) over 1.8km.
        points = [
            self.make_point(39.9000 + 0.00405 * step, 116.3000, 1.5 * step)
            for step in range(5)
        ]

        segments = build_day_segments(points, dwell_minutes=5)

        self.assertEqual([segment["type"] for segment in segments], ["trip"])
        self.assertEqual(segments[0]["mode"], "CYCLING")

    def test_stationary_drift_with_near_zero_doppler_speed_is_walking(self):
        # Position fixes drifting ~150m per minute look like a 2.5 m/s
        # "trip" (cycling pace) from displacement alone, but the Doppler
        # speed recorded with each fix says the device barely moved.
        points = [
            self.make_point(39.9000 + 0.00135 * step, 116.3000, step, speed=0.3)
            for step in range(6)
        ]

        segments = build_day_segments(points, dwell_minutes=5)

        self.assertEqual([segment["type"] for segment in segments], ["trip"])
        self.assertEqual(segments[0]["mode"], "WALKING")

    def test_stop_and_go_vehicle_ride_is_not_cycling(self):
        # A bus in traffic averages bicycle pace overall, but the recorded
        # speeds between stops burst well past anything a cyclist sustains.
        speeds = [0, 0, 3, 5, 6, 7, 8, 11, 12, 13]
        points = [
            self.make_point(
                39.9000 + 0.0018 * step, 116.3000, 0.5 * step, speed=speeds[step]
            )
            for step in range(10)
        ]

        segments = build_day_segments(points, dwell_minutes=5)

        self.assertEqual([segment["type"] for segment in segments], ["trip"])
        self.assertEqual(segments[0]["mode"], "IN_VEHICLE")

    def test_cycling_doppler_speeds_stay_cycling(self):
        speeds = [3.5, 4, 4.2, 4.5, 4.8, 5, 5.2, 5.5]
        points = [
            self.make_point(
                39.9000 + 0.00122 * step, 116.3000, 0.5 * step, speed=speeds[step]
            )
            for step in range(8)
        ]

        segments = build_day_segments(points, dwell_minutes=5)

        self.assertEqual([segment["type"] for segment in segments], ["trip"])
        self.assertEqual(segments[0]["mode"], "CYCLING")

    def test_subway_ride_with_gps_outage_is_subway(self):
        # A metro ride records nothing underground: walking-pace Doppler
        # fixes around both stations, and one 20-minute leg that jumps ~6km
        # (implied ~5 m/s - metro pace). The walking-pace samples used to
        # drag the median down and label the whole trip WALKING.
        points = [
            self.make_point(39.9000, 116.3000, 0, speed=1.2),
            self.make_point(39.9010, 116.3000, 1.5, speed=1.3),
            self.make_point(39.9020, 116.3000, 3, speed=1.2),
            self.make_point(39.9560, 116.3000, 23, speed=1.3),
            self.make_point(39.9570, 116.3000, 24.5, speed=1.2),
            self.make_point(39.9580, 116.3000, 26, speed=1.3),
        ]

        segments = build_day_segments(points, dwell_minutes=5)

        self.assertEqual([segment["type"] for segment in segments], ["trip"])
        self.assertEqual(segments[0]["mode"], "SUBWAY")

    def test_high_speed_rail_doppler_speeds(self):
        # Cruise fixes in the 250-300 km/h band (69-83 m/s) - only the
        # high-speed rail network moves like this on the ground.
        speeds = [55, 62, 70, 74, 78, 80, 82, 83]
        points = [
            self.make_point(
                39.9000 + 0.02 * step, 116.3000, 0.5 * step, speed=speeds[step]
            )
            for step in range(8)
        ]

        segments = build_day_segments(points, dwell_minutes=5)

        self.assertEqual([segment["type"] for segment in segments], ["trip"])
        self.assertEqual(segments[0]["mode"], "HIGH_SPEED_RAIL")

    def test_conventional_train_doppler_speeds(self):
        # Sustained ~150-165 km/h (42-46 m/s): past any legal road speed,
        # below the high-speed band.
        speeds = [38, 40, 42, 43, 44, 45, 46, 46]
        points = [
            self.make_point(
                39.9000 + 0.012 * step, 116.3000, 0.5 * step, speed=speeds[step]
            )
            for step in range(8)
        ]

        segments = build_day_segments(points, dwell_minutes=5)

        self.assertEqual([segment["type"] for segment in segments], ["trip"])
        self.assertEqual(segments[0]["mode"], "TRAIN")

    def test_highway_driving_stays_road_vehicle(self):
        # Holding ~100-120 km/h (28-33 m/s) on the highway must not be
        # promoted to a train.
        speeds = [28, 29, 30, 31, 32, 33, 33, 32]
        points = [
            self.make_point(
                39.9000 + 0.008 * step, 116.3000, 0.5 * step, speed=speeds[step]
            )
            for step in range(8)
        ]

        segments = build_day_segments(points, dwell_minutes=5)

        self.assertEqual([segment["type"] for segment in segments], ["trip"])
        self.assertEqual(segments[0]["mode"], "IN_VEHICLE")

    def test_flight_gps_outage_between_airports(self):
        # Airplane mode in the air: a couple of taxi/terminal fixes at each
        # airport and one ~1200km jump over 2.5 hours (~133 m/s implied) -
        # far beyond anything ground-based.
        points = [
            self.make_point(39.9000, 116.3000, 0, speed=1.2),
            self.make_point(39.9010, 116.3000, 2, speed=1.3),
            self.make_point(50.6800, 116.3000, 152, speed=1.2),
            self.make_point(50.6810, 116.3000, 154, speed=1.3),
        ]

        segments = build_day_segments(points, dwell_minutes=5)

        self.assertEqual([segment["type"] for segment in segments], ["trip"])
        self.assertEqual(segments[0]["mode"], "FLIGHT")

    def test_sparse_walking_fixes_across_long_gaps_stay_walking(self):
        # Battery-saving recorders can leave many minutes between fixes on a
        # plain walk. The gaps qualify as coverage outages, but the pace
        # implied across them is still walking pace, so they must not flip
        # the walk into a ride.
        points = [
            self.make_point(39.9000 + 0.0050 * step, 116.3000, 10 * step)
            for step in range(4)
        ]

        segments = build_day_segments(points, dwell_minutes=5)

        self.assertEqual([segment["type"] for segment in segments], ["trip"])
        self.assertEqual(segments[0]["mode"], "WALKING")

    def test_short_dwell_does_not_qualify_as_visit(self):
        points = [
            self.make_point(39.9000, 116.3000, 0),
            self.make_point(39.9000, 116.3000, 2),
            self.make_point(39.9200, 116.3000, 5),
        ]

        segments = build_day_segments(points, dwell_minutes=5)

        self.assertTrue(all(segment["type"] == "trip" for segment in segments))
