from datetime import date, datetime
from uuid import UUID

from django.http import FileResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from ninja import File, Router, Schema
from ninja.errors import HttpError
from ninja.files import UploadedFile

from accounts.authentication import bearer_auth
from integrations.services import (
    delete_google_calendar_event_for_occurrence,
    sync_occurrence_to_google_calendar,
)

from .models import Task, TaskAttachment, TodoOccurrence
from .services import (
    add_task_attachment,
    clear_completed,
    create_task_for_day,
    delete_task_attachment,
    delete_occurrence,
    ensure_day,
    ensure_range,
    reorder_day,
    reorder_task_attachments,
    update_occurrence,
)

router = Router(tags=["todos"])


class TaskAttachmentOut(Schema):
    id: str
    originalFilename: str
    contentType: str
    sizeBytes: int
    createdAt: str
    contentUrl: str


class TodoOccurrenceOut(Schema):
    id: str
    taskId: str
    rootId: str
    taskDate: str
    text: str
    note: str
    status: str
    source: str
    sortOrder: int
    isPinned: bool
    createdAt: str
    updatedAt: str
    completedAt: str | None
    carryoverFromOccurrenceId: str | None
    firstCreatedAt: str
    reminderTime: str | None
    reminderAt: str | None
    isRecurring: bool
    repeat: dict
    attachments: list[TaskAttachmentOut]


class DayTodosOut(Schema):
    date: str
    pending: list[TodoOccurrenceOut]
    done: list[TodoOccurrenceOut]


class RangeTodosOut(Schema):
    start: str
    end: str
    days: list[DayTodosOut]


class RepeatRuleIn(Schema):
    kind: str = Task.RecurrenceKind.NONE
    interval: int = 1
    daysOfWeek: list[int] | None = None
    until: date | None = None


class TaskCreateIn(Schema):
    text: str
    note: str = ""
    reminderTime: str | None = None
    repeat: RepeatRuleIn | None = None


class OccurrencePatchIn(Schema):
    done: bool | None = None
    text: str | None = None
    note: str | None = None
    pinned: bool | None = None
    reminderTime: str | None = None
    repeat: RepeatRuleIn | None = None


class ReorderIn(Schema):
    orderedIds: list[UUID]


def schema_data(payload: Schema) -> dict:
    if hasattr(payload, "model_dump"):
        return payload.model_dump(exclude_unset=True)
    return payload.dict(exclude_unset=True)


def parse_reminder_time(value: str | None):
    if value in (None, ""):
        return None
    try:
        return datetime.strptime(value, "%H:%M").time()
    except ValueError as exc:
        raise HttpError(400, "Reminder time must use HH:MM format.") from exc


def recurrence_payload(rule: RepeatRuleIn | None) -> dict:
    if rule is None:
        return {
            "recurrence_kind": Task.RecurrenceKind.NONE,
            "recurrence_interval": 1,
            "recurrence_days_of_week": [],
            "recurrence_until": None,
        }

    valid_kinds = {choice[0] for choice in Task.RecurrenceKind.choices}
    if rule.kind not in valid_kinds:
        raise HttpError(400, "Invalid repeat kind.")

    return {
        "recurrence_kind": rule.kind,
        "recurrence_interval": max(rule.interval or 1, 1),
        "recurrence_days_of_week": rule.daysOfWeek or [],
        "recurrence_until": rule.until,
    }


def reminder_at(occurrence: TodoOccurrence) -> str | None:
    if occurrence.task.reminder_time is None:
        return None
    current_timezone = timezone.get_current_timezone()
    value = datetime.combine(occurrence.task_date, occurrence.task.reminder_time)
    return timezone.make_aware(value, current_timezone).isoformat()


def serialize_attachment(attachment: TaskAttachment) -> dict:
    return {
        "id": str(attachment.id),
        "originalFilename": attachment.original_filename,
        "contentType": attachment.content_type,
        "sizeBytes": attachment.size_bytes,
        "createdAt": attachment.created_at.isoformat(),
        "contentUrl": f"/api/attachments/{attachment.id}/content",
    }


def serialize_occurrence(occurrence: TodoOccurrence) -> dict:
    task = occurrence.task
    attachments = sorted(
        occurrence.attachments.all(),
        key=lambda attachment: (attachment.sort_order, attachment.created_at),
    )
    return {
        "id": str(occurrence.id),
        "taskId": str(occurrence.task_id),
        "rootId": str(occurrence.root_id),
        "taskDate": occurrence.task_date.isoformat(),
        "text": task.text,
        "note": occurrence.note,
        "status": occurrence.status,
        "source": occurrence.source,
        "sortOrder": occurrence.sort_order,
        "isPinned": occurrence.is_pinned,
        "createdAt": occurrence.created_at.isoformat(),
        "updatedAt": occurrence.updated_at.isoformat(),
        "completedAt": occurrence.completed_at.isoformat() if occurrence.completed_at else None,
        "carryoverFromOccurrenceId": (
            str(occurrence.carryover_from_occurrence_id)
            if occurrence.carryover_from_occurrence_id
            else None
        ),
        "firstCreatedAt": task.created_at.isoformat(),
        "reminderTime": task.reminder_time.strftime("%H:%M") if task.reminder_time else None,
        "reminderAt": reminder_at(occurrence),
        "isRecurring": task.recurrence_kind != Task.RecurrenceKind.NONE,
        "repeat": {
            "kind": task.recurrence_kind,
            "interval": task.recurrence_interval,
            "daysOfWeek": task.recurrence_days_of_week,
            "until": task.recurrence_until.isoformat() if task.recurrence_until else None,
        },
        "attachments": [serialize_attachment(attachment) for attachment in attachments],
    }


def serialize_day(user, day: date) -> dict:
    occurrences = (
        TodoOccurrence.objects.select_related("task")
        .prefetch_related("attachments")
        .filter(
            user=user,
            task_date=day,
            deleted_at__isnull=True,
            task__deleted_at__isnull=True,
        )
        .order_by("-is_pinned", "sort_order", "created_at")
    )
    pending = []
    done = []
    for occurrence in occurrences:
        serialized = serialize_occurrence(occurrence)
        if occurrence.status == TodoOccurrence.Status.DONE:
            done.append(serialized)
        else:
            pending.append(serialized)
    return {"date": day.isoformat(), "pending": pending, "done": done}


@router.get("/days/{day}", response=DayTodosOut, auth=bearer_auth)
def get_day(request, day: date):
    user = request.auth
    ensure_day(user, day)
    return serialize_day(user, day)


@router.get("/range", response=RangeTodosOut, auth=bearer_auth)
def get_range(request, start: date, end: date):
    if end < start:
        raise HttpError(400, "End date must be on or after start date.")
    if (end - start).days > 45:
        raise HttpError(400, "Range cannot exceed 45 days.")

    user = request.auth
    ensure_range(user, start, end)
    days = []
    current = start
    while current <= end:
        days.append(serialize_day(user, current))
        current = date.fromordinal(current.toordinal() + 1)
    return {"start": start.isoformat(), "end": end.isoformat(), "days": days}


@router.post("/days/{day}/tasks", response={201: TodoOccurrenceOut}, auth=bearer_auth)
def create_task(request, day: date, payload: TaskCreateIn):
    text = payload.text.strip()
    if not text:
        raise HttpError(400, "Task text is required.")
    occurrence = create_task_for_day(
        request.auth,
        day,
        text,
        note=payload.note,
        pinned=payload.pinned,
        reminder_time=parse_reminder_time(payload.reminderTime),
        **recurrence_payload(payload.repeat),
    )
    sync_occurrence_to_google_calendar(request.auth, occurrence)
    return 201, serialize_occurrence(occurrence)


@router.patch("/occurrences/{occurrence_id}", response=TodoOccurrenceOut, auth=bearer_auth)
def patch_occurrence(request, occurrence_id: UUID, payload: OccurrencePatchIn):
    data = schema_data(payload)
    get_object_or_404(
        TodoOccurrence,
        id=occurrence_id,
        user=request.auth,
        deleted_at__isnull=True,
        task__deleted_at__isnull=True,
    )
    occurrence = update_occurrence(
        request.auth,
        occurrence_id,
        done=payload.done,
        text=payload.text,
        note=payload.note,
        reminder_time=parse_reminder_time(payload.reminderTime),
        set_reminder_time="reminderTime" in data,
        **(recurrence_payload(payload.repeat) if payload.repeat is not None else {}),
    )
    sync_occurrence_to_google_calendar(request.auth, occurrence)
    return serialize_occurrence(occurrence)


@router.delete("/occurrences/{occurrence_id}", response={204: None}, auth=bearer_auth)
def remove_occurrence(request, occurrence_id: UUID):
    occurrence = get_object_or_404(
        TodoOccurrence,
        id=occurrence_id,
        user=request.auth,
        deleted_at__isnull=True,
        task__deleted_at__isnull=True,
    )
    delete_occurrence(request.auth, occurrence_id)
    delete_google_calendar_event_for_occurrence(request.auth, occurrence)
    return 204, None


@router.post(
    "/occurrences/{occurrence_id}/attachments",
    response={201: TaskAttachmentOut},
    auth=bearer_auth,
)
def upload_attachment(
    request,
    occurrence_id: UUID,
    file: UploadedFile = File(...),
):
    try:
        attachment = add_task_attachment(request.auth, occurrence_id, file)
    except ValueError as exc:
        raise HttpError(400, str(exc)) from exc
    return 201, serialize_attachment(attachment)


@router.get("/attachments/{attachment_id}/content", auth=bearer_auth)
def get_attachment_content(request, attachment_id: UUID):
    attachment = get_object_or_404(TaskAttachment, id=attachment_id, user=request.auth)
    response = FileResponse(
        attachment.file.open("rb"),
        content_type=attachment.content_type,
        filename=attachment.original_filename,
        as_attachment=False,
    )
    response["Cache-Control"] = "private, max-age=300"
    return response


@router.delete("/attachments/{attachment_id}", response={204: None}, auth=bearer_auth)
def remove_attachment(request, attachment_id: UUID):
    delete_task_attachment(request.auth, attachment_id)
    return 204, None


@router.patch("/occurrences/{occurrence_id}/attachments/reorder", response={204: None}, auth=bearer_auth)
def reorder_attachments(request, occurrence_id: UUID, payload: ReorderIn):
    reorder_task_attachments(request.auth, occurrence_id, payload.orderedIds)
    return 204, None


@router.post("/days/{day}/clear-completed", response={204: None}, auth=bearer_auth)
def clear_completed_for_day(request, day: date):
    clear_completed(request.auth, day)
    return 204, None


@router.patch("/days/{day}/reorder", response={204: None}, auth=bearer_auth)
def reorder_tasks(request, day: date, payload: ReorderIn):
    reorder_day(request.auth, day, payload.orderedIds)
    return 204, None
