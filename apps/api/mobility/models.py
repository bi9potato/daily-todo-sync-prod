import uuid

from django.conf import settings
from django.db import models


class MobilityRecording(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="mobility_recordings",
    )
    started_at = models.DateTimeField()
    ended_at = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    step_count = models.PositiveIntegerField(default=0)
    distance_meters = models.FloatField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["user"],
                condition=models.Q(is_active=True),
                name="uniq_active_mobility_recording",
            )
        ]
        indexes = [
            models.Index(
                fields=["user", "started_at"],
                name="mobility_rec_user_started_idx",
            )
        ]


class LocationPoint(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    recording = models.ForeignKey(
        MobilityRecording,
        on_delete=models.CASCADE,
        related_name="points",
    )
    client_id = models.CharField(max_length=120)
    recorded_at = models.DateTimeField()
    latitude = models.DecimalField(max_digits=9, decimal_places=6)
    longitude = models.DecimalField(max_digits=9, decimal_places=6)
    accuracy = models.FloatField(null=True, blank=True)
    altitude = models.FloatField(null=True, blank=True)
    speed = models.FloatField(null=True, blank=True)
    heading = models.FloatField(null=True, blank=True)
    activity_type = models.CharField(max_length=24, blank=True, default="")
    place_name = models.CharField(max_length=180, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["recording", "client_id"],
                name="uniq_location_point_client_id",
            )
        ]
        indexes = [
            models.Index(
                fields=["recording", "recorded_at"],
                name="mobility_point_rec_time_idx",
            )
        ]
        ordering = ["recorded_at"]


class StepSample(models.Model):
    recording = models.ForeignKey(
        MobilityRecording,
        on_delete=models.CASCADE,
        related_name="step_samples",
    )
    source_id = models.CharField(max_length=100)
    step_count = models.PositiveIntegerField(default=0)
    recorded_at = models.DateTimeField()
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["recording", "source_id"],
                name="uniq_step_sample_source",
            )
        ]
