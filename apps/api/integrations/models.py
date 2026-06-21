import uuid

from django.conf import settings
from django.db import models


class GoogleCalendarConnection(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    calendar_id = models.CharField(max_length=255, default="primary")
    google_subject = models.CharField(max_length=255, blank=True, default="")
    google_email = models.EmailField(blank=True, default="")
    google_name = models.CharField(max_length=255, blank=True, default="")
    access_token = models.TextField()
    refresh_token = models.TextField(blank=True, default="")
    token_expires_at = models.DateTimeField(null=True, blank=True)
    scope = models.TextField(blank=True, default="")
    calendar_authorized = models.BooleanField(default=False)
    sync_enabled = models.BooleanField(default=False)
    last_sync_at = models.DateTimeField(null=True, blank=True)
    last_error = models.TextField(blank=True, default="")
    connected_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=["user", "sync_enabled"]),
            models.Index(fields=["google_email"]),
        ]

    def __str__(self) -> str:
        return f"{self.user} -> {self.calendar_id}"


class GoogleCalendarEventLink(models.Model):
    class Status(models.TextChoices):
        SYNCED = "synced", "Synced"
        ERROR = "error", "Error"
        DELETED = "deleted", "Deleted"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    task = models.ForeignKey(
        "todos.Task",
        on_delete=models.CASCADE,
        related_name="google_calendar_links",
    )
    root_id = models.UUIDField(db_index=True)
    last_synced_occurrence = models.ForeignKey(
        "todos.TodoOccurrence",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="google_calendar_sync_links",
    )
    calendar_id = models.CharField(max_length=255, default="primary")
    google_event_id = models.CharField(max_length=255, blank=True, default="")
    google_event_html_link = models.URLField(blank=True, default="")
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.SYNCED,
    )
    last_error = models.TextField(blank=True, default="")
    last_synced_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["user", "root_id"],
                name="uniq_google_calendar_link_per_root",
            )
        ]
        indexes = [
            models.Index(fields=["user", "status"]),
            models.Index(fields=["google_event_id"]),
        ]

    def __str__(self) -> str:
        return f"{self.root_id} -> {self.google_event_id or self.status}"
