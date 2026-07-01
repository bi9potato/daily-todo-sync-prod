import itertools
from datetime import date, datetime, time, timedelta

from django.db.models import Q
from django.utils import timezone

from .models import LocationPoint, MobilityRecording
from .segmentation import DEFAULT_DWELL_MINUTES, build_day_segments

# Google Takeout retired programmatic Timeline import in 2024; the closest
# still-recognized shape is the classic Semantic Location History
# "timelineObjects" structure (placeVisit / activitySegment), which the
# Google Maps app's manual "import timeline data" flow understands.
_ACTIVITY_TYPE_MAP = {
    "WALKING": "WALKING",
    "CYCLING": "CYCLING",
    "IN_VEHICLE": "IN_PASSENGER_VEHICLE",
}


def _to_e7(value: float) -> int:
    return round(value * 1e7)


def _segment_to_timeline_object(segment: dict) -> dict:
    if segment["type"] == "visit":
        return {
            "placeVisit": {
                "location": {
                    "latitudeE7": _to_e7(segment["latitude"]),
                    "longitudeE7": _to_e7(segment["longitude"]),
                },
                "duration": {
                    "startTimestamp": segment["startTime"],
                    "endTimestamp": segment["endTime"],
                },
            }
        }
    return {
        "activitySegment": {
            "startLocation": {
                "latitudeE7": _to_e7(segment["latitude"]),
                "longitudeE7": _to_e7(segment["longitude"]),
            },
            "endLocation": {
                "latitudeE7": _to_e7(segment["endLatitude"]),
                "longitudeE7": _to_e7(segment["endLongitude"]),
            },
            "duration": {
                "startTimestamp": segment["startTime"],
                "endTimestamp": segment["endTime"],
            },
            "distance": round(segment["distanceMeters"] or 0),
            "activityType": _ACTIVITY_TYPE_MAP.get(segment["mode"], "UNKNOWN_ACTIVITY_TYPE"),
        }
    }


def _group_by_local_day(points: list[LocationPoint], tz):
    def local_day(point: LocationPoint) -> date:
        return timezone.localtime(point.recorded_at, tz).date()

    for _, group in itertools.groupby(points, key=local_day):
        yield list(group)


def build_export_payload(
    user, start: date, end: date, dwell_minutes: float = DEFAULT_DWELL_MINUTES
) -> dict:
    tz = timezone.get_current_timezone()
    range_start = timezone.make_aware(datetime.combine(start, time.min), tz)
    range_end = timezone.make_aware(datetime.combine(end, time.min), tz) + timedelta(days=1)

    recording_ids = MobilityRecording.objects.filter(
        user=user,
        started_at__lt=range_end,
    ).filter(Q(ended_at__gte=range_start) | Q(ended_at__isnull=True)).values_list(
        "id", flat=True
    )
    points = list(
        LocationPoint.objects.filter(
            recording_id__in=recording_ids,
            recorded_at__gte=range_start,
            recorded_at__lt=range_end,
        ).order_by("recorded_at")
    )

    timeline_objects = []
    for day_points in _group_by_local_day(points, tz):
        for segment in build_day_segments(day_points, dwell_minutes):
            timeline_objects.append(_segment_to_timeline_object(segment))

    return {"timelineObjects": timeline_objects}
