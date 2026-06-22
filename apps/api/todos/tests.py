import json
from datetime import date

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase, override_settings

from accounts.tokens import issue_access_token
from .models import Task, TaskAttachment, TodoOccurrence
from .services import (
    add_task_attachment,
    copy_long_term_occurrence_as_regular,
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

    def test_carryover_preserves_pin_and_visual_order(self):
        first = create_task_for_day(self.user, date(2026, 6, 20), "First")
        second = create_task_for_day(self.user, date(2026, 6, 20), "Second")
        third = create_task_for_day(self.user, date(2026, 6, 20), "Third")
        update_occurrence(self.user, second.id, pinned=True)
        reorder_day(self.user, date(2026, 6, 20), [second.id, third.id, first.id])

        ensure_day(self.user, date(2026, 6, 21), today=date(2026, 6, 21))

        carried = list(
            TodoOccurrence.objects.filter(
                user=self.user,
                task_date=date(2026, 6, 21),
                source=TodoOccurrence.Source.CARRYOVER,
                deleted_at__isnull=True,
            ).order_by("-is_pinned", "sort_order", "created_at")
        )
        self.assertEqual([item.task.text for item in carried], ["Second", "Third", "First"])
        self.assertTrue(carried[0].is_pinned)

    def test_carryover_preserves_low_priority(self):
        source = create_task_for_day(
            self.user,
            date(2026, 6, 20),
            "Someday",
            is_low_priority=True,
        )

        ensure_day(self.user, date(2026, 6, 21), today=date(2026, 6, 21))

        carried = TodoOccurrence.objects.get(
            user=self.user,
            root_id=source.root_id,
            task_date=date(2026, 6, 21),
            deleted_at__isnull=True,
        )
        self.assertTrue(carried.is_low_priority)

    def test_existing_future_carryover_tracks_pin_and_reorder_changes(self):
        first = create_task_for_day(self.user, date(2026, 6, 20), "First")
        second = create_task_for_day(self.user, date(2026, 6, 20), "Second")
        third = create_task_for_day(self.user, date(2026, 6, 20), "Third")
        ensure_day(self.user, date(2026, 6, 21), today=date(2026, 6, 21))

        update_occurrence(self.user, second.id, pinned=True)
        reorder_day(self.user, date(2026, 6, 20), [second.id, third.id, first.id])

        carried = list(
            TodoOccurrence.objects.filter(
                user=self.user,
                task_date=date(2026, 6, 21),
                deleted_at__isnull=True,
            ).order_by("-is_pinned", "sort_order", "created_at")
        )
        self.assertEqual([item.task.text for item in carried], ["Second", "Third", "First"])
        self.assertTrue(carried[0].is_pinned)

    def test_recurring_generation_preserves_latest_pin_and_order(self):
        occurrence = create_task_for_day(
            self.user,
            date(2026, 6, 20),
            "Standup",
            recurrence_kind=Task.RecurrenceKind.DAILY,
        )
        update_occurrence(self.user, occurrence.id, pinned=True)

        ensure_day(self.user, date(2026, 6, 21), today=date(2026, 6, 20))

        recurring = TodoOccurrence.objects.get(
            user=self.user,
            task_date=date(2026, 6, 21),
            root_id=occurrence.root_id,
            deleted_at__isnull=True,
        )
        occurrence.refresh_from_db()
        self.assertTrue(recurring.is_pinned)
        self.assertEqual(recurring.sort_order, occurrence.sort_order)

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

    def test_future_content_task_update_does_not_change_past_occurrence(self):
        start = create_task_for_day(
            self.user,
            date(2026, 6, 20),
            "Glasses",
            note="old note",
            content_mode=Task.ContentMode.FUTURE,
            recurrence_kind=Task.RecurrenceKind.DAILY,
        )
        ensure_range(self.user, date(2026, 6, 21), date(2026, 6, 22), today=date(2026, 6, 20))
        middle = TodoOccurrence.objects.get(root_id=start.root_id, task_date=date(2026, 6, 21))

        update_occurrence(self.user, middle.id, text="New glasses", note="new note")

        start.refresh_from_db()
        middle.refresh_from_db()
        future = TodoOccurrence.objects.get(root_id=start.root_id, task_date=date(2026, 6, 22))
        self.assertEqual(start.task.text, "Glasses")
        self.assertEqual(start.task.note, "old note")
        self.assertEqual(middle.task.text, "New glasses")
        self.assertEqual(middle.task.note, "new note")
        self.assertEqual(future.task_id, middle.task_id)

    def test_future_content_attachment_is_task_level_after_split(self):
        start = create_task_for_day(
            self.user,
            date(2026, 6, 20),
            "Outfit",
            content_mode=Task.ContentMode.FUTURE,
            recurrence_kind=Task.RecurrenceKind.DAILY,
        )
        ensure_range(self.user, date(2026, 6, 21), date(2026, 6, 22), today=date(2026, 6, 20))
        middle = TodoOccurrence.objects.get(root_id=start.root_id, task_date=date(2026, 6, 21))
        image = SimpleUploadedFile(
            "outfit.png",
            b"\x89PNG\r\n\x1a\n" + b"0" * 32,
            content_type="image/png",
        )

        with override_settings(STORAGES=TEST_STORAGES):
            attachment = add_task_attachment(self.user, middle.id, image)

            start.refresh_from_db()
            middle.refresh_from_db()
            future = TodoOccurrence.objects.get(root_id=start.root_id, task_date=date(2026, 6, 22))
            self.assertIsNone(attachment.occurrence_id)
            self.assertNotEqual(start.task_id, middle.task_id)
            self.assertEqual(future.task_id, middle.task_id)
            self.assertFalse(TaskAttachment.objects.filter(task=start.task, occurrence__isnull=True).exists())
            self.assertTrue(TaskAttachment.objects.filter(task=middle.task, occurrence__isnull=True).exists())
            attachment.file.close()

    def test_long_term_task_can_be_copied_as_regular_with_content(self):
        source = create_task_for_day(
            self.user,
            date(2026, 6, 20),
            "Outfit",
            note="linen shirt",
            content_mode=Task.ContentMode.FUTURE,
            recurrence_kind=Task.RecurrenceKind.DAILY,
        )
        image = SimpleUploadedFile(
            "outfit.png",
            b"\x89PNG\r\n\x1a\n" + b"0" * 32,
            content_type="image/png",
        )

        with override_settings(STORAGES=TEST_STORAGES):
            attachment = add_task_attachment(self.user, source.id, image)
            copied = copy_long_term_occurrence_as_regular(self.user, source.id)

            source.refresh_from_db()
            source.task.refresh_from_db()
            copied.refresh_from_db()
            copied.task.refresh_from_db()
            self.assertEqual(copied.task.text, "Outfit")
            self.assertEqual(copied.note, "linen shirt")
            self.assertEqual(copied.task.content_mode, Task.ContentMode.OCCURRENCE)
            self.assertEqual(copied.task.recurrence_kind, Task.RecurrenceKind.NONE)
            self.assertEqual(source.task.content_mode, Task.ContentMode.FUTURE)
            self.assertTrue(
                TaskAttachment.objects.filter(
                    task=copied.task,
                    occurrence=copied,
                    original_filename="outfit.png",
                ).exists()
            )
            attachment.file.close()

    def test_turning_long_term_recurring_task_regular_preserves_future_content(self):
        start = create_task_for_day(
            self.user,
            date(2026, 6, 20),
            "Glasses",
            note="try black frame",
            content_mode=Task.ContentMode.FUTURE,
            recurrence_kind=Task.RecurrenceKind.DAILY,
        )
        ensure_range(self.user, date(2026, 6, 21), date(2026, 6, 22), today=date(2026, 6, 20))
        middle = TodoOccurrence.objects.get(root_id=start.root_id, task_date=date(2026, 6, 21))
        image = SimpleUploadedFile(
            "glasses.png",
            b"\x89PNG\r\n\x1a\n" + b"0" * 32,
            content_type="image/png",
        )

        with override_settings(STORAGES=TEST_STORAGES):
            attachment = add_task_attachment(self.user, middle.id, image)

            update_occurrence(self.user, middle.id, is_long_term=False)

            middle.refresh_from_db()
            future = TodoOccurrence.objects.get(root_id=start.root_id, task_date=date(2026, 6, 22))
            future.task.refresh_from_db()
            self.assertEqual(middle.note, "try black frame")
            self.assertEqual(future.note, "try black frame")
            self.assertEqual(future.task.content_mode, Task.ContentMode.OCCURRENCE)
            self.assertTrue(TaskAttachment.objects.filter(occurrence=middle).exists())
            self.assertTrue(TaskAttachment.objects.filter(occurrence=future).exists())
            attachment.file.close()

    def test_regular_task_changed_to_long_term_carries_content_forward(self):
        source = create_task_for_day(
            self.user,
            date(2026, 6, 20),
            "Develop",
            note="keep context",
        )
        image = SimpleUploadedFile(
            "develop.png",
            b"\x89PNG\r\n\x1a\n" + b"0" * 32,
            content_type="image/png",
        )

        with override_settings(STORAGES=TEST_STORAGES):
            attachment = add_task_attachment(self.user, source.id, image)

            update_occurrence(self.user, source.id, is_long_term=True)
            ensure_day(self.user, date(2026, 6, 21), today=date(2026, 6, 21))

            source.refresh_from_db()
            source.task.refresh_from_db()
            carried = TodoOccurrence.objects.get(
                user=self.user,
                root_id=source.root_id,
                task_date=date(2026, 6, 21),
                deleted_at__isnull=True,
            )
            carried.task.refresh_from_db()
            self.assertEqual(source.task.content_mode, Task.ContentMode.FUTURE)
            self.assertEqual(source.task.recurrence_kind, Task.RecurrenceKind.DAILY)
            self.assertEqual(carried.task_id, source.task_id)
            self.assertEqual(carried.task.note, "keep context")
            self.assertTrue(
                TaskAttachment.objects.filter(
                    task=source.task,
                    occurrence__isnull=True,
                    original_filename="develop.png",
                ).exists()
            )
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

    def test_create_long_term_task_returns_future_content(self):
        response = self.client.post(
            "/api/days/2026-06-20/tasks",
            data=json.dumps(
                {
                    "text": "Outfit",
                    "note": "keep this",
                    "isLongTerm": True,
                    "repeat": {"kind": "none", "interval": 1},
                }
            ),
            content_type="application/json",
            HTTP_AUTHORIZATION=self.auth_header,
        )

        self.assertEqual(response.status_code, 201)
        body = response.json()
        self.assertTrue(body["isLongTerm"])
        self.assertTrue(body["isRecurring"])
        self.assertEqual(body["repeat"]["kind"], "daily")
        self.assertFalse(body["isLowPriority"])
        self.assertEqual(body["note"], "keep this")

    def test_low_priority_task_endpoint_sets_low_priority(self):
        response = self.client.post(
            "/api/days/2026-06-20/tasks",
            data=json.dumps({"text": "Someday", "isLowPriority": True}),
            content_type="application/json",
            HTTP_AUTHORIZATION=self.auth_header,
        )

        self.assertEqual(response.status_code, 201)
        self.assertTrue(response.json()["isLowPriority"])

    def test_long_term_patch_clears_low_priority(self):
        occurrence = create_task_for_day(
            self.user,
            date(2026, 6, 20),
            "Someday",
            is_low_priority=True,
        )

        response = self.client.patch(
            f"/api/occurrences/{occurrence.id}",
            data=json.dumps({"isLongTerm": True}),
            content_type="application/json",
            HTTP_AUTHORIZATION=self.auth_header,
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["isLongTerm"])
        self.assertFalse(body["isLowPriority"])

    def test_copy_long_term_task_endpoint_returns_regular_task(self):
        occurrence = create_task_for_day(
            self.user,
            date(2026, 6, 20),
            "Outfit",
            note="copy this",
            content_mode=Task.ContentMode.FUTURE,
            recurrence_kind=Task.RecurrenceKind.DAILY,
        )

        response = self.client.post(
            f"/api/occurrences/{occurrence.id}/copy-regular",
            HTTP_AUTHORIZATION=self.auth_header,
        )

        self.assertEqual(response.status_code, 201)
        body = response.json()
        self.assertFalse(body["isLongTerm"])
        self.assertFalse(body["isRecurring"])
        self.assertEqual(body["note"], "copy this")

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
