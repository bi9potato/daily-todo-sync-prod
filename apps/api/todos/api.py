from datetime import date
from uuid import UUID

from django.shortcuts import get_object_or_404
from ninja import Router, Schema
from ninja.errors import HttpError

from accounts.authentication import bearer_auth

from .models import TodoOccurrence
from .services import (
    clear_completed,
    create_task_for_day,
    delete_occurrence,
    ensure_day,
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
    createdAt: str
    updatedAt: str
    completedAt: str | None
    carryoverFromOccurrenceId: str | None


class DayTodosOut(Schema):
    date: str
    pending: list[TodoOccurrenceOut]
    done: list[TodoOccurrenceOut]


class TaskCreateIn(Schema):
    text: str


class OccurrencePatchIn(Schema):
    done: bool | None = None
    text: str | None = None


def serialize_occurrence(occurrence: TodoOccurrence) -> dict[str, str | None]:
    return {
        "id": str(occurrence.id),
        "taskId": str(occurrence.task_id),
        "rootId": str(occurrence.root_id),
        "taskDate": occurrence.task_date.isoformat(),
        "text": occurrence.task.text,
        "status": occurrence.status,
        "createdAt": occurrence.created_at.isoformat(),
        "updatedAt": occurrence.updated_at.isoformat(),
        "completedAt": occurrence.completed_at.isoformat() if occurrence.completed_at else None,
        "carryoverFromOccurrenceId": (
            str(occurrence.carryover_from_occurrence_id)
            if occurrence.carryover_from_occurrence_id
            else None
        ),
    }


@router.get("/days/{day}", response=DayTodosOut, auth=bearer_auth)
def get_day(request, day: date):
    user = request.auth
    ensure_day(user, day)
    occurrences = (
        TodoOccurrence.objects.select_related("task")
        .filter(
            user=user,
            task_date=day,
            deleted_at__isnull=True,
            task__deleted_at__isnull=True,
        )
        .order_by("created_at")
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


@router.post("/days/{day}/tasks", response={201: TodoOccurrenceOut}, auth=bearer_auth)
def create_task(request, day: date, payload: TaskCreateIn):
    text = payload.text.strip()
    if not text:
        raise HttpError(400, "Task text is required.")
    occurrence = create_task_for_day(request.auth, day, text)
    return 201, serialize_occurrence(occurrence)


@router.patch("/occurrences/{occurrence_id}", response=TodoOccurrenceOut, auth=bearer_auth)
def patch_occurrence(request, occurrence_id: UUID, payload: OccurrencePatchIn):
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

