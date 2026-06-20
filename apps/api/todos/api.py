from datetime import date, datetime
from uuid import UUID

from django.shortcuts import get_object_or_404
from django.utils import timezone
from ninja import Router, Schema
from ninja.errors import HttpError

from accounts.authentication import bearer_auth

from .models import Task, TodoOccurrence
from .services import (
    clear_completed,
    create_task_for_day,
    delete_occurrence,
    ensure_day,
    ensure_range,
    reorder_day,
    update_occurrence,
)

router = Router(tags=["todos"])


class TodoOccurrenceOut(Schema):
    id: str
    taskId: str
    rootId: str
    taskDate: str
    text: str
    status: str
    source: str
    sortOrder: int
    createdAt: str
    updatedAt: str
    completedAt: str | None
    carryoverFromOccurrenceId: str | None
    firstCreatedAt: str
    reminderTime: str | None
    reminderAt: str | None
    isRecurring: bool
    repeat: dict


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
    reminderTime: str | None = None
    repeat: RepeatRuleIn | None = None


class OccurrencePatchIn(Schema):
    done: bool | None = None
    text: str | None = None
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


def serialize_occurrence(occurrence: TodoOccurrence) -> dict:
    task = occurrence.task
    return {
        "id": str(occurrence.id),
        "taskId": str(occurrence.task_id),
        "rootId": str(occurrence.root_id),
        "taskDate": occurrence.task_date.isoformat(),
        "text": task.text,
        "status": occurrence.status,
        "source": occurrence.source,
        "sortOrder": occurrence.sort_order,
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
    }


def serialize_day(user, day: date) -> dict:
    occurrences = (
        TodoOccurrence.objects.select_related("task")
        .filter(
            user=user,
            task_date=day,
            deleted_at__isnull=True,
            task__deleted_at__isnull=True,
        )
        .order_by("sort_order", "created_at")
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
        reminder_time=parse_reminder_time(payload.reminderTime),
        **recurrence_payload(payload.repeat),
    )
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
        reminder_time=parse_reminder_time(payload.reminderTime),
        set_reminder_time="reminderTime" in data,
        **(recurrence_payload(payload.repeat) if payload.repeat is not None else {}),
    )
    return serialize_occurrence(occurrence)


@router.delete("/occurrences/{occurrence_id}", response={204: None}, auth=bearer_auth)
def remove_occurrence(request, occurrence_id: UUID):
    get_object_or_404(
        TodoOccurrence,
        id=occurrence_id,
        user=request.auth,
        deleted_at__isnull=True,
        task__deleted_at__isnull=True,
    )
    delete_occurrence(request.auth, occurrence_id)
    return 204, None


@router.post("/days/{day}/clear-completed", response={204: None}, auth=bearer_auth)
def clear_completed_for_day(request, day: date):
    clear_completed(request.auth, day)
    return 204, None


@router.patch("/days/{day}/reorder", response={204: None}, auth=bearer_auth)
def reorder_tasks(request, day: date, payload: ReorderIn):
    reorder_day(request.auth, day, payload.orderedIds)
    return 204, None
