import json
from datetime import datetime, timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import Client, TestCase
from django.utils import timezone

from accounts.tokens import issue_access_token
from mobility.geo import thin_stationary_points
from mobility.models import LocationPoint, MobilityRecording
from mobility.segmentation import (
    build_day_segments,
    build_route_points,
    segment_day,
)


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

    def test_mobility_device_token_uploads_but_cannot_read_todos(self):
        token_response = self.post("/api/mobility/device-token")
        self.assertEqual(token_response.status_code, 200)
        device_token = token_response.json()["token"]
        device_auth = f"Bearer {device_token}"

        started = self.client.post(
            "/api/mobility/recordings/start",
            HTTP_AUTHORIZATION=device_auth,
        )
        self.assertEqual(started.status_code, 201)
        uploaded = self.client.post(
            f"/api/mobility/recordings/{started.json()['id']}/points",
            data=json.dumps(
                {
                    "points": [
                        {
                            "clientId": "device-point-1",
                            "recordedAt": "2026-06-30T08:00:00+08:00",
                            "latitude": 39.99,
                            "longitude": 116.3,
                            "accuracy": 8,
                        }
                    ]
                }
            ),
            content_type="application/json",
            HTTP_AUTHORIZATION=device_auth,
        )
        self.assertEqual(uploaded.status_code, 200)

        # Scoped: the same token must not unlock the rest of the API.
        todos = self.client.get(
            "/api/days/2026-06-30",
            HTTP_AUTHORIZATION=device_auth,
        )
        self.assertEqual(todos.status_code, 401)

    def test_points_on_closed_recording_stay_visible_on_their_day(self):
        # A half-failed midnight rotation uploads today's points onto a
        # recording that was already closed yesterday; the day view matches
        # points by user + time window, so they must still show up.
        started_at = datetime.fromisoformat("2026-06-29T23:00:00+08:00")
        with patch("mobility.api.timezone.now", return_value=started_at):
            recording = self.post("/api/mobility/recordings/start").json()
        stopped_at = datetime.fromisoformat("2026-06-29T23:59:00+08:00")
        with patch("mobility.api.timezone.now", return_value=stopped_at):
            self.post(f"/api/mobility/recordings/{recording['id']}/stop")

        self.post(
            f"/api/mobility/recordings/{recording['id']}/points",
            {
                "points": [
                    {
                        "clientId": "late-point-1",
                        "recordedAt": "2026-06-30T08:00:00+08:00",
                        "latitude": 39.99,
                        "longitude": 116.3,
                        "accuracy": 8,
                    }
                ]
            },
        )

        day = self.client.get(
            "/api/mobility/days/2026-06-30",
            HTTP_AUTHORIZATION=self.authorization,
        )
        self.assertEqual(day.status_code, 200)
        self.assertEqual(len(day.json()["points"]), 1)

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

    def test_stationary_night_adds_no_distance_and_glitches_are_dropped(self):
        # A whole night at home wobbling inside the accuracy radius, one
        # corrupted teleport fix, then a real ~1km walk. The day must report
        # only the walk's distance, a visit covering the night, and a track
        # thinned down from the raw jitter cloud.
        recording = MobilityRecording.objects.create(
            user=self.user,
            started_at=datetime.fromisoformat("2026-06-30T00:00:00+08:00"),
            ended_at=datetime.fromisoformat("2026-06-30T02:00:00+08:00"),
            is_active=False,
        )
        points = []
        for minute in range(61):
            wobble = 0.0002 if minute % 2 else 0.0
            points.append(
                LocationPoint(
                    recording=recording,
                    client_id=f"home-{minute}",
                    recorded_at=datetime.fromisoformat(
                        "2026-06-30T00:00:00+08:00"
                    )
                    + timedelta(minutes=minute),
                    latitude=39.990000 + wobble,
                    longitude=116.300000,
                    accuracy=30,
                )
            )
        points.append(
            LocationPoint(
                recording=recording,
                client_id="teleport",
                recorded_at=datetime.fromisoformat("2026-06-30T00:30:30+08:00"),
                latitude=40.500000,
                longitude=116.300000,
                accuracy=8,
            )
        )
        for step in range(1, 11):
            points.append(
                LocationPoint(
                    recording=recording,
                    client_id=f"walk-{step}",
                    recorded_at=datetime.fromisoformat(
                        "2026-06-30T01:00:00+08:00"
                    )
                    + timedelta(minutes=step),
                    latitude=39.990000 + 0.0009 * step,
                    longitude=116.300000,
                    accuracy=8,
                )
            )
        LocationPoint.objects.bulk_create(points)

        day = self.client.get(
            "/api/mobility/days/2026-06-30",
            HTTP_AUTHORIZATION=self.authorization,
        )

        self.assertEqual(day.status_code, 200)
        payload = day.json()
        # Only the walk may contribute distance - the raw consecutive-point
        # sum over the night's wobble alone would exceed a kilometer.
        self.assertGreater(payload["distanceMeters"], 600)
        self.assertLess(payload["distanceMeters"], 1300)
        self.assertLess(len(payload["points"]), 30)
        self.assertTrue(
            all(point["latitude"] < 40.4 for point in payload["points"]),
            "teleport glitch must be dropped",
        )
        visits = [
            segment
            for segment in payload["segments"]
            if segment["type"] == "visit"
        ]
        self.assertEqual(len(visits), 1)
        self.assertGreaterEqual(visits[0]["durationMinutes"], 50)

    def test_day_totals_are_clipped_to_local_day_across_recording_rotation(self):
        previous = MobilityRecording.objects.create(
            user=self.user,
            started_at=datetime.fromisoformat("2026-06-30T23:50:00+08:00"),
            ended_at=datetime.fromisoformat("2026-07-01T00:02:00+08:00"),
            is_active=False,
            step_count=1_200,
            distance_meters=99_999,
        )
        current = MobilityRecording.objects.create(
            user=self.user,
            started_at=datetime.fromisoformat("2026-07-01T00:02:00+08:00"),
            step_count=25,
            distance_meters=88_888,
        )
        LocationPoint.objects.bulk_create(
            [
                LocationPoint(
                    recording=previous,
                    client_id="previous-day",
                    recorded_at=datetime.fromisoformat(
                        "2026-06-30T23:59:00+08:00"
                    ),
                    latitude=39.990000,
                    longitude=116.300000,
                    accuracy=8,
                ),
                LocationPoint(
                    recording=previous,
                    client_id="first-today",
                    recorded_at=datetime.fromisoformat(
                        "2026-07-01T00:01:00+08:00"
                    ),
                    latitude=39.991000,
                    longitude=116.300000,
                    accuracy=8,
                ),
                LocationPoint(
                    recording=current,
                    client_id="current-start",
                    recorded_at=datetime.fromisoformat(
                        "2026-07-01T00:03:00+08:00"
                    ),
                    latitude=39.992000,
                    longitude=116.300000,
                    accuracy=8,
                ),
                LocationPoint(
                    recording=current,
                    client_id="current-end",
                    recorded_at=datetime.fromisoformat(
                        "2026-07-01T00:05:00+08:00"
                    ),
                    latitude=39.993000,
                    longitude=116.300000,
                    accuracy=8,
                ),
            ]
        )

        now = datetime.fromisoformat("2026-07-01T00:12:00+08:00")
        with patch("mobility.api.timezone.now", return_value=now):
            response = self.client.get(
                "/api/mobility/days/2026-07-01",
                HTTP_AUTHORIZATION=self.authorization,
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["stepCount"], 25)
        self.assertEqual(payload["durationMinutes"], 12)
        self.assertEqual(len(payload["points"]), 3)
        # Both legs count, including the one crossing the midnight recording
        # rotation - the day is a time window, not a recording bucket.
        self.assertGreater(payload["distanceMeters"], 100)
        self.assertLess(payload["distanceMeters"], 300)

    def test_today_does_not_reuse_whole_totals_from_unrotated_recording(self):
        recording = MobilityRecording.objects.create(
            user=self.user,
            started_at=datetime.fromisoformat("2026-06-30T20:00:00+08:00"),
            step_count=1_200,
            distance_meters=99_999,
        )
        LocationPoint.objects.bulk_create(
            [
                LocationPoint(
                    recording=recording,
                    client_id="yesterday",
                    recorded_at=datetime.fromisoformat(
                        "2026-06-30T23:59:00+08:00"
                    ),
                    latitude=39.990000,
                    longitude=116.300000,
                    accuracy=8,
                ),
                LocationPoint(
                    recording=recording,
                    client_id="today-start",
                    recorded_at=datetime.fromisoformat(
                        "2026-07-01T00:03:00+08:00"
                    ),
                    latitude=39.991000,
                    longitude=116.300000,
                    accuracy=8,
                ),
                LocationPoint(
                    recording=recording,
                    client_id="today-end",
                    recorded_at=datetime.fromisoformat(
                        "2026-07-01T00:05:00+08:00"
                    ),
                    latitude=39.992000,
                    longitude=116.300000,
                    accuracy=8,
                ),
            ]
        )

        now = datetime.fromisoformat("2026-07-01T00:10:00+08:00")
        with patch("mobility.api.timezone.now", return_value=now):
            response = self.client.get(
                "/api/mobility/days/2026-07-01",
                HTTP_AUTHORIZATION=self.authorization,
            )

        payload = response.json()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload["stepCount"], 0)
        self.assertEqual(payload["durationMinutes"], 10)
        self.assertEqual(len(payload["points"]), 2)
        self.assertGreater(payload["distanceMeters"], 100)
        self.assertLess(payload["distanceMeters"], 200)
        self.assertEqual(payload["activeRecording"]["id"], str(recording.id))

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

    def test_walk_out_and_back_between_two_stays_is_not_swallowed(self):
        # Stay home, walk ~250m up the road and back, then stay home again.
        # Both stays anchor at the same spot (well inside the 120m dedup
        # radius), so folding them together used to erase the walk entirely -
        # the day collapsed to a single visit. The excursion past the dedup
        # radius must keep the two stays distinct and surface the walk.
        home = [self.make_point(39.9000, 116.3000, offset) for offset in range(7)]
        walk = [
            self.make_point(39.9000 + 0.0008, 116.3000, 8),
            self.make_point(39.9000 + 0.0016, 116.3000, 9),
            self.make_point(39.9000 + 0.0022, 116.3000, 10),
            self.make_point(39.9000 + 0.0016, 116.3000, 11),
            self.make_point(39.9000 + 0.0008, 116.3000, 12),
        ]
        home_again = [
            self.make_point(39.9000, 116.3000, offset) for offset in range(13, 20)
        ]

        segments = build_day_segments(home + walk + home_again, dwell_minutes=5)

        types = [segment["type"] for segment in segments]
        self.assertEqual(types.count("visit"), 2)
        self.assertIn("trip", types)

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

    def test_coarse_accuracy_walk_keeps_a_dense_track_and_walking_trip(self):
        # A ~7 minute walk sampled every minute, ~55m per fix, at the 35m
        # accuracy a phone commonly reports in the city. The movement floor
        # was the sum of both radii (70m), so a 55m leg only counted as
        # movement once it had accumulated across two fixes - the kept track
        # dropped to every other point, cutting corners off the drawn line.
        # Capping each fix's accuracy contribution (40m floor) keeps every
        # real step, so the polyline hugs the walk and the leg is a trip.
        points = [
            self.make_point(39.9000 + 0.0005 * step, 116.3000, step, accuracy=35)
            for step in range(8)
        ]

        # Every moving fix is retained rather than thinned to every other one
        # (which is what the old summed-radius floor did here).
        self.assertGreaterEqual(len(thin_stationary_points(points)), 7)

        segments = build_day_segments(points, dwell_minutes=5)
        self.assertEqual([segment["type"] for segment in segments], ["trip"])
        self.assertEqual(segments[0]["mode"], "WALKING")
        self.assertGreater(segments[0]["distanceMeters"], 200)

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

    def test_congested_ride_with_slow_doppler_median_is_not_a_walk(self):
        # Stop-and-go traffic: most fixes crawl (median at walking pace,
        # peaks below the vehicle threshold) while the trip still covers
        # ~12km in 25 minutes. The displacement floor must override the
        # Doppler median - nobody walks 12km at an 8 m/s average.
        speeds = [0.5, 1.5] * 12 + [8.0, 8.0]
        points = [
            self.make_point(
                39.9000 + 0.0043 * step,
                116.3000,
                float(step),
                speed=speeds[step],
            )
            for step in range(26)
        ]

        segments = build_day_segments(points, dwell_minutes=5)

        self.assertEqual([segment["type"] for segment in segments], ["trip"])
        self.assertEqual(segments[0]["mode"], "IN_VEHICLE")

    def test_low_accuracy_doppler_noise_does_not_reclassify_a_walk(self):
        # A walk through an urban canyon: solid GPS fixes at walking pace,
        # plus a couple of wifi/cell positions whose bogus Doppler bursts
        # used to push the p90 into vehicle territory.
        walk = [
            self.make_point(
                39.9000 + 0.0009 * step, 116.3000, step, speed=1.3
            )
            for step in range(6)
        ]
        noisy = [
            self.make_point(39.9006, 116.3001, 2.5, accuracy=120, speed=14.0),
            self.make_point(39.9012, 116.3001, 4.5, accuracy=200, speed=16.0),
        ]
        points = sorted(walk + noisy, key=lambda point: point.recorded_at)

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

    def test_lone_drift_spike_while_stationary_is_dropped(self):
        # A phone sitting still all morning: wifi positioning teleports one
        # fix ~130m away and the very next fix lands back home. The spike
        # must vanish from the thinned track (no phantom out-and-back walk),
        # and the day must stay a single visit with no trip.
        home = [
            self.make_point(39.9000, 116.3000, float(offset), accuracy=15)
            for offset in range(40)
        ]
        spike = self.make_point(39.9012, 116.3000, 20.5, accuracy=40)
        points = sorted(home + [spike], key=lambda point: point.recorded_at)

        thinned = thin_stationary_points(points)
        self.assertTrue(
            all(abs(float(point.latitude) - 39.9000) < 0.0005 for point in thinned),
            "the returning drift spike must not survive thinning",
        )

        segments = build_day_segments(points, dwell_minutes=5)
        self.assertEqual([segment["type"] for segment in segments], ["visit"])

    def test_route_points_collapse_a_stay_to_its_anchor(self):
        # Half an hour at one place, fixes wobbling ~11m inside the noise
        # floor. The drawn route must be the visit anchor at the stay's start
        # and end - not a scribble of raw keepalive wobble - so playback
        # dwells at a single stable point.
        wobble = (0.0, 0.0001, -0.0001)
        points = [
            self.make_point(
                39.9000 + wobble[offset % 3], 116.3000, float(offset), accuracy=15
            )
            for offset in range(31)
        ]

        thinned, segments = segment_day(points, dwell_minutes=5)
        self.assertEqual([segment.type for segment in segments], ["visit"])

        route = build_route_points(thinned, segments)
        self.assertEqual(len(route), 2)
        self.assertEqual(route[0]["latitude"], route[1]["latitude"])
        self.assertEqual(route[0]["longitude"], route[1]["longitude"])
        self.assertLess(route[0]["recordedAt"], route[1]["recordedAt"])

    def test_confirmed_departure_still_surfaces_as_a_trip(self):
        # The spike filter must not swallow a genuine departure: two-plus
        # consecutive fixes away from the anchor confirm real movement.
        home = [
            self.make_point(39.9000, 116.3000, float(offset)) for offset in range(6)
        ]
        away = [
            self.make_point(39.9000 + 0.0009 * step, 116.3000, 6.0 + step)
            for step in range(1, 7)
        ]

        thinned = thin_stationary_points(home + away)
        self.assertGreater(
            max(abs(float(point.latitude) - 39.9000) for point in thinned),
            0.004,
            "confirmed movement must survive thinning",
        )

        segments = build_day_segments(home + away, dwell_minutes=5)
        self.assertIn("trip", [segment["type"] for segment in segments])
