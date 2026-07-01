import uuid

from django.conf import settings
from django.db import models


class ClientLogEntry(models.Model):
    class Level(models.TextChoices):
        DEBUG = "debug", "Debug"
        INFO = "info", "Info"
        WARN = "warn", "Warn"
        ERROR = "error", "Error"
        FATAL = "fatal", "Fatal"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="client_log_entries",
    )
    client_id = models.CharField(max_length=80)
    session_id = models.CharField(max_length=80)
    device_id = models.CharField(max_length=80, blank=True)
    level = models.CharField(max_length=12, choices=Level.choices)
    source = models.CharField(max_length=80, blank=True)
    message = models.TextField()
    stack = models.TextField(blank=True)
    context = models.JSONField(default=dict, blank=True)
    occurred_at = models.DateTimeField()
    app_version = models.CharField(max_length=40, blank=True)
    build_sha = models.CharField(max_length=80, blank=True)
    platform = models.CharField(max_length=32, blank=True)
    os_version = models.CharField(max_length=80, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["user", "client_id"],
                name="uniq_client_log_user_client_id",
            )
        ]
        indexes = [
            models.Index(fields=["user", "-occurred_at"], name="diag_log_user_time_idx"),
            models.Index(fields=["level", "-occurred_at"], name="diag_log_level_time_idx"),
            models.Index(fields=["session_id"], name="diag_log_session_idx"),
        ]
        ordering = ["-occurred_at"]
