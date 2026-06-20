from datetime import date

from django.contrib.auth import get_user_model
from django.test import TestCase

from .models import TodoOccurrence
from .services import (
    create_task_for_day,
    ensure_day,
    ensure_range,
    reorder_day,
    update_occurrence,
)


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

    def test_recurring_item_can_be_generated_for_future_range(self):
        create_task_for_day(
            self.user,
            date(2026, 6, 20),
            "Standup",
            recurrence_kind="daily",
        )

        ensure_range(self.user, date(2026, 6, 22), date(2026, 6, 24), today=date(2026, 6, 20))

        self.assertEqual(
            TodoOccurrence.objects.filter(
                user=self.user,
                task_date__range=(date(2026, 6, 22), date(2026, 6, 24)),
                source=TodoOccurrence.Source.RECURRING,
                deleted_at__isnull=True,
            ).count(),
            3,
        )

    def test_reorder_day_updates_sort_order(self):
        first = create_task_for_day(self.user, date(2026, 6, 20), "First")
        second = create_task_for_day(self.user, date(2026, 6, 20), "Second")

        reorder_day(self.user, date(2026, 6, 20), [second.id, first.id])

        first.refresh_from_db()
        second.refresh_from_db()
        self.assertLess(second.sort_order, first.sort_order)
