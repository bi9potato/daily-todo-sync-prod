import os
import uuid

from django.conf import settings
from django.db import models
from django.db.models.signals import post_delete
from django.dispatch import receiver


def task_attachment_path(instance, filename: str) -> str:
    _, extension = os.path.splitext(filename)
    safe_extension = extension.lower()[:12]
    owner_id = instance.occurrence_id or instance.task_id
    return f"task-attachments/{instance.user_id}/{owner_id}/{instance.id}{safe_extension}"


class Task(models.Model):
    class RecurrenceKind(models.TextChoices):
        NONE = "none", "None"
        DAILY = "daily", "Daily"
        WEEKDAYS = "weekdays", "Weekdays"
        WEEKLY = "weekly", "Weekly"
        MONTHLY = "monthly", "Monthly"
        YEARLY = "yearly", "Yearly"

    class ContentMode(models.TextChoices):
        OCCURRENCE = "occurrence", "Occurrence"
        FUTURE = "future", "Future"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    root_id = models.UUIDField(db_index=True, editable=False)
    text = models.CharField(max_length=280)
    note = models.TextField(blank=True, default="")
    content_mode = models.CharField(
        max_length=16,
        choices=ContentMode.choices,
        default=ContentMode.OCCURRENCE,
    )
    reminder_time = models.TimeField(null=True, blank=True)
    recurrence_kind = models.CharField(
        max_length=16,
        choices=RecurrenceKind.choices,
        default=RecurrenceKind.NONE,
    )
    recurrence_interval = models.PositiveIntegerField(default=1)
    recurrence_days_of_week = models.JSONField(default=list, blank=True)
    recurrence_until = models.DateField(null=True, blank=True)
    recurrence_start_date = models.DateField(null=True, blank=True)
    is_archived = models.BooleanField(default=False)
    archived_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [
            models.Index(fields=["user", "deleted_at"], name="todos_task_user_id_6b794b_idx"),
            models.Index(fields=["user", "root_id"], name="todos_task_user_id_650d4e_idx"),
            models.Index(
                fields=["user", "recurrence_kind", "recurrence_start_date"],
                name="todos_task_user_id_29e252_idx",
            ),
            models.Index(
                fields=["user", "is_archived"],
                name="todos_task_user_archived_idx",
            ),
        ]

    def save(self, *args, **kwargs):
        if not self.root_id:
            self.root_id = self.id
        super().save(*args, **kwargs)

    def __str__(self) -> str:
        return self.text


class TodoOccurrence(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        DONE = "done", "Done"

    class Source(models.TextChoices):
        MANUAL = "manual", "Manual"
        CARRYOVER = "carryover", "Carryover"
        RECURRING = "recurring", "Recurring"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name="occurrences")
    root_id = models.UUIDField(db_index=True)
    task_date = models.DateField()
    note = models.TextField(blank=True, default="")
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.PENDING,
    )
    completed_at = models.DateTimeField(null=True, blank=True)
    source = models.CharField(
        max_length=16,
        choices=Source.choices,
        default=Source.MANUAL,
    )
    is_pinned = models.BooleanField(default=False)
    is_low_priority = models.BooleanField(default=False)
    sort_order = models.PositiveIntegerField(default=0)
    location_name = models.CharField(max_length=180, blank=True, default="")
    location_latitude = models.DecimalField(
        max_digits=9,
        decimal_places=6,
        null=True,
        blank=True,
    )
    location_longitude = models.DecimalField(
        max_digits=9,
        decimal_places=6,
        null=True,
        blank=True,
    )
    location_recorded_at = models.DateTimeField(null=True, blank=True)
    carryover_from_occurrence = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="carried_to_occurrences",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    version = models.PositiveIntegerField(default=1)
    client_mutation_id = models.CharField(max_length=80, null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["user", "root_id", "task_date"],
                condition=models.Q(deleted_at__isnull=True),
                name="uniq_active_occurrence_per_root_day",
            )
        ]
        indexes = [
            models.Index(
                fields=["user", "task_date", "status", "sort_order"],
                name="todos_occur_user_id_9159c1_idx",
            ),
            models.Index(
                fields=["user", "task_date", "is_low_priority", "sort_order"],
                name="todos_occur_user_id_8d18f5_idx",
            ),
            models.Index(
                fields=["user", "root_id", "task_date"],
                name="todos_occur_user_id_bfc0fa_idx",
            ),
            models.Index(fields=["deleted_at"], name="todos_occur_deleted_b8767d_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.task_date} {self.task.text}"


class TaskAttachment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name="attachments")
    occurrence = models.ForeignKey(
        TodoOccurrence,
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="attachments",
    )
    file = models.FileField(upload_to=task_attachment_path, max_length=500)
    original_filename = models.CharField(max_length=255)
    content_type = models.CharField(max_length=120)
    size_bytes = models.PositiveIntegerField()
    sort_order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(
                fields=["user", "occurrence", "sort_order"],
                name="todos_taska_user_id_21e3c9_idx",
            ),
        ]

    def __str__(self) -> str:
        return self.original_filename


@receiver(post_delete, sender=TaskAttachment)
def delete_attachment_file(sender, instance: TaskAttachment, **kwargs) -> None:
    if instance.file and not TaskAttachment.objects.filter(file=instance.file.name).exists():
        instance.file.delete(save=False)


class TodoSyncCursor(models.Model):
    """Remembers how far the daily carryover sweep has already run for a
    user so `ensure_range` only has to walk forward from the last checkpoint
    instead of replaying every day since the account's first task on every
    request. See `todos.services._rewind_sync_cursor` for how past-dated
    edits (restoring a task, reopening a completed one) roll this back so
    the next request re-heals the affected range."""

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="todo_sync_cursor",
    )
    carryover_synced_until = models.DateField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)
