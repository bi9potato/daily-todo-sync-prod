from datetime import date, timedelta
from uuid import UUID

from django.db import IntegrityError, transaction
from django.db.models import Min
from django.utils import timezone

from .models import Task, TodoOccurrence


@transaction.atomic
def create_task_for_day(user, task_date: date, text: str) -> TodoOccurrence:
    task = Task.objects.create(user=user, text=text.strip())
    return TodoOccurrence.objects.create(
        user=user,
        task=task,
        root_id=task.root_id,
        task_date=task_date,
    )


@transaction.atomic
def ensure_day(user, target_date: date, *, today: date | None = None) -> None:
    today = today or timezone.localdate()
    if target_date > today:
        return

    earliest = (
        TodoOccurrence.objects.filter(
            user=user,
            deleted_at__isnull=True,
            task__deleted_at__isnull=True,
        ).aggregate(Min("task_date"))["task_date__min"]
    )
    if earliest is None:
        return

    current = earliest + timedelta(days=1)
    while current <= target_date:
        previous = current - timedelta(days=1)
        previous_pending = (
            TodoOccurrence.objects.select_related("task")
            .filter(
                user=user,
                task_date=previous,
                status=TodoOccurrence.Status.PENDING,
                deleted_at__isnull=True,
                task__deleted_at__isnull=True,
            )
            .order_by("created_at")
        )

        for occurrence in previous_pending:
            exists = TodoOccurrence.objects.filter(
                user=user,
                root_id=occurrence.root_id,
                task_date=current,
                deleted_at__isnull=True,
            ).exists()
            if exists:
                continue

            try:
                TodoOccurrence.objects.create(
                    user=user,
                    task=occurrence.task,
                    root_id=occurrence.root_id,
                    task_date=current,
                    carryover_from_occurrence=occurrence,
                )
            except IntegrityError:
                pass

        current += timedelta(days=1)


@transaction.atomic
def update_occurrence(
    user,
    occurrence_id: UUID,
    *,
    done: bool | None = None,
    text: str | None = None,
) -> TodoOccurrence:
    occurrence = TodoOccurrence.objects.select_for_update().select_related("task").get(
        id=occurrence_id,
        user=user,
        deleted_at__isnull=True,
        task__deleted_at__isnull=True,
    )

    if text is not None:
        stripped = text.strip()
        if stripped:
            occurrence.task.text = stripped
            occurrence.task.save(update_fields=["text", "updated_at"])

    if done is not None:
        if done:
            occurrence.status = TodoOccurrence.Status.DONE
            occurrence.completed_at = timezone.now()
        else:
            occurrence.status = TodoOccurrence.Status.PENDING
            occurrence.completed_at = None
        occurrence.version += 1
        occurrence.save(update_fields=["status", "completed_at", "version", "updated_at"])

        if done:
            now = timezone.now()
            TodoOccurrence.objects.filter(
                user=user,
                root_id=occurrence.root_id,
                task_date__gt=occurrence.task_date,
                status=TodoOccurrence.Status.PENDING,
                deleted_at__isnull=True,
                carryover_from_occurrence__isnull=False,
            ).update(deleted_at=now, updated_at=now)
    elif text is not None:
        occurrence.version += 1
        occurrence.save(update_fields=["version", "updated_at"])

    return occurrence


@transaction.atomic
def delete_occurrence(user, occurrence_id: UUID) -> None:
    now = timezone.now()
    occurrence = TodoOccurrence.objects.select_related("task").get(
        id=occurrence_id,
        user=user,
        deleted_at__isnull=True,
        task__deleted_at__isnull=True,
    )
    occurrence.task.deleted_at = now
    occurrence.task.save(update_fields=["deleted_at", "updated_at"])
    TodoOccurrence.objects.filter(
        user=user,
        root_id=occurrence.root_id,
        deleted_at__isnull=True,
    ).update(deleted_at=now, updated_at=now)


@transaction.atomic
def clear_completed(user, task_date: date) -> int:
    now = timezone.now()
    return TodoOccurrence.objects.filter(
        user=user,
        task_date=task_date,
        status=TodoOccurrence.Status.DONE,
        deleted_at__isnull=True,
    ).update(deleted_at=now, updated_at=now)

