from dataclasses import dataclass

from .geo import haversine_distance_meters, haversine_meters
from .models import LocationPoint

# Mirrors the client-side clustering thresholds used by the (now retired)
# MobilityScreen.getVisitCandidates(): points within this radius of an anchor
# are treated as "the same place", and a newly detected visit within this
# radius of the previously accepted one is folded into it rather than shown
# as a separate stop.
VISIT_RADIUS_METERS = 80
VISIT_DEDUP_RADIUS_METERS = 120
DEFAULT_DWELL_MINUTES = 5

# Rough, speed-only heuristic for a trip's mode of transport. This is not
# real activity recognition (no accelerometer/ActivityRecognition signal) -
# it only looks at the average speed across the trip's points.
WALKING_MAX_MPS = 2.2
CYCLING_MAX_MPS = 7.0
# Below this distance the average speed is dominated by GPS noise (a couple
# of drift fixes between two visits easily span 100+ meters in seconds), so
# there is not enough signal to claim anything faster than walking.
MIN_NON_WALKING_DISTANCE_METERS = 200.0


@dataclass
class Segment:
    type: str  # "visit" | "trip"
    start_index: int
    end_index: int
    start_time: str
    end_time: str
    duration_minutes: int
    latitude: float | None = None
    longitude: float | None = None
    end_latitude: float | None = None
    end_longitude: float | None = None
    distance_meters: float | None = None
    mode: str | None = None

    def as_dict(self) -> dict:
        return {
            "type": self.type,
            "startTime": self.start_time,
            "endTime": self.end_time,
            "durationMinutes": self.duration_minutes,
            "latitude": self.latitude,
            "longitude": self.longitude,
            "endLatitude": self.end_latitude,
            "endLongitude": self.end_longitude,
            "distanceMeters": self.distance_meters,
            "mode": self.mode,
        }


def _duration_minutes(points: list[LocationPoint], start_index: int, end_index: int) -> int:
    delta = points[end_index].recorded_at - points[start_index].recorded_at
    return max(0, int(delta.total_seconds() // 60))


def _infer_mode(distance_meters: float, duration_seconds: float) -> str:
    if distance_meters < MIN_NON_WALKING_DISTANCE_METERS:
        return "WALKING"
    # Use the exact duration, not minutes floored to an int: a 4.5 minute
    # walk read as 4 minutes inflates the speed enough to cross the walking
    # threshold, and a sub-minute trip floored to 0 minutes used to divide
    # by one second, labelling short strolls as cycling or driving.
    speed_mps = distance_meters / max(duration_seconds, 1.0)
    if speed_mps <= WALKING_MAX_MPS:
        return "WALKING"
    if speed_mps <= CYCLING_MAX_MPS:
        return "CYCLING"
    return "IN_VEHICLE"


def _trip_segment(points: list[LocationPoint], start_index: int, end_index: int) -> Segment | None:
    if end_index <= start_index:
        return None
    distance = sum(
        haversine_meters(first, second)
        for first, second in zip(
            points[start_index:end_index], points[start_index + 1 : end_index + 1], strict=False
        )
    )
    duration_minutes = _duration_minutes(points, start_index, end_index)
    start_point = points[start_index]
    end_point = points[end_index]
    duration_seconds = (
        end_point.recorded_at - start_point.recorded_at
    ).total_seconds()
    return Segment(
        type="trip",
        start_index=start_index,
        end_index=end_index,
        start_time=start_point.recorded_at.isoformat(),
        end_time=end_point.recorded_at.isoformat(),
        duration_minutes=duration_minutes,
        latitude=float(start_point.latitude),
        longitude=float(start_point.longitude),
        end_latitude=float(end_point.latitude),
        end_longitude=float(end_point.longitude),
        distance_meters=round(distance, 1),
        mode=_infer_mode(distance, duration_seconds),
    )


def build_day_segments(
    points: list[LocationPoint], dwell_minutes: float = DEFAULT_DWELL_MINUTES
) -> list[dict]:
    """Partition a day's ordered LocationPoints into Visit and Trip segments,
    mirroring the client's dwell-clustering heuristic (80m radius, dedup
    within 120m) while also covering the travel gaps between visits so the
    whole day is accounted for."""
    if not points:
        return []

    dwell_seconds = dwell_minutes * 60

    visits: list[tuple[int, int, LocationPoint]] = []  # (start_index, end_index, anchor)
    current: list | None = None  # mutable [start_index, end_index, anchor] while being extended

    anchor_index = 0
    index = 1
    total = len(points)
    while index <= total:
        anchor = points[anchor_index]
        point = points[index] if index < total else None
        if point is not None and haversine_distance_meters(
            float(anchor.latitude),
            float(anchor.longitude),
            float(point.latitude),
            float(point.longitude),
        ) <= VISIT_RADIUS_METERS:
            index += 1
            continue

        window_end = index - 1
        dwell_span = (points[window_end].recorded_at - anchor.recorded_at).total_seconds()
        if dwell_span >= dwell_seconds:
            if current is not None and haversine_distance_meters(
                float(current[2].latitude),
                float(current[2].longitude),
                float(anchor.latitude),
                float(anchor.longitude),
            ) <= VISIT_DEDUP_RADIUS_METERS:
                current[1] = window_end
            else:
                if current is not None:
                    visits.append(tuple(current))
                current = [anchor_index, window_end, anchor]

        anchor_index = index
        index += 1

    if current is not None:
        visits.append(tuple(current))

    segments: list[Segment] = []
    cursor = 0
    for start_index, end_index, anchor in visits:
        trip = _trip_segment(points, cursor, start_index - 1)
        if trip is not None:
            segments.append(trip)
        segments.append(
            Segment(
                type="visit",
                start_index=start_index,
                end_index=end_index,
                start_time=points[start_index].recorded_at.isoformat(),
                end_time=points[end_index].recorded_at.isoformat(),
                duration_minutes=_duration_minutes(points, start_index, end_index),
                latitude=float(anchor.latitude),
                longitude=float(anchor.longitude),
            )
        )
        cursor = end_index + 1

    trailing_trip = _trip_segment(points, cursor, total - 1)
    if trailing_trip is not None:
        segments.append(trailing_trip)

    return [segment.as_dict() for segment in segments]
