import math
from datetime import date, datetime, time, timedelta
from uuid import UUID

from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from ninja import Router, Schema
from ninja.errors import HttpError

from accounts.authentication import bearer_auth

from .models import LocationPoint, MobilityRecording, StepSample

router = Router(tags=["mobility"])


class LocationPointIn(Schema):
    clientId: str
    recordedAt: datetime
    latitude: float
    longitude: float
    accuracy: float | None = None
    altitude: float | None = None
    speed: float | None = None
    heading: float | None = None
    placeName: str = ""


class LocationBatchIn(Schema):
    points: list[LocationPointIn]


class StepSampleIn(Schema):
    sourceId: str
    stepCount: int
    recordedAt: datetime


class LocationPointOut(Schema):
    recordedAt: str
    latitude: float
    longitude: float
    accuracy: float | None
    speed: float | None
    placeName: str


class MobilityRecordingOut(Schema):
    id: str
    startedAt: str
    endedAt: str | None
    isActive: bool
    stepCount: int
    distanceMeters: float
    durationMinutes: int


class MobilityDayOut(Schema):
    date: str
    stepCount: int
    distanceMeters: float
    durationMinutes: int
    activeRecording: MobilityRecordingOut | None
    recordings: list[MobilityRecordingOut]
    points: list[LocationPointOut]


def serialize_recording(recording: MobilityRecording, now=None) -> dict:
    effective_end = recording.ended_at or now or timezone.now()
    duration = max(0, int((effective_end - recording.started_at).total_seconds() // 60))
    return {
        "id": str(recording.id),
        "startedAt": recording.started_at.isoformat(),
        "endedAt": recording.ended_at.isoformat() if recording.ended_at else None,
        "isActive": recording.is_active,
        "stepCount": recording.step_count,
        "distanceMeters": round(recording.distance_meters, 1),
        "durationMinutes": duration,
    }


def day_bounds(day: date):
    current_timezone = timezone.get_current_timezone()
    start = timezone.make_aware(datetime.combine(day, time.min), current_timezone)
    return start, start + timedelta(days=1)


# GPS fixes routinely wobble by several meters even while standing still.
# Two consecutive points closer together than the sum of their reported
# accuracy radii (with a sane floor) are treated as noise rather than real
# movement, mirroring how Google Maps suppresses jitter when you are
# stationary instead of letting it silently inflate the distance walked.
GPS_NOISE_FLOOR_METERS = 8.0
MAX_PLAUSIBLE_SPEED_MPS = 55.0


def haversine_meters(first: LocationPoint, second: LocationPoint) -> float:
    earth_radius = 6_371_000
    lat1 = math.radians(float(first.latitude))
    lat2 = math.radians(float(second.latitude))
    delta_lat = lat2 - lat1
    delta_lon = math.radians(float(second.longitude) - float(first.longitude))
    value = (
        math.sin(delta_lat / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin(delta_lon / 2) ** 2
    )
    distance = 2 * earth_radius * math.asin(math.sqrt(value))

    noise_floor = max(
        GPS_NOISE_FLOOR_METERS,
        (first.accuracy or 0) + (second.accuracy or 0),
    )
    if distance < noise_floor:
        return 0

    elapsed = max((second.recorded_at - first.recorded_at).total_seconds(), 1)
    return distance if distance / elapsed <= MAX_PLAUSIBLE_SPEED_MPS else 0


def recalculate_distance(recording: MobilityRecording) -> None:
    points = list(recording.points.only("latitude", "longitude", "recorded_at"))
    distance = sum(
        haversine_meters(first, second)
        for first, second in zip(points, points[1:], strict=False)
    )
    recording.distance_meters = round(distance, 1)
    recording.save(update_fields=["distance_meters", "updated_at"])


@router.get("/days/{day}", response=MobilityDayOut, auth=bearer_auth)
def get_mobility_day(request, day: date):
    start, end = day_bounds(day)
    recordings = list(
        MobilityRecording.objects.filter(
            user=request.auth,
            started_at__lt=end,
        )
        .filter(ended_at__gte=start)
        .order_by("started_at")
    )
    recordings.extend(
        MobilityRecording.objects.filter(
            user=request.auth,
            started_at__lt=end,
            ended_at__isnull=True,
        ).exclude(id__in=[item.id for item in recordings])
    )
    recordings.sort(key=lambda item: item.started_at)
    recording_ids = [item.id for item in recordings]
    points = LocationPoint.objects.filter(
        recording_id__in=recording_ids,
        recorded_at__gte=start,
        recorded_at__lt=end,
    ).order_by("recorded_at")
    serialized_recordings = [serialize_recording(item) for item in recordings]
    active = next((item for item in recordings if item.is_active), None)
    return {
        "date": day.isoformat(),
        "stepCount": sum(item.step_count for item in recordings),
        "distanceMeters": round(sum(item.distance_meters for item in recordings), 1),
        "durationMinutes": sum(item["durationMinutes"] for item in serialized_recordings),
        "activeRecording": serialize_recording(active) if active else None,
        "recordings": serialized_recordings,
        "points": [
            {
                "recordedAt": point.recorded_at.isoformat(),
                "latitude": float(point.latitude),
                "longitude": float(point.longitude),
                "accuracy": point.accuracy,
                "speed": point.speed,
                "placeName": point.place_name,
            }
            for point in points
        ],
    }


@router.post(
    "/recordings/start",
    response={201: MobilityRecordingOut},
    auth=bearer_auth,
)
@transaction.atomic
def start_recording(request):
    active = (
        MobilityRecording.objects.select_for_update()
        .filter(user=request.auth, is_active=True)
        .first()
    )
    if active:
        return 201, serialize_recording(active)
    recording = MobilityRecording.objects.create(
        user=request.auth,
        started_at=timezone.now(),
    )
    return 201, serialize_recording(recording)


@router.post(
    "/recordings/{recording_id}/stop",
    response=MobilityRecordingOut,
    auth=bearer_auth,
)
@transaction.atomic
def stop_recording(request, recording_id: UUID):
    recording = get_object_or_404(
        MobilityRecording.objects.select_for_update(),
        id=recording_id,
        user=request.auth,
    )
    if recording.is_active:
        recording.is_active = False
        recording.ended_at = timezone.now()
        recording.save(update_fields=["is_active", "ended_at", "updated_at"])
    return serialize_recording(recording)


@router.post(
    "/recordings/{recording_id}/points",
    response=MobilityRecordingOut,
    auth=bearer_auth,
)
@transaction.atomic
def add_points(request, recording_id: UUID, payload: LocationBatchIn):
    if not payload.points or len(payload.points) > 250:
        raise HttpError(400, "Provide between 1 and 250 location points.")
    recording = get_object_or_404(
        MobilityRecording.objects.select_for_update(),
        id=recording_id,
        user=request.auth,
    )
    points = []
    for point in payload.points:
        if not -90 <= point.latitude <= 90 or not -180 <= point.longitude <= 180:
            raise HttpError(400, "A location point is invalid.")
        if point.accuracy is not None and point.accuracy > 500:
            continue
        points.append(
            LocationPoint(
                recording=recording,
                client_id=point.clientId[:120],
                recorded_at=point.recordedAt,
                latitude=point.latitude,
                longitude=point.longitude,
                accuracy=point.accuracy,
                altitude=point.altitude,
                speed=point.speed,
                heading=point.heading,
                place_name=point.placeName.strip()[:180],
            )
        )
    LocationPoint.objects.bulk_create(points, ignore_conflicts=True)
    recalculate_distance(recording)
    recording.refresh_from_db()
    return serialize_recording(recording)


@router.put(
    "/recordings/{recording_id}/steps",
    response=MobilityRecordingOut,
    auth=bearer_auth,
)
@transaction.atomic
def set_step_sample(request, recording_id: UUID, payload: StepSampleIn):
    if payload.stepCount < 0:
        raise HttpError(400, "Step count cannot be negative.")
    recording = get_object_or_404(
        MobilityRecording.objects.select_for_update(),
        id=recording_id,
        user=request.auth,
    )
    source_id = payload.sourceId[:100]
    is_health_connect = source_id == "health-connect"
    health_connect_exists = recording.step_samples.filter(
        source_id="health-connect"
    ).exists()
    if health_connect_exists and not is_health_connect:
        return serialize_recording(recording)
    if is_health_connect:
        recording.step_samples.exclude(source_id="health-connect").delete()
    sample, _ = StepSample.objects.get_or_create(
        recording=recording,
        source_id=source_id,
        defaults={
            "step_count": payload.stepCount,
            "recorded_at": payload.recordedAt,
        },
    )
    if is_health_connect or payload.stepCount > sample.step_count:
        sample.step_count = payload.stepCount
        sample.recorded_at = payload.recordedAt
        sample.save(update_fields=["step_count", "recorded_at", "updated_at"])
    recording.step_count = sum(
        recording.step_samples.values_list("step_count", flat=True)
    )
    recording.save(update_fields=["step_count", "updated_at"])
    return serialize_recording(recording)
