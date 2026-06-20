from datetime import date

from django.contrib.auth import get_user_model
from django.test import TestCase

from .models import TodoOccurrence
from .services import create_task_for_day, ensure_day, update_occurrence


class CarryoverTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="ryan",
            email="ryan@example.com",
            password="test-password-123",
        )

    def test_future_day_does_not_receive_carryover_before_it_arrives(self):
        create_task_for_day(self.user, date(2026, 6, 20), "Read")

        ensure_day(self.user, date(2026, 6, 21), today=date(2026, 6, 20))

        self.assertFalse(
            TodoOccurrence.objects.filter(
                user=self.user,
                task_date=date(2026, 6, 21),
                deleted_at__isnull=True,
            ).exists()
        )

    def test_pending_item_carries_after_next_day_arrives(self):
        create_task_for_day(self.user, date(2026, 6, 20), "Read")

        ensure_day(self.user, date(2026, 6, 21), today=date(2026, 6, 21))

        self.assertTrue(
            TodoOccurrence.objects.filter(
                user=self.user,
                task_date=date(2026, 6, 21),
                status=TodoOccurrence.Status.PENDING,
                deleted_at__isnull=True,
            ).exists()
        )

    def test_completing_source_removes_later_auto_carryover(self):
        source = create_task_for_day(self.user, date(2026, 6, 20), "Read")
        ensure_day(self.user, date(2026, 6, 21), today=date(2026, 6, 21))

        update_occurrence(self.user, source.id, done=True)

        self.assertFalse(
            TodoOccurrence.objects.filter(
                user=self.user,
                task_date=date(2026, 6, 21),
                status=TodoOccurrence.Status.PENDING,
                deleted_at__isnull=True,
            ).exists()
        )

