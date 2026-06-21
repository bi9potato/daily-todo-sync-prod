import json
from datetime import date

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase, override_settings

from accounts.tokens import issue_access_token
from .models import TaskAttachment, TodoOccurrence
from .services import (
    add_task_attachment,
    create_task_for_day,
    delete_occurrence,
    ensure_day,
    ensure_range,
    list_deleted_occurrences,
    reorder_day,
    restore_occurrence,
    update_occurrence,
)

TEST_STORAGES = {
    "default": {
        "BACKEND": "django.core.files.storage.InMemoryStorage",
    },
    "staticfiles": {
        "BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage",
    },
}


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

    def test_note_can_be_created_and_updated(self):
        occurrence = create_task_for_day(
            self.user,
            date(2026, 6, 20),
            "Read",
            note="  chapter 1  ",
        )

        self.assertEqual(occurrence.note, "chapter 1")

        update_occurrence(self.user, occurrence.id, note="  chapter 2  ")
        occurrence.refresh_from_db()

        self.assertEqual(occurrence.note, "chapter 2")

    def test_pin_moves_item_into_pinned_group(self):
        first = create_task_for_day(self.user, date(2026, 6, 20), "First")
        second = create_task_for_day(self.user, date(2026, 6, 20), "Second")

        update_occurrence(self.user, second.id, pinned=True)

        first.refresh_from_db()
        second.refresh_from_db()
        self.assertFalse(first.is_pinned)
        self.assertTrue(second.is_pinned)
        self.assertLess(second.sort_order, 2000)

    def test_image_attachment_can_be_added_to_task(self):
        occurrence = create_task_for_day(self.user, date(2026, 6, 20), "Read")
        image = SimpleUploadedFile(
            "receipt.png",
            b"\x89PNG\r\n\x1a\n" + b"0" * 32,
            content_type="image/png",
        )

        with override_settings(STORAGES=TEST_STORAGES):
            attachment = add_task_attachment(self.user, occurrence.id, image)

            self.assertEqual(attachment.task_id, occurrence.task_id)
            self.assertEqual(attachment.occurrence_id, occurrence.id)
            self.assertEqual(attachment.original_filename, "receipt.png")
            self.assertTrue(TaskAttachment.objects.filter(id=attachment.id).exists())
            attachment.file.close()

    def test_deleted_task_can_be_listed_and_restored(self):
        occurrence = create_task_for_day(self.user, date(2026, 6, 20), "Read")

        delete_occurrence(self.user, occurrence.id)

        deleted = list_deleted_occurrences(self.user)
        self.assertEqual([item.id for item in deleted], [occurrence.id])

        restore_occurrence(self.user, occurrence.id)

        occurrence.refresh_from_db()
        occurrence.task.refresh_from_db()
        self.assertIsNone(occurrence.deleted_at)
        self.assertIsNone(occurrence.task.deleted_at)


class TodoApiTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="ryan",
            email="ryan@example.com",
            password="test-password-123",
        )
        self.client = Client()
        self.auth_header = f"Bearer {issue_access_token(self.user)}"

    def test_create_task_endpoint_accepts_basic_payload(self):
        response = self.client.post(
            "/api/days/2026-06-20/tasks",
            data=json.dumps({"text": "Read"}),
            content_type="application/json",
            HTTP_AUTHORIZATION=self.auth_header,
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["text"], "Read")

    def test_patch_occurrence_can_pin_task(self):
        occurrence = create_task_for_day(self.user, date(2026, 6, 20), "Read")

        response = self.client.patch(
            f"/api/occurrences/{occurrence.id}",
            data=json.dumps({"pinned": True}),
            content_type="application/json",
            HTTP_AUTHORIZATION=self.auth_header,
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["isPinned"])
        occurrence.refresh_from_db()
        self.assertTrue(occurrence.is_pinned)

    def test_trash_endpoint_can_restore_deleted_task(self):
        occurrence = create_task_for_day(self.user, date(2026, 6, 20), "Read")
        delete_occurrence(self.user, occurrence.id)

        trash_response = self.client.get(
            "/api/trash",
            HTTP_AUTHORIZATION=self.auth_header,
        )

        self.assertEqual(trash_response.status_code, 200)
        self.assertEqual(trash_response.json()[0]["id"], str(occurrence.id))

        restore_response = self.client.post(
            f"/api/occurrences/{occurrence.id}/restore",
            HTTP_AUTHORIZATION=self.auth_header,
        )

        self.assertEqual(restore_response.status_code, 200)
        occurrence.refresh_from_db()
        self.assertIsNone(occurrence.deleted_at)
