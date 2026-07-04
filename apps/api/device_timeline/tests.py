import json
from datetime import datetime

from django.contrib.auth import get_user_model
from django.test import Client, TestCase

from accounts.tokens import issue_access_token, issue_device_timeline_token
from device_timeline.models import DeviceTimelineEvent
from device_timeline.segmentation import build_day_timeline


def make_event(event_type, occurred_at, *, package_name="", app_label=""):
    return DeviceTimelineEvent(
        client_id=f"{event_type}-{occurred_at}",
        event_type=event_type,
        occurred_at=datetime.fromisoformat(occurred_at),
        package_name=package_name,
        app_label=app_label,
    )


class BuildDayTimelineTests(TestCase):
    def test_consecutive_same_app_events_merge_into_one_segment(self):
        events = [
            make_event(
                DeviceTimelineEvent.EventType.APP_FOREGROUND,
                "2026-06-20T08:00:00+08:00",
                package_name="com.wechat",
                app_label="微信",
            ),
            make_event(
                DeviceTimelineEvent.EventType.APP_FOREGROUND,
                "2026-06-20T08:02:00+08:00",
                package_name="com.wechat",
                app_label="微信",
            ),
            make_event(
                DeviceTimelineEvent.EventType.APP_FOREGROUND,
                "2026-06-20T08:05:00+08:00",
                package_name="com.chrome",
                app_label="Chrome",
            ),
        ]

        timeline = build_day_timeline(events)

        self.assertEqual(len(timeline), 2)
        self.assertEqual(timeline[0]["type"], "app")
        self.assertEqual(timeline[0]["packageName"], "com.wechat")
        self.assertEqual(
            timeline[0]["startTime"].isoformat(), "2026-06-20T08:00:00+08:00"
        )
        self.assertEqual(
            timeline[0]["endTime"].isoformat(), "2026-06-20T08:02:00+08:00"
        )
        self.assertEqual(timeline[1]["packageName"], "com.chrome")

    def test_screen_off_closes_the_open_app_segment(self):
        events = [
            make_event(
                DeviceTimelineEvent.EventType.APP_FOREGROUND,
                "2026-06-20T08:00:00+08:00",
                package_name="com.wechat",
            ),
            make_event(DeviceTimelineEvent.EventType.SCREEN_OFF, "2026-06-20T08:10:00+08:00"),
            make_event(DeviceTimelineEvent.EventType.SCREEN_ON, "2026-06-20T09:00:00+08:00"),
            make_event(DeviceTimelineEvent.EventType.UNLOCK, "2026-06-20T09:00:05+08:00"),
        ]

        timeline = build_day_timeline(events)

        self.assertEqual(
            [item["type"] for item in timeline],
            ["app", "screen_off", "screen_on", "unlock"],
        )
        self.assertEqual(
            timeline[0]["endTime"].isoformat(), "2026-06-20T08:10:00+08:00"
        )

    def test_large_gap_between_same_app_pings_splits_into_two_segments(self):
        events = [
            make_event(
                DeviceTimelineEvent.EventType.APP_FOREGROUND,
                "2026-06-20T08:00:00+08:00",
                package_name="com.wechat",
            ),
            make_event(
                DeviceTimelineEvent.EventType.APP_FOREGROUND,
                "2026-06-20T09:00:00+08:00",
                package_name="com.wechat",
            ),
        ]

        timeline = build_day_timeline(events)

        self.assertEqual(len(timeline), 2)
        self.assertEqual(
            timeline[0]["endTime"].isoformat(), "2026-06-20T08:00:00+08:00"
        )
        self.assertEqual(
            timeline[1]["startTime"].isoformat(), "2026-06-20T09:00:00+08:00"
        )

    def test_shutdown_closes_open_segment_and_appears_as_marker(self):
        events = [
            make_event(
                DeviceTimelineEvent.EventType.APP_FOREGROUND,
                "2026-06-20T23:50:00+08:00",
                package_name="com.wechat",
            ),
            make_event(DeviceTimelineEvent.EventType.SHUTDOWN, "2026-06-20T23:55:00+08:00"),
        ]

        timeline = build_day_timeline(events)

        self.assertEqual([item["type"] for item in timeline], ["app", "shutdown"])
        self.assertEqual(
            timeline[0]["endTime"].isoformat(), "2026-06-20T23:55:00+08:00"
        )

    def test_trailing_open_app_segment_is_still_included(self):
        events = [
            make_event(
                DeviceTimelineEvent.EventType.APP_FOREGROUND,
                "2026-06-20T08:00:00+08:00",
                package_name="com.wechat",
            ),
        ]

        timeline = build_day_timeline(events)

        self.assertEqual(len(timeline), 1)
        self.assertEqual(timeline[0]["type"], "app")


class DeviceTimelineApiTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="watcher",
            email="watcher@example.com",
            password="test-password-123",
        )
        self.client = Client()
        self.authorization = f"Bearer {issue_access_token(self.user)}"

    def post(self, path: str, payload, *, authorization=None):
        return self.client.post(
            path,
            data=json.dumps(payload),
            content_type="application/json",
            HTTP_AUTHORIZATION=authorization or self.authorization,
        )

    def test_events_are_deduplicated_by_client_id(self):
        batch = {
            "events": [
                {
                    "clientId": "evt-1",
                    "eventType": "app_foreground",
                    "occurredAt": "2026-06-20T08:00:00+08:00",
                    "packageName": "com.wechat",
                    "appLabel": "微信",
                }
            ]
        }

        first = self.post("/api/device-timeline/events", batch)
        duplicate = self.post("/api/device-timeline/events", batch)

        self.assertEqual(first.status_code, 204)
        self.assertEqual(duplicate.status_code, 204)
        self.assertEqual(
            DeviceTimelineEvent.objects.filter(user=self.user).count(), 1
        )

    def test_device_token_can_upload_events(self):
        device_token = issue_device_timeline_token(self.user)
        batch = {
            "events": [
                {
                    "clientId": "evt-token-1",
                    "eventType": "screen_on",
                    "occurredAt": "2026-06-20T08:00:00+08:00",
                }
            ]
        }

        response = self.post(
            "/api/device-timeline/events",
            batch,
            authorization=f"Bearer {device_token}",
        )

        self.assertEqual(response.status_code, 204)
        self.assertTrue(DeviceTimelineEvent.objects.filter(user=self.user).exists())

    def test_day_endpoint_returns_timeline_for_local_day_only(self):
        self.post(
            "/api/device-timeline/events",
            {
                "events": [
                    {
                        "clientId": "evt-in-day",
                        "eventType": "app_foreground",
                        "occurredAt": "2026-06-20T08:00:00+08:00",
                        "packageName": "com.wechat",
                        "appLabel": "微信",
                    },
                    {
                        "clientId": "evt-next-day",
                        "eventType": "app_foreground",
                        "occurredAt": "2026-06-21T00:30:00+08:00",
                        "packageName": "com.chrome",
                        "appLabel": "Chrome",
                    },
                ]
            },
        )

        response = self.client.get(
            "/api/device-timeline/days/2026-06-20",
            HTTP_AUTHORIZATION=self.authorization,
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(len(body["timeline"]), 1)
        self.assertEqual(body["timeline"][0]["packageName"], "com.wechat")

    def test_clear_history_removes_all_events(self):
        self.post(
            "/api/device-timeline/events",
            {
                "events": [
                    {
                        "clientId": "evt-1",
                        "eventType": "screen_on",
                        "occurredAt": "2026-06-20T08:00:00+08:00",
                    }
                ]
            },
        )

        response = self.client.delete(
            "/api/device-timeline/history",
            HTTP_AUTHORIZATION=self.authorization,
        )

        self.assertEqual(response.status_code, 204)
        self.assertFalse(DeviceTimelineEvent.objects.filter(user=self.user).exists())

    def test_invalid_event_type_is_silently_skipped(self):
        response = self.post(
            "/api/device-timeline/events",
            {
                "events": [
                    {
                        "clientId": "evt-bad",
                        "eventType": "not_a_real_type",
                        "occurredAt": "2026-06-20T08:00:00+08:00",
                    }
                ]
            },
        )

        self.assertEqual(response.status_code, 204)
        self.assertFalse(DeviceTimelineEvent.objects.filter(user=self.user).exists())
