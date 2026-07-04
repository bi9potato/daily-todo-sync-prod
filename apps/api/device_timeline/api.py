from datetime import date, datetime, time, timedelta

from django.db import transaction
from django.utils import timezone
from ninja import Router, Schema
from ninja.errors import HttpError

from accounts.authentication import bearer_auth, device_timeline_upload_auth
from accounts.tokens import issue_device_timeline_token

from .models import DeviceTimelineEvent
from .segmentation import build_day_timeline

router = Router(tags=["device_timeline"])

MAX_EVENTS_PER_BATCH = 250


class DeviceTimelineEventIn(Schema):
    clientId: str
    eventType: str
    occurredAt: datetime
    packageName: str = ""
    appLabel: str = ""


class DeviceTimelineEventBatchIn(Schema):
    events: list[DeviceTimelineEventIn]


class DeviceTimelineItemOut(Schema):
    type: str
    time: str | None = None
    startTime: str | None = None
    endTime: str | None = None
    durationMinutes: int | None = None
    packageName: str | None = None
    appLabel: str | None = None


class DeviceTimelineDayOut(Schema):
    date: str
    timeline: list[DeviceTimelineItemOut]


class DeviceTimelineTokenOut(Schema):
    token: str


def day_bounds(day: date):
    current_timezone = timezone.get_current_timezone()
    start = timezone.make_aware(datetime.combine(day, time.min), current_timezone)
    return start, start + timedelta(days=1)


def serialize_timeline_item(item: dict) -> dict:
    if item["type"] == "app":
        duration_minutes = int(
            (item["endTime"] - item["startTime"]).total_seconds() // 60
        )
        return {
            "type": "app",
            "startTime": item["startTime"].isoformat(),
            "endTime": item["endTime"].isoformat(),
            "durationMinutes": duration_minutes,
            "packageName": item["packageName"],
            "appLabel": item["appLabel"],
        }
    return {"type": item["type"], "time": item["time"].isoformat()}


@router.post("/device-token", response=DeviceTimelineTokenOut, auth=bearer_auth)
def get_device_timeline_token(request):
    return {"token": issue_device_timeline_token(request.auth)}


@router.post(
    "/events",
    response={204: None},
    auth=device_timeline_upload_auth,
)
@transaction.atomic
def add_events(request, payload: DeviceTimelineEventBatchIn):
    if not payload.events or len(payload.events) > MAX_EVENTS_PER_BATCH:
        raise HttpError(
            400, f"Provide between 1 and {MAX_EVENTS_PER_BATCH} events."
        )
    valid_types = {choice[0] for choice in DeviceTimelineEvent.EventType.choices}
    events = []
    for event in payload.events:
        if event.eventType not in valid_types:
            continue
        events.append(
            DeviceTimelineEvent(
                user=request.auth,
                client_id=event.clientId[:120],
                event_type=event.eventType,
                occurred_at=event.occurredAt,
                package_name=event.packageName.strip()[:200],
                app_label=event.appLabel.strip()[:200],
            )
        )
    DeviceTimelineEvent.objects.bulk_create(events, ignore_conflicts=True)
    return 204, None


@router.get("/days/{day}", response=DeviceTimelineDayOut, auth=bearer_auth)
def get_device_timeline_day(request, day: date):
    start, end = day_bounds(day)
    events = list(
        DeviceTimelineEvent.objects.filter(
            user=request.auth,
            occurred_at__gte=start,
            occurred_at__lt=end,
        ).order_by("occurred_at")
    )
    timeline = [serialize_timeline_item(item) for item in build_day_timeline(events)]
    return {"date": day.isoformat(), "timeline": timeline}


@router.delete("/history", response={204: None}, auth=bearer_auth)
def clear_device_timeline_history(request):
    DeviceTimelineEvent.objects.filter(user=request.auth).delete()
    return 204, None
