from bisect import bisect_left, bisect_right
from dataclasses import dataclass
from datetime import UTC, timedelta
from statistics import median, quantiles

import geopandas as gpd
import movingpandas as mpd
import pandas as pd
from shapely.geometry import Point

from .geo import (
    ACCURACY_NOISE_CAP_METERS,
    haversine_distance_meters,
    haversine_meters,
    points_distance_meters,
    thin_stationary_points,
)
from .models import LocationPoint

RECOGNIZED_MODE_MAP = {
    "WALKING": "WALKING",
    "RUNNING": "WALKING",
    "ON_BICYCLE": "CYCLING",
    "IN_VEHICLE": "IN_VEHICLE",
}
MIN_RECOGNIZED_ACTIVITY_SAMPLES = 3
MIN_RECOGNIZED_ACTIVITY_SHARE = 0.6

# Points within this distance of where a stop began are treated as "the
# same place" (movingpandas' stop detector measures it as the max diameter
# of the stop), and a newly detected visit within the dedup radius of the
# previously accepted one is folded into it rather than shown as a separate
# stop.
VISIT_RADIUS_METERS = 80
VISIT_DEDUP_RADIUS_METERS = 120
DEFAULT_DWELL_MINUTES = 5

# A "trip" whose noise-floored path length stays under this never left the
# vicinity of a stop: it is the residue of stop detection splitting on a
# little wobble, not travel. Emitting those used to show phantom walks (with
# a ~0.0 km distance) on days the phone never moved. Genuine surfaced walks -
# even a stroll around the block - cover hundreds of meters.
MIN_TRIP_DISTANCE_METERS = 30.0

# Rough, speed-only heuristic for a trip's mode of transport. This is not
# real activity recognition (no accelerometer/ActivityRecognition signal) -
# it only looks at how fast the trip moved.
WALKING_MAX_MPS = 2.2
CYCLING_MAX_MPS = 7.0
# Below this distance the average speed is dominated by GPS noise (a couple
# of drift fixes between two visits easily span 100+ meters in seconds), so
# there is not enough signal to claim anything faster than walking.
MIN_NON_WALKING_DISTANCE_METERS = 200.0
# The Android service stores each fix's Doppler speed (LocationPoint.speed),
# which stays near zero while standing still even when the reported position
# drifts hundreds of meters. When enough fixes carry it, classifying from
# those measurements beats dividing (possibly drift-inflated) displacement
# by time. The median gives the sustained pace; vehicles are recognised by
# their bursts instead, because stop-and-go traffic keeps the median of a
# bus or car ride down at bicycle pace while the stretches between stops
# still hit speeds no city cyclist sustains.
VEHICLE_PEAK_MPS = 10.0
MIN_SPEED_SAMPLES = 5
SPEED_SAMPLE_MAX_ACCURACY_METERS = 30.0

# Rail and air separate from road vehicles by sustained speed alone: China's
# highway limit is 120 km/h, so a p90 fix speed past ~137 km/h means rails,
# past ~200 km/h it can only be the high-speed network's 250-350 cruise band,
# and nothing ground-based sustains 360+ km/h at all. Driver vs passenger in
# a road vehicle is indistinguishable from GPS, so "IN_VEHICLE" stays one
# bucket.
TRAIN_PEAK_MPS = 38.0
HIGH_SPEED_RAIL_PEAK_MPS = 55.0
FLIGHT_MPS = 100.0

# A vehicle ride through a GPS-less stretch (subway, tunnel) records no fixes
# while covering real distance, so the trace shows long time gaps that "jump"
# far. Doppler speeds then only sample the walk to/from the outage (station
# entrances), which drags the median down to walking pace. Legs at least this
# long and far count as coverage outages; when they carry most of the trip's
# distance and the pace implied across them is beyond walking, the trip was a
# ride, whatever the fringe Doppler samples say.
GPS_OUTAGE_MIN_GAP_SECONDS = 150.0
GPS_OUTAGE_MIN_JUMP_METERS = 400.0
GPS_OUTAGE_DISTANCE_SHARE = 0.5
# Metro trains average under ~80 km/h between stations including dwell, so an
# outage-dominated ride at that implied pace is the subway; faster implied
# paces through dead zones belong to rail lines (tunnels) or aircraft.
SUBWAY_OUTAGE_MAX_MPS = 22.0


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


def _outage_ride_mode(
    distance_meters: float, legs: list[tuple[float, float]]
) -> str | None:
    """Classify a trip whose distance was mostly covered inside GPS coverage
    outages, by the pace implied across those outages: metro pace means the
    subway, faster means rail through tunnels, and beyond anything
    ground-based means a flight. Returns None when outages don't dominate or
    the implied pace stays at walking speed (a long underground walkway also
    loses GPS) - the trip is then classified from speeds as usual."""
    outage_seconds = 0.0
    outage_meters = 0.0
    for gap_seconds, gap_meters in legs:
        if (
            gap_seconds >= GPS_OUTAGE_MIN_GAP_SECONDS
            and gap_meters >= GPS_OUTAGE_MIN_JUMP_METERS
        ):
            outage_seconds += gap_seconds
            outage_meters += gap_meters
    if outage_meters <= 0 or distance_meters <= 0:
        return None
    if outage_meters / distance_meters < GPS_OUTAGE_DISTANCE_SHARE:
        return None
    implied_mps = outage_meters / max(outage_seconds, 1.0)
    if implied_mps <= WALKING_MAX_MPS:
        return None
    if implied_mps <= SUBWAY_OUTAGE_MAX_MPS:
        return "SUBWAY"
    if implied_mps <= HIGH_SPEED_RAIL_PEAK_MPS:
        return "TRAIN"
    if implied_mps <= FLIGHT_MPS:
        return "HIGH_SPEED_RAIL"
    return "FLIGHT"


def _infer_mode(
    distance_meters: float,
    duration_seconds: float,
    recorded_speeds: list[float],
    legs: list[tuple[float, float]] | None = None,
) -> str:
    if distance_meters < MIN_NON_WALKING_DISTANCE_METERS:
        return "WALKING"
    # Checked before the Doppler medians: during an outage there are no
    # Doppler samples at all, so the samples that do exist are not
    # representative of how the trip actually moved.
    outage_mode = _outage_ride_mode(distance_meters, legs or [])
    if outage_mode is not None:
        return outage_mode
    if len(recorded_speeds) >= MIN_SPEED_SAMPLES:
        peak_mps = quantiles(recorded_speeds, n=10, method="inclusive")[-1]
        if peak_mps > FLIGHT_MPS:
            return "FLIGHT"
        if peak_mps >= HIGH_SPEED_RAIL_PEAK_MPS:
            return "HIGH_SPEED_RAIL"
        if peak_mps >= TRAIN_PEAK_MPS:
            return "TRAIN"
        if peak_mps >= VEHICLE_PEAK_MPS:
            return "IN_VEHICLE"
        # A congested ride spends most fixes crawling, so its Doppler
        # median sits at walking pace while the trip still crosses half
        # the city. Sustained ground coverage beyond cycling pace is
        # vehicular whatever the median said. Below that bar the median
        # wins: position drift fakes cycling-pace displacement while
        # Doppler correctly reads near-zero.
        floor_mps = distance_meters / max(duration_seconds, 1.0)
        if floor_mps > CYCLING_MAX_MPS:
            return "IN_VEHICLE"
        median_mps = median(recorded_speeds)
        if median_mps <= WALKING_MAX_MPS:
            return "WALKING"
        if median_mps <= CYCLING_MAX_MPS:
            return "CYCLING"
        return "IN_VEHICLE"
    # No usable Doppler speeds (older points, or the device withheld them):
    # fall back to displacement over the exact duration. Not minutes floored
    # to an int - a 4.5 minute walk read as 4 minutes inflates the speed
    # enough to cross the walking threshold, and a sub-minute trip floored
    # to 0 minutes used to divide by one second, labelling short strolls as
    # cycling or driving.
    speed_mps = distance_meters / max(duration_seconds, 1.0)
    if speed_mps <= WALKING_MAX_MPS:
        return "WALKING"
    if speed_mps <= CYCLING_MAX_MPS:
        return "CYCLING"
    if speed_mps <= TRAIN_PEAK_MPS:
        return "IN_VEHICLE"
    if speed_mps <= HIGH_SPEED_RAIL_PEAK_MPS:
        return "TRAIN"
    if speed_mps <= FLIGHT_MPS:
        return "HIGH_SPEED_RAIL"
    return "FLIGHT"


def _recognized_mode(points: list[LocationPoint]) -> str | None:
    """Return a stable Android Activity Recognition mode when one signal
    covers most fixes in the trip. Transition events are copied onto each
    location fix by the Android service, so counting fixes approximates time
    spent in each activity without trusting a single noisy transition."""
    counts: dict[str, int] = {}
    for point in points:
        mode = RECOGNIZED_MODE_MAP.get(point.activity_type)
        if mode:
            counts[mode] = counts.get(mode, 0) + 1
    sample_count = sum(counts.values())
    if sample_count < MIN_RECOGNIZED_ACTIVITY_SAMPLES:
        return None
    mode, count = max(counts.items(), key=lambda item: item[1])
    if count / sample_count < MIN_RECOGNIZED_ACTIVITY_SHARE:
        return None
    return mode


def _trip_segment(points: list[LocationPoint], start_index: int, end_index: int) -> Segment | None:
    if end_index <= start_index:
        return None
    legs = [
        (
            max((second.recorded_at - first.recorded_at).total_seconds(), 0.0),
            haversine_meters(first, second),
        )
        for first, second in zip(
            points[start_index:end_index], points[start_index + 1 : end_index + 1], strict=False
        )
    ]
    distance = sum(meters for _seconds, meters in legs)
    duration_minutes = _duration_minutes(points, start_index, end_index)
    start_point = points[start_index]
    end_point = points[end_index]
    duration_seconds = (
        end_point.recorded_at - start_point.recorded_at
    ).total_seconds()
    # Doppler speed is only trustworthy on a solid GPS fix; wifi/cell
    # positions report junk speeds that skew the p90/median mode ladder.
    # If filtering leaves too few samples, _infer_mode's displacement
    # fallback takes over rather than classifying from noise.
    recorded_speeds = [
        float(point.speed)
        for point in points[start_index : end_index + 1]
        if point.speed is not None
        and point.speed >= 0
        and (point.accuracy is None or point.accuracy <= SPEED_SAMPLE_MAX_ACCURACY_METERS)
    ]
    inferred_mode = _infer_mode(distance, duration_seconds, recorded_speeds, legs)
    recognized_mode = _recognized_mode(points[start_index : end_index + 1])
    # Activity Recognition is authoritative for the ambiguous ground modes
    # that GPS speed routinely confuses. Keep the speed-derived rail/flight
    # modes because the Android API intentionally reports all of them as the
    # broader IN_VEHICLE category.
    mode = (
        recognized_mode
        if recognized_mode is not None
        and inferred_mode in {"WALKING", "CYCLING", "IN_VEHICLE"}
        else inferred_mode
    )
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
        mode=mode,
    )


def _detect_visit_windows(
    points: list[LocationPoint], dwell_minutes: float
) -> list[tuple[int, int]]:
    """Find (start_index, end_index) windows where the trajectory stayed
    put, using movingpandas' stop detector. Timestamps are converted to
    naive UTC up front because Trajectory drops timezone info anyway (and
    warns about it), and the naive values are what the returned stop ranges
    are mapped back against."""
    if len(points) < 2:
        return []
    times = [
        point.recorded_at.astimezone(UTC).replace(tzinfo=None) for point in points
    ]
    frame = gpd.GeoDataFrame(
        {
            "geometry": [
                Point(float(point.longitude), float(point.latitude))
                for point in points
            ]
        },
        index=pd.DatetimeIndex(times),
        crs="EPSG:4326",
    )
    detector = mpd.TrajectoryStopDetector(mpd.Trajectory(frame, traj_id=0))
    stop_ranges = detector.get_stop_time_ranges(
        max_diameter=VISIT_RADIUS_METERS,
        min_duration=timedelta(minutes=dwell_minutes),
    )
    windows: list[tuple[int, int]] = []
    for stop in stop_ranges:
        start_index = bisect_left(times, stop.t_0.to_pydatetime())
        end_index = bisect_right(times, stop.t_n.to_pydatetime()) - 1
        if 0 <= start_index <= end_index < len(points):
            windows.append((start_index, end_index))
    return windows


def _merge_nearby_visits(
    points: list[LocationPoint], windows: list[tuple[int, int]]
) -> list[tuple[int, int]]:
    """Fold a visit into the previous one when their anchors are within the
    dedup radius, so wobbling in and out of one place doesn't show up as a
    string of separate stops.

    But only when the traveller never actually left in between: if a fix
    between the two stops strayed past the dedup radius, it was a real outing
    (a walk around the block and back), not the stop detector splitting one
    continuous stay on a little wobble. Collapsing those two stops would
    silently swallow the walk between them; keeping them separate lets the
    trip surface, the same leave-and-return Google Timeline shows.

    "Strayed past" is measured with both fixes' (capped) accuracy radii added
    on top of the dedup radius: a coarse fix already wobbles that far while
    standing still, and treating it as a departure fabricated an outing - and
    with it a phantom walk - out of pure measurement noise."""
    merged: list[tuple[int, int]] = []
    for start_index, end_index in windows:
        if merged:
            previous_start, previous_end = merged[-1]
            previous_anchor = points[previous_start]
            anchor = points[start_index]
            anchors_close = (
                points_distance_meters(previous_anchor, anchor)
                <= VISIT_DEDUP_RADIUS_METERS
            )
            left_and_returned = any(
                points_distance_meters(previous_anchor, points[between])
                > VISIT_DEDUP_RADIUS_METERS
                + min(previous_anchor.accuracy or 0, ACCURACY_NOISE_CAP_METERS)
                + min(points[between].accuracy or 0, ACCURACY_NOISE_CAP_METERS)
                for between in range(previous_end + 1, start_index)
            )
            if anchors_close and not left_and_returned:
                merged[-1] = (previous_start, end_index)
                continue
        merged.append((start_index, end_index))
    return merged


def segment_day(
    points: list[LocationPoint], dwell_minutes: float = DEFAULT_DWELL_MINUTES
) -> tuple[list[LocationPoint], list[Segment]]:
    """Partition a day's ordered LocationPoints into Visit and Trip segments
    (stop detection by movingpandas, dedup within 120m) while also covering
    the travel gaps between visits so the whole day is accounted for.
    Returns the noise-thinned track alongside the segments, whose indices
    refer into that track.

    The track is noise-thinned first: coarse wifi/cell fixes and stationary
    wobble would otherwise fragment stop detection and inflate every trip's
    distance (and with it the inferred mode)."""
    points = thin_stationary_points(points)
    if not points:
        return [], []

    visits = _merge_nearby_visits(points, _detect_visit_windows(points, dwell_minutes))

    def significant(trip: Segment | None) -> Segment | None:
        if trip is None or (trip.distance_meters or 0.0) < MIN_TRIP_DISTANCE_METERS:
            return None
        return trip

    segments: list[Segment] = []
    cursor = 0
    for start_index, end_index in visits:
        trip = significant(_trip_segment(points, cursor, start_index - 1))
        if trip is not None:
            segments.append(trip)
        anchor = points[start_index]
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

    trailing_trip = significant(_trip_segment(points, cursor, len(points) - 1))
    if trailing_trip is not None:
        segments.append(trailing_trip)

    return points, segments


def build_day_segments(
    points: list[LocationPoint], dwell_minutes: float = DEFAULT_DWELL_MINUTES
) -> list[dict]:
    _, segments = segment_day(points, dwell_minutes)
    return [segment.as_dict() for segment in segments]


def build_route_points(
    points: list[LocationPoint], segments: list[Segment]
) -> list[dict]:
    """Flatten a segmented day back into the polyline the map draws and the
    playback dot follows. A visit contributes its anchor twice - once at the
    stay's start and once at its end - so each stay renders as a single
    stable point and playback dwells there for the visit's real duration,
    while a trip contributes its GPS fixes unchanged. Drawing every raw fix
    used to scribble hours of residual stationary wobble over each stay,
    which made the route look wrong even after thinning. Points that belong
    to no segment (a suppressed noise trip) are dropped with it.

    A day whose points never formed a segment (too short or too sparse for
    stop detection) falls back to the thinned track, so the map still shows
    what exists."""

    def serialize(point: LocationPoint, recorded_at=None) -> dict:
        return {
            "recordedAt": (recorded_at or point.recorded_at).isoformat(),
            "latitude": float(point.latitude),
            "longitude": float(point.longitude),
            "accuracy": point.accuracy,
            "speed": point.speed,
            "placeName": point.place_name,
        }

    if not segments:
        return [serialize(point) for point in points]
    route: list[dict] = []
    for segment in segments:
        if segment.type == "visit":
            anchor = points[segment.start_index]
            route.append(serialize(anchor))
            if segment.end_index > segment.start_index:
                route.append(
                    serialize(
                        anchor, recorded_at=points[segment.end_index].recorded_at
                    )
                )
        else:
            route.extend(
                serialize(point)
                for point in points[segment.start_index : segment.end_index + 1]
            )
    return route
