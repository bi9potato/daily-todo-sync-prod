from datetime import date, timedelta, time
from pathlib import Path
from uuid import UUID

from django.db import IntegrityError, transaction
from django.db.models import Max, Min
from django.http import Http404
from django.utils import timezone

from .models import Task, TaskAttachment, TodoOccurrence

MAX_ATTACHMENT_SIZE_BYTES = 8 * 1024 * 1024
ALLOWED_ATTACHMENT_TYPES = {
    "image/gif": {".gif"},
    "image/jpeg": {".jpg", ".jpeg"},
    "image/png": {".png"},
    "image/webp": {".webp"},
}


def _next_sort_order(user, task_date: date, *, is_pinned: bool = False) -> int:
    current_max = (
        TodoOccurrence.objects.filter(
            user=user,
            task_date=task_date,
            is_pinned=is_pinned,
            deleted_at__isnull=True,
        ).aggregate(Max("sort_order"))["sort_order__max"]
    )
    return (current_max or 0) + 1000


def _next_attachment_sort_order(user, occurrence: TodoOccurrence) -> int:
    current_max = (
        TaskAttachment.objects.filter(
            user=user,
            occurrence=occurrence,
        ).aggregate(Max("sort_order"))["sort_order__max"]
    )
    return (current_max or 0) + 1000


def _next_task_attachment_sort_order(user, task: Task) -> int:
    current_max = (
        TaskAttachment.objects.filter(
            user=user,
            task=task,
            occurrence__isnull=True,
        ).aggregate(Max("sort_order"))["sort_order__max"]
    )
    return (current_max or 0) + 1000


def _uses_future_content(task: Task) -> bool:
    return task.content_mode == Task.ContentMode.FUTURE


def _copy_task_level_attachments(user, source_task: Task, target_task: Task) -> dict[UUID, UUID]:
    attachment_id_map: dict[UUID, UUID] = {}
    for attachment in TaskAttachment.objects.filter(
        user=user,
        task=source_task,
        occurrence__isnull=True,
    ).order_by("sort_order", "created_at"):
        copied = TaskAttachment.objects.create(
            user=user,
            task=target_task,
            occurrence=None,
            file=attachment.file.name,
            original_filename=attachment.original_filename,
            content_type=attachment.content_type,
            size_bytes=attachment.size_bytes,
            sort_order=attachment.sort_order,
        )
        attachment_id_map[attachment.id] = copied.id
    return attachment_id_map


def _copy_occurrence_attachments_to_task(user, occurrence: TodoOccurrence, task: Task) -> None:
    existing_files = set(
        TaskAttachment.objects.filter(
            user=user,
            task=task,
            occurrence__isnull=True,
        ).values_list("file", flat=True)
    )
    next_sort_order = _next_task_attachment_sort_order(user, task)
    for attachment in TaskAttachment.objects.filter(
        user=user,
        occurrence=occurrence,
    ).order_by("sort_order", "created_at"):
        if attachment.file.name in existing_files:
            continue
        TaskAttachment.objects.create(
            user=user,
            task=task,
            occurrence=None,
            file=attachment.file.name,
            original_filename=attachment.original_filename,
            content_type=attachment.content_type,
            size_bytes=attachment.size_bytes,
            sort_order=next_sort_order,
        )
        next_sort_order += 1000


def _copy_task_attachments_to_occurrence(user, task: Task, occurrence: TodoOccurrence) -> None:
    existing_files = set(
        TaskAttachment.objects.filter(
            user=user,
            occurrence=occurrence,
        ).values_list("file", flat=True)
    )
    next_sort_order = _next_attachment_sort_order(user, occurrence)
    for attachment in TaskAttachment.objects.filter(
        user=user,
        task=task,
        occurrence__isnull=True,
    ).order_by("sort_order", "created_at"):
        if attachment.file.name in existing_files:
            continue
        TaskAttachment.objects.create(
            user=user,
            task=task,
            occurrence=occurrence,
            file=attachment.file.name,
            original_filename=attachment.original_filename,
            content_type=attachment.content_type,
            size_bytes=attachment.size_bytes,
            sort_order=next_sort_order,
        )
        next_sort_order += 1000


def _split_task_for_future(user, occurrence: TodoOccurrence) -> tuple[Task, dict[UUID, UUID]]:
    task = occurrence.task
    if task.recurrence_kind == Task.RecurrenceKind.NONE:
        return task, {}
    if task.recurrence_start_date is None or occurrence.task_date <= task.recurrence_start_date:
        return task, {}

    previous_until = task.recurrence_until
    new_task = Task.objects.create(
        user=user,
        root_id=task.root_id,
        text=task.text,
        note=task.note,
        content_mode=task.content_mode,
        reminder_time=task.reminder_time,
        recurrence_kind=task.recurrence_kind,
        recurrence_interval=task.recurrence_interval,
        recurrence_days_of_week=task.recurrence_days_of_week,
        recurrence_until=previous_until,
        recurrence_start_date=occurrence.task_date,
    )
    attachment_id_map = _copy_task_level_attachments(user, task, new_task)

    cutoff = occurrence.task_date - timedelta(days=1)
    if previous_until is None or previous_until >= occurrence.task_date:
        task.recurrence_until = cutoff
        task.save(update_fields=["recurrence_until", "updated_at"])

    TodoOccurrence.objects.filter(
        user=user,
        root_id=task.root_id,
        task=task,
        task_date__gte=occurrence.task_date,
        deleted_at__isnull=True,
    ).update(task=new_task, updated_at=timezone.now())
    occurrence.task = new_task
    occurrence.task_id = new_task.id
    return new_task, attachment_id_map


def _ensure_future_content_task(user, occurrence: TodoOccurrence) -> tuple[Task, dict[UUID, UUID]]:
    task, attachment_id_map = _split_task_for_future(user, occurrence)
    if task.content_mode != Task.ContentMode.FUTURE:
        task.content_mode = Task.ContentMode.FUTURE
        task.note = occurrence.note
        task.save(update_fields=["content_mode", "note", "updated_at"])
        _copy_occurrence_attachments_to_task(user, occurrence, task)
    return task, attachment_id_map


def _normalized_weekdays(days: list[int] | None) -> list[int]:
    if not days:
        return []
    return sorted({int(day) for day in days if 0 <= int(day) <= 6})


def _is_valid_image_signature(content_type: str, header: bytes) -> bool:
    if content_type == "image/jpeg":
        return header.startswith(b"\xff\xd8\xff")
    if content_type == "image/png":
        return header.startswith(b"\x89PNG\r\n\x1a\n")
    if content_type == "image/gif":
        return header.startswith((b"GIF87a", b"GIF89a"))
    if content_type == "image/webp":
        return header.startswith(b"RIFF") and header[8:12] == b"WEBP"
    return False


def _validate_attachment_file(uploaded_file) -> tuple[str, str, int]:
    original_filename = Path(uploaded_file.name or "image").name[:255] or "image"
    extension = Path(original_filename).suffix.lower()
    content_type = (getattr(uploaded_file, "content_type", "") or "").lower()
    size = int(getattr(uploaded_file, "size", 0) or 0)

    if content_type not in ALLOWED_ATTACHMENT_TYPES:
        raise ValueError("Only JPEG, PNG, WebP, and GIF images can be uploaded.")
    if extension not in ALLOWED_ATTACHMENT_TYPES[content_type]:
        raise ValueError("Image extension does not match the uploaded file type.")
    if size <= 0:
        raise ValueError("Uploaded image is empty.")
    if size > MAX_ATTACHMENT_SIZE_BYTES:
        raise ValueError("Image is too large. Please upload an image under 8 MB.")

    header = uploaded_file.read(16)
    uploaded_file.seek(0)
    if not _is_valid_image_signature(content_type, header):
        raise ValueError("Uploaded file does not look like a supported image.")

    return original_filename, content_type, size


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
    note: str = "",
    content_mode: str = Task.ContentMode.OCCURRENCE,
    reminder_time: time | None = None,
    recurrence_kind: str = Task.RecurrenceKind.NONE,
    recurrence_interval: int = 1,
    recurrence_days_of_week: list[int] | None = None,
    recurrence_until: date | None = None,
) -> TodoOccurrence:
    normalized_kind = recurrence_kind or Task.RecurrenceKind.NONE
    normalized_content_mode = (
        Task.ContentMode.FUTURE
        if content_mode == Task.ContentMode.FUTURE
        else Task.ContentMode.OCCURRENCE
    )
    task = Task.objects.create(
        user=user,
        text=text.strip(),
        note=note.strip() if normalized_content_mode == Task.ContentMode.FUTURE else "",
        content_mode=normalized_content_mode,
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
        note="" if normalized_content_mode == Task.ContentMode.FUTURE else note.strip(),
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
    note: str | None = None,
    pinned: bool | None = None,
    is_long_term: bool | None = None,
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

    content_changed = (
        text is not None
        or note is not None
        or set_reminder_time
        or recurrence_kind is not None
        or recurrence_interval is not None
        or recurrence_days_of_week is not None
        or recurrence_until is not None
    )
    converted_to_occurrence_content = False
    if is_long_term is True or (_uses_future_content(occurrence.task) and content_changed):
        _ensure_future_content_task(user, occurrence)
    elif is_long_term is False and _uses_future_content(occurrence.task):
        task, _ = _split_task_for_future(user, occurrence)
        occurrence.note = task.note
        converted_to_occurrence_content = True
        _copy_task_attachments_to_occurrence(user, task, occurrence)
        task.note = ""
        task.content_mode = Task.ContentMode.OCCURRENCE
        task.save(update_fields=["note", "content_mode", "updated_at"])

    use_future_content = _uses_future_content(occurrence.task)
    occurrence_changed_fields = []
    if converted_to_occurrence_content:
        occurrence_changed_fields.append("note")

    if text is not None:
        stripped = text.strip()
        if stripped:
            occurrence.task.text = stripped

    if note is not None:
        if use_future_content:
            occurrence.task.note = note.strip()
        else:
            occurrence.note = note.strip()
            occurrence_changed_fields.append("note")

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

    task_changed = (
        is_long_term is not None
        or (use_future_content and note is not None)
        or any(
            value is not None
            for value in [
                text,
                reminder_time,
                recurrence_kind,
                recurrence_interval,
                recurrence_until,
            ]
        )
        or recurrence_days_of_week is not None
        or set_reminder_time
    )

    if task_changed:
        occurrence.task.save(
            update_fields=[
                "text",
                "note",
                "content_mode",
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
    elif task_changed:
        occurrence.version += 1
        occurrence.save(update_fields=["version", "updated_at"])

    if pinned is not None:
        next_pinned = bool(pinned)
        if occurrence.is_pinned != next_pinned:
            occurrence.is_pinned = next_pinned
            occurrence.sort_order = _next_sort_order(
                user,
                occurrence.task_date,
                is_pinned=next_pinned,
            )
            occurrence_changed_fields.extend(["is_pinned", "sort_order"])

    if occurrence_changed_fields:
        occurrence.version += 1
        occurrence_changed_fields.extend(["version", "updated_at"])
        occurrence.save(update_fields=occurrence_changed_fields)

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


def list_deleted_occurrences(user, *, limit: int = 50) -> list[TodoOccurrence]:
    occurrences = (
        TodoOccurrence.objects.select_related("task")
        .prefetch_related("attachments")
        .filter(user=user, deleted_at__isnull=False)
        .order_by("-deleted_at", "-updated_at")
    )
    seen_roots = set()
    deleted: list[TodoOccurrence] = []
    for occurrence in occurrences:
        if occurrence.root_id in seen_roots:
            continue
        seen_roots.add(occurrence.root_id)
        deleted.append(occurrence)
        if len(deleted) >= limit:
            break
    return deleted


@transaction.atomic
def restore_occurrence(user, occurrence_id: UUID) -> TodoOccurrence:
    occurrence = TodoOccurrence.objects.select_for_update().select_related("task").get(
        id=occurrence_id,
        user=user,
    )
    now = timezone.now()

    if occurrence.task.deleted_at is not None:
        occurrence.task.deleted_at = None
        occurrence.task.save(update_fields=["deleted_at", "updated_at"])

    deleted_occurrences = TodoOccurrence.objects.select_for_update().filter(
        user=user,
        root_id=occurrence.root_id,
        deleted_at__isnull=False,
    )
    for deleted_occurrence in deleted_occurrences:
        has_active_duplicate = (
            TodoOccurrence.objects.filter(
                user=user,
                root_id=deleted_occurrence.root_id,
                task_date=deleted_occurrence.task_date,
                deleted_at__isnull=True,
            )
            .exclude(id=deleted_occurrence.id)
            .exists()
        )
        if has_active_duplicate:
            continue
        deleted_occurrence.deleted_at = None
        deleted_occurrence.updated_at = now
        deleted_occurrence.version += 1
        deleted_occurrence.save(update_fields=["deleted_at", "updated_at", "version"])

    return (
        TodoOccurrence.objects.select_related("task")
        .prefetch_related("attachments")
        .get(id=occurrence_id, user=user)
    )


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
    occurrences = list(
        TodoOccurrence.objects.filter(
            user=user,
            task_date=task_date,
            id__in=ordered_ids,
            deleted_at__isnull=True,
            task__deleted_at__isnull=True,
        )
    )
    occurrences_by_id = {occurrence.id: occurrence for occurrence in occurrences}
    pinned_by_id = {occurrence.id: occurrence.is_pinned for occurrence in occurrences}
    order_by_id = {
        occurrence_id: index
        for index, occurrence_id in enumerate(ordered_ids)
        if occurrence_id in occurrences_by_id
    }

    for is_pinned in (True, False):
        group = [
            occurrence
            for occurrence in occurrences
            if pinned_by_id.get(occurrence.id) == is_pinned
        ]
        group.sort(key=lambda item: order_by_id.get(item.id, 10_000))
        for index, occurrence in enumerate(group, start=1):
            occurrence.sort_order = index * 1000
            occurrence.save(update_fields=["sort_order", "updated_at"])


@transaction.atomic
def add_task_attachment(user, occurrence_id: UUID, uploaded_file) -> TaskAttachment:
    occurrence = TodoOccurrence.objects.select_related("task").get(
        id=occurrence_id,
        user=user,
        deleted_at__isnull=True,
        task__deleted_at__isnull=True,
    )
    if _uses_future_content(occurrence.task):
        task, _ = _ensure_future_content_task(user, occurrence)
        original_filename, content_type, size = _validate_attachment_file(uploaded_file)
        attachment = TaskAttachment(
            user=user,
            task=task,
            occurrence=None,
            original_filename=original_filename,
            content_type=content_type,
            size_bytes=size,
            sort_order=_next_task_attachment_sort_order(user, task),
        )
        attachment.file.save(original_filename, uploaded_file, save=True)
        TodoOccurrence.objects.filter(
            user=user,
            root_id=occurrence.root_id,
            task=task,
            task_date__gte=occurrence.task_date,
            deleted_at__isnull=True,
        ).update(updated_at=timezone.now())
        return attachment

    original_filename, content_type, size = _validate_attachment_file(uploaded_file)
    attachment = TaskAttachment(
        user=user,
        task=occurrence.task,
        occurrence=occurrence,
        original_filename=original_filename,
        content_type=content_type,
        size_bytes=size,
        sort_order=_next_attachment_sort_order(user, occurrence),
    )
    attachment.file.save(original_filename, uploaded_file, save=True)
    occurrence.version += 1
    occurrence.save(update_fields=["version", "updated_at"])
    return attachment


@transaction.atomic
def delete_task_attachment(
    user,
    attachment_id: UUID,
    *,
    occurrence_id: UUID | None = None,
) -> None:
    attachment = TaskAttachment.objects.filter(id=attachment_id, user=user).first()
    if attachment is None:
        raise Http404("Attachment not found.")
    if attachment.occurrence_id is None and occurrence_id is not None:
        occurrence = TodoOccurrence.objects.select_related("task").get(
            id=occurrence_id,
            user=user,
            deleted_at__isnull=True,
            task__deleted_at__isnull=True,
        )
        if _uses_future_content(occurrence.task):
            task, attachment_id_map = _ensure_future_content_task(user, occurrence)
            target_attachment_id = attachment_id_map.get(attachment.id, attachment.id)
            attachment = TaskAttachment.objects.filter(
                id=target_attachment_id,
                user=user,
                task=task,
                occurrence__isnull=True,
            ).first()
            if attachment is None:
                raise Http404("Attachment not found.")
    attachment.delete()


@transaction.atomic
def reorder_task_attachments(user, occurrence_id: UUID, ordered_ids: list[UUID]) -> None:
    occurrence = TodoOccurrence.objects.get(
        id=occurrence_id,
        user=user,
        deleted_at__isnull=True,
        task__deleted_at__isnull=True,
    )
    if _uses_future_content(occurrence.task):
        task, attachment_id_map = _ensure_future_content_task(user, occurrence)
        mapped_ordered_ids = [
            attachment_id_map.get(attachment_id, attachment_id)
            for attachment_id in ordered_ids
        ]
        attachments = {
            attachment.id: attachment
            for attachment in TaskAttachment.objects.filter(
                user=user,
                task=task,
                occurrence__isnull=True,
                id__in=mapped_ordered_ids,
            )
        }
        for index, attachment_id in enumerate(mapped_ordered_ids, start=1):
            attachment = attachments.get(attachment_id)
            if attachment is None:
                continue
            attachment.sort_order = index * 1000
            attachment.save(update_fields=["sort_order"])
        return

    attachments = {
        attachment.id: attachment
        for attachment in TaskAttachment.objects.filter(
            user=user,
            occurrence=occurrence,
            id__in=ordered_ids,
        )
    }
    for index, attachment_id in enumerate(ordered_ids, start=1):
        attachment = attachments.get(attachment_id)
        if attachment is None:
            continue
        attachment.sort_order = index * 1000
        attachment.save(update_fields=["sort_order"])
