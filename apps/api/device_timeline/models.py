import uuid

from django.conf import settings
from django.db import models


class DeviceTimelineEvent(models.Model):
    """A single raw signal from the Android device-timeline foreground
    service: a screen lock/unlock transition, a shutdown/boot, or a change
    of which app is in the foreground. Kept as one flat event stream (like
    LocationPoint for mobility) so the day view can be rebuilt from scratch
    at read time - see segmentation.py for how these collapse into the
    chronological timeline the app actually displays."""

    class EventType(models.TextChoices):
        APP_FOREGROUND = "app_foreground", "App foreground"
        SCREEN_ON = "screen_on", "Screen on"
        SCREEN_OFF = "screen_off", "Screen off"
        UNLOCK = "unlock", "Unlock"
        SHUTDOWN = "shutdown", "Shutdown"
        BOOT = "boot", "Boot"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="device_timeline_events",
    )
    # The client generates this (see reverse-geocode/mobility's clientId
    # pattern) so a retried upload after a network failure is naturally
    # deduped by the database instead of double-counting the same event.
    client_id = models.CharField(max_length=120)
    event_type = models.CharField(max_length=16, choices=EventType.choices)
    occurred_at = models.DateTimeField()
    # Only set for APP_FOREGROUND events.
    package_name = models.CharField(max_length=200, blank=True, default="")
    app_label = models.CharField(max_length=200, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["occurred_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["user", "client_id"],
                name="uniq_device_timeline_event_client_id",
            ),
        ]
        indexes = [
            models.Index(
                fields=["user", "occurred_at"],
                name="device_tl_user_occurred_idx",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.event_type} @ {self.occurred_at.isoformat()}"
