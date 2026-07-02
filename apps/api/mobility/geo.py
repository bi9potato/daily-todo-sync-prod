from haversine import Unit, haversine

from .models import LocationPoint

# GPS fixes routinely wobble by several meters even while standing still.
# Two consecutive points closer together than the sum of their reported
# accuracy radii (with a sane floor) are treated as noise rather than real
# movement, mirroring how Google Maps suppresses jitter when you are
# stationary instead of letting it silently inflate the distance walked.
GPS_NOISE_FLOOR_METERS = 8.0
MAX_PLAUSIBLE_SPEED_MPS = 55.0


def haversine_distance_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    return haversine((lat1, lon1), (lat2, lon2), unit=Unit.METERS)


def haversine_meters(first: LocationPoint, second: LocationPoint) -> float:
    distance = haversine_distance_meters(
        float(first.latitude),
        float(first.longitude),
        float(second.latitude),
        float(second.longitude),
    )

    noise_floor = max(
        GPS_NOISE_FLOOR_METERS,
        (first.accuracy or 0) + (second.accuracy or 0),
    )
    if distance < noise_floor:
        return 0

    elapsed = max((second.recorded_at - first.recorded_at).total_seconds(), 1)
    return distance if distance / elapsed <= MAX_PLAUSIBLE_SPEED_MPS else 0
