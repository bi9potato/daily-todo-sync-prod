from .models import DeviceTimelineEvent

# Repeated foreground-app pings for the app already on top are throttled to
# roughly this cadence by the client (see DeviceTimelineService.kt); a much
# larger gap between two same-package pings than that means the phone was
# almost certainly not being actively tracked in between (e.g. the service
# was killed and only restarted later), so the segment is closed at the
# older timestamp instead of silently stretching across the gap.
MAX_SEGMENT_GAP_SECONDS = 300


def build_day_timeline(events: list[DeviceTimelineEvent]) -> list[dict]:
    """Collapse a raw, chronologically-ordered event stream into the mixed
    list of app-usage duration segments and instantaneous screen/power
    markers the timeline UI renders - the same grouping ActivityWatch's
    timeline view applies to raw window-focus events: consecutive pings for
    the same foreground app become one "used X from t1 to t2" bar, and
    screen-off closes whatever app was open (usage stops counting once the
    screen is off)."""
    ordered = sorted(events, key=lambda event: event.occurred_at)
    timeline: list[dict] = []
    current_app: dict | None = None

    def flush_app_segment() -> None:
        # Used when a *different* app ping (or the same app after too long a
        # gap) ends the segment: we only know the app was in the foreground
        # up to its last confirmed ping, not up to whatever moment the next
        # ping happened to arrive.
        nonlocal current_app
        if current_app is not None:
            timeline.append(current_app)
            current_app = None

    def close_app_segment_at(end_time) -> None:
        # Used for screen-off/shutdown: those are hard state transitions,
        # not just a gap in pings, so the app is known to have stayed
        # foregrounded right up to that instant.
        nonlocal current_app
        if current_app is not None:
            current_app["endTime"] = end_time
            timeline.append(current_app)
            current_app = None

    for event in ordered:
        if event.event_type == DeviceTimelineEvent.EventType.APP_FOREGROUND:
            gap_seconds = (
                (event.occurred_at - current_app["endTime"]).total_seconds()
                if current_app
                else None
            )
            if (
                current_app
                and current_app["packageName"] == event.package_name
                and gap_seconds is not None
                and gap_seconds <= MAX_SEGMENT_GAP_SECONDS
            ):
                current_app["endTime"] = event.occurred_at
                continue
            flush_app_segment()
            current_app = {
                "type": "app",
                "packageName": event.package_name,
                "appLabel": event.app_label or event.package_name,
                "startTime": event.occurred_at,
                "endTime": event.occurred_at,
            }
        elif event.event_type == DeviceTimelineEvent.EventType.SCREEN_OFF:
            close_app_segment_at(event.occurred_at)
            timeline.append({"type": "screen_off", "time": event.occurred_at})
        elif event.event_type == DeviceTimelineEvent.EventType.SCREEN_ON:
            timeline.append({"type": "screen_on", "time": event.occurred_at})
        elif event.event_type == DeviceTimelineEvent.EventType.UNLOCK:
            timeline.append({"type": "unlock", "time": event.occurred_at})
        elif event.event_type == DeviceTimelineEvent.EventType.SHUTDOWN:
            close_app_segment_at(event.occurred_at)
            timeline.append({"type": "shutdown", "time": event.occurred_at})
        elif event.event_type == DeviceTimelineEvent.EventType.BOOT:
            timeline.append({"type": "boot", "time": event.occurred_at})

    flush_app_segment()
    return timeline
