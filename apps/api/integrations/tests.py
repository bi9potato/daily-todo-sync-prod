from datetime import date, time

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from todos.models import Task
from todos.services import create_task_for_day

from .google_calendar import (
    GoogleCalendarError,
    build_google_calendar_event,
    recurrence_rule,
)


@override_settings(TIME_ZONE="Asia/Shanghai", GOOGLE_CALENDAR_EVENT_DURATION_MINUTES=30)
class GoogleCalendarPayloadTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="ryan",
            email="ryan@example.com",
            password="test-password-123",
        )

    def test_builds_timed_event_for_reminder_task(self):
        occurrence = create_task_for_day(
            self.user,
            date(2026, 6, 21),
            "Read",
            note="chapter 1",
            reminder_time=time(9, 30),
        )

        payload = build_google_calendar_event(occurrence)

        self.assertEqual(payload["summary"], "Read")
        self.assertEqual(payload["start"]["timeZone"], "Asia/Shanghai")
        self.assertIn("2026-06-21T09:30:00", payload["start"]["dateTime"])
        self.assertIn("chapter 1", payload["description"])
        self.assertEqual(
            payload["extendedProperties"]["private"]["dailyTodoRootId"],
            str(occurrence.root_id),
        )

    def test_task_without_reminder_is_not_calendar_eligible(self):
        occurrence = create_task_for_day(self.user, date(2026, 6, 21), "Read")

        with self.assertRaises(GoogleCalendarError):
            build_google_calendar_event(occurrence)

    def test_weekly_repeat_maps_to_rrule(self):
        occurrence = create_task_for_day(
            self.user,
            date(2026, 6, 21),
            "Standup",
            reminder_time=time(9, 30),
            recurrence_kind=Task.RecurrenceKind.WEEKLY,
            recurrence_days_of_week=[0, 2, 4],
        )

        self.assertEqual(
            recurrence_rule(occurrence.task),
            "RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR",
        )
