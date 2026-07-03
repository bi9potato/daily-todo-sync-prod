from haversine import Unit, haversine

from .models import LocationPoint

# GPS fixes routinely wobble by several meters even while standing still.
# Two consecutive points closer together than the sum of their reported
# accuracy radii (with a sane floor) are treated as noise rather than real
# movement, mirroring how Google Maps suppresses jitter when you are
# stationary instead of letting it silently inflate the distance walked.
GPS_NOISE_FLOOR_METERS = 8.0
# Implausibly fast legs are drift teleports, not travel - but "implausible"
# depends on how long the leg took. Within a live tracking cadence nothing
# ground-based outruns high-speed rail's ~350 km/h cruise (the old flat 55
# m/s cap silently zeroed every HSR leg and with it the whole trip's
# distance); across a long coverage gap (subway tunnel, airplane mode) the
# jump can legitimately average an airliner's ground speed.
MAX_PLAUSIBLE_SPEED_MPS = 120.0
MAX_PLAUSIBLE_GAP_SPEED_MPS = 280.0
PLAUSIBILITY_GAP_SECONDS = 150.0


def haversine_distance_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    return haversine((lat1, lon1), (lat2, lon2), unit=Unit.METERS)


# While the phone sits still, fixes wobble inside their accuracy radius for
# hours; summed leg-by-leg that random walk fabricates tens of kilometers a
# day. Before segmenting or displaying a track we therefore drop every fix
# that did not move beyond the combined uncertainty of itself and the last
# kept fix - the same accept-only-past-reported-accuracy rule OwnTracks and
# Traccar apply server-side. One sample per keepalive window is kept anyway
# (raw coordinates, no fabrication) so stop detection still sees how long
# the dwell lasted.
STATIONARY_KEEPALIVE_SECONDS = 300.0
# The movement floor above is the *sum* of both fixes' accuracy radii, so a
# pair of trusted-but-coarse fixes (30-50m each) demanded 60-100m of travel
# before a point counted as movement. On a real walk sampled every few
# seconds that dropped almost every intermediate fix, leaving a sparse,
# corner-cutting polyline and too few points for the leg to register as a
# trip at all. Capping each fix's contribution keeps the floor high enough to
# swallow genuine standstill jitter (a still phone rarely wanders past ~40m)
# while letting a moving one keep its shape. Distance stays protected
# separately by haversine_meters(), which still uses the uncapped radii, so
# densifying the kept track cannot fabricate distance.
ACCURACY_NOISE_CAP_METERS = 20.0
# Nothing the app can record travels faster than an airliner; a shorter leg
# implying more than this is a corrupted fix.
GLITCH_SPEED_MPS = 350.0
# Fixes coarser than this are wifi/cell positions that scatter hundreds of
# meters (Traccar's filter.accuracy, and the same cutoff the Android service
# applies at capture). Old recordings made before the on-device gate existed
# still hold such fixes, so the server must drop them on read as well.
MAX_TRUSTED_ACCURACY_METERS = 50.0


def thin_stationary_points(points: list[LocationPoint]) -> list[LocationPoint]:
    points = [
        point
        for point in points
        if (point.accuracy or 0) <= MAX_TRUSTED_ACCURACY_METERS
    ]
    if not points:
        return []
    kept = [points[0]]
    anchor = points[0]
    last_kept_at = points[0].recorded_at
    for point in points[1:]:
        gap_seconds = (point.recorded_at - last_kept_at).total_seconds()
        distance = haversine_distance_meters(
            float(anchor.latitude),
            float(anchor.longitude),
            float(point.latitude),
            float(point.longitude),
        )
        moved = distance >= max(
            GPS_NOISE_FLOOR_METERS,
            min(anchor.accuracy or 0, ACCURACY_NOISE_CAP_METERS)
            + min(point.accuracy or 0, ACCURACY_NOISE_CAP_METERS),
        )
        if moved and distance / max(gap_seconds, 1.0) > GLITCH_SPEED_MPS:
            continue
        if moved:
            anchor = point
        elif gap_seconds < STATIONARY_KEEPALIVE_SECONDS:
            continue
        kept.append(point)
        last_kept_at = point.recorded_at
    return kept


def haversine_meters(first: LocationPoint, second: LocationPoint) -> float:
    distance = haversine_distance_meters(
        float(first.latitude),
        float(first.longitude),
        float(second.latitude),
        float(second.longitude),
    )

    # Capped the same way as the thinning floor: without it, a leg between two
    # trusted-but-coarse (30-50m) fixes was zeroed unless it spanned 60-100m,
    # so a genuine walk kept by thinning still contributed 0 distance and read
    # as "步行 · 0.00 公里". Stationary wobble stays at 0 (a still phone rarely
    # wanders past the ~40m capped floor), and day distance only sums trip
    # segments, so stops can't fabricate distance regardless.
    noise_floor = max(
        GPS_NOISE_FLOOR_METERS,
        min(first.accuracy or 0, ACCURACY_NOISE_CAP_METERS)
        + min(second.accuracy or 0, ACCURACY_NOISE_CAP_METERS),
    )
    if distance < noise_floor:
        return 0

    elapsed = max((second.recorded_at - first.recorded_at).total_seconds(), 1)
    speed_cap = (
        MAX_PLAUSIBLE_GAP_SPEED_MPS
        if elapsed >= PLAUSIBILITY_GAP_SECONDS
        else MAX_PLAUSIBLE_SPEED_MPS
    )
    return distance if distance / elapsed <= speed_cap else 0
