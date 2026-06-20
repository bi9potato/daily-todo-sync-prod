import uuid

from django.conf import settings
from django.db import models


class Task(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    root_id = models.UUIDField(db_index=True, editable=False)
    text = models.CharField(max_length=280)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [
            models.Index(fields=["user", "deleted_at"]),
            models.Index(fields=["user", "root_id"]),
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

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name="occurrences")
    root_id = models.UUIDField(db_index=True)
    task_date = models.DateField()
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.PENDING,
    )
    completed_at = models.DateTimeField(null=True, blank=True)
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
            models.Index(fields=["user", "task_date", "status"]),
            models.Index(fields=["user", "root_id", "task_date"]),
            models.Index(fields=["deleted_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.task_date} {self.task.text}"

