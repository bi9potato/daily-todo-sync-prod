from datetime import date, timedelta, time
from uuid import UUID

from django.db import IntegrityError, transaction
from django.db.models import Max, Min
from django.utils import timezone

from .models import Task, TodoOccurrence


def _next_sort_order(user, task_date: date) -> int:
    current_max = (
        TodoOccurrence.objects.filter(
            user=user,
            task_date=task_date,
            deleted_at__isnull=True,
        ).aggregate(Max("sort_order"))["sort_order__max"]
    )
    return (current_max or 0) + 1000


def _normalized_weekdays(days: list[int] | None) -> list[int]:
    if not days:
        return []
    return sorted({int(day) for day in days if 0 <= int(day) <= 6})


def _months_between(start: date, target: date) -> int:
    return (target.year - start.year) * 12 + target.month - start.month


def _is_recurring_on(task: Task, target_date: date) -> bool:
    if task.recurrence_kind == Task.RecurrenceKind.NONE:
        return False
    if task.recurrence_start_date is None:
        return False
    if target_date < task.recurrence_start_date:
        return False
    if task.recurrence_until and target_date > task.recurrence_until:
        return False

    interval = max(task.recurrence_interval, 1)
    start = task.recurrence_start_date
    day_delta = (target_date - start).days

    if task.recurrence_kind == Task.RecurrenceKind.DAILY:
        return day_delta % interval == 0

    if task.recurrence_kind == Task.RecurrenceKind.WEEKDAYS:
        return target_date.weekday() < 5

    if task.recurrence_kind == Task.RecurrenceKind.WEEKLY:
        weekdays = _normalized_weekdays(task.recurrence_days_of_week) or [start.weekday()]
        week_delta = day_delta // 7
        return week_delta % interval == 0 and target_date.weekday() in weekdays

    if task.recurrence_kind == Task.RecurrenceKind.MONTHLY:
        month_delta = _months_between(start, target_date)
        return month_delta >= 0 and month_delta % interval == 0 and target_date.day == start.day

    if task.recurrence_kind == Task.RecurrenceKind.YEARLY:
        year_delta = target_date.year - start.year
        return (
            year_delta >= 0
            and year_delta % interval == 0
            and target_date.month == start.month
            and target_date.day == start.day
        )

    return False


@transaction.atomic
def create_task_for_day(
    user,
    task_date: date,
    text: str,
    *,
    reminder_time: time | None = None,
    recurrence_kind: str = Task.RecurrenceKind.NONE,
    recurrence_interval: int = 1,
    recurrence_days_of_week: list[int] | None = None,
    recurrence_until: date | None = None,
) -> TodoOccurrence:
    normalized_kind = recurrence_kind or Task.RecurrenceKind.NONE
    task = Task.objects.create(
        user=user,
        text=text.strip(),
        reminder_time=reminder_time,
        recurrence_kind=normalized_kind,
        recurrence_interval=max(recurrence_interval or 1, 1),
        recurrence_days_of_week=_normalized_weekdays(recurrence_days_of_week),
        recurrence_until=recurrence_until,
        recurrence_start_date=task_date if normalized_kind != Task.RecurrenceKind.NONE else None,
    )
    return TodoOccurrence.objects.create(
        user=user,
        task=task,
        root_id=task.root_id,
        task_date=task_date,
        source=TodoOccurrence.Source.MANUAL,
        sort_order=_next_sort_order(user, task_date),
    )


@transaction.atomic
def ensure_recurring_occurrences(user, start_date: date, end_date: date) -> None:
    if end_date < start_date:
        return

    recurring_tasks = Task.objects.filter(
        user=user,
        deleted_at__isnull=True,
        recurrence_start_date__lte=end_date,
    ).exclude(recurrence_kind=Task.RecurrenceKind.NONE)

    current = start_date
    while current <= end_date:
        for task in recurring_tasks:
            if not _is_recurring_on(task, current):
                continue
            exists = TodoOccurrence.objects.filter(
                user=user,
                root_id=task.root_id,
                task_date=current,
                deleted_at__isnull=True,
            ).exists()
            if exists:
                continue
            try:
                TodoOccurrence.objects.create(
                    user=user,
                    task=task,
                    root_id=task.root_id,
                    task_date=current,
                    source=TodoOccurrence.Source.RECURRING,
                    sort_order=_next_sort_order(user, current),
                )
            except IntegrityError:
                pass
        current += timedelta(days=1)


@transaction.atomic
def ensure_day(user, target_date: date, *, today: date | None = None) -> None:
    ensure_range(user, target_date, target_date, today=today)


@transaction.atomic
def ensure_range(
    user,
    start_date: date,
    end_date: date,
    *,
    today: date | None = None,
) -> None:
    if end_date < start_date:
        return

    ensure_recurring_occurrences(user, start_date, end_date)

    today = today or timezone.localdate()
    carryover_end = min(end_date, today)
    if start_date > today:
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
    while current <= carryover_end:
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
                    source=TodoOccurrence.Source.CARRYOVER,
                    sort_order=_next_sort_order(user, current),
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
    reminder_time: time | None = None,
    set_reminder_time: bool = False,
    recurrence_kind: str | None = None,
    recurrence_interval: int | None = None,
    recurrence_days_of_week: list[int] | None = None,
    recurrence_until: date | None = None,
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

    if set_reminder_time:
        occurrence.task.reminder_time = reminder_time

    if recurrence_kind is not None:
        normalized_kind = recurrence_kind or Task.RecurrenceKind.NONE
        occurrence.task.recurrence_kind = normalized_kind
        occurrence.task.recurrence_interval = max(recurrence_interval or 1, 1)
        occurrence.task.recurrence_days_of_week = _normalized_weekdays(recurrence_days_of_week)
        occurrence.task.recurrence_until = recurrence_until
        occurrence.task.recurrence_start_date = (
            occurrence.task_date if normalized_kind != Task.RecurrenceKind.NONE else None
        )

    task_changed = any(
        value is not None
        for value in [text, reminder_time, recurrence_kind, recurrence_interval, recurrence_until]
    ) or recurrence_days_of_week is not None or set_reminder_time

    if task_changed:
        occurrence.task.save(
            update_fields=[
                "text",
                "reminder_time",
                "recurrence_kind",
                "recurrence_interval",
                "recurrence_days_of_week",
                "recurrence_until",
                "recurrence_start_date",
                "updated_at",
            ]
        )

        if recurrence_kind is not None:
            now = timezone.now()
            TodoOccurrence.objects.filter(
                user=user,
                root_id=occurrence.root_id,
                task_date__gt=occurrence.task_date,
                source=TodoOccurrence.Source.RECURRING,
                deleted_at__isnull=True,
            ).update(deleted_at=now, updated_at=now)

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


@transaction.atomic
def reorder_day(user, task_date: date, ordered_ids: list[UUID]) -> None:
    occurrences = {
        occurrence.id: occurrence
        for occurrence in TodoOccurrence.objects.filter(
            user=user,
            task_date=task_date,
            id__in=ordered_ids,
            deleted_at__isnull=True,
            task__deleted_at__isnull=True,
        )
    }

    for index, occurrence_id in enumerate(ordered_ids, start=1):
        occurrence = occurrences.get(occurrence_id)
        if occurrence is None:
            continue
        occurrence.sort_order = index * 1000
        occurrence.save(update_fields=["sort_order", "updated_at"])
