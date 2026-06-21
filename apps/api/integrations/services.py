from datetime import date, timedelta
from urllib.parse import quote

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core import signing
from django.db import transaction
from django.utils import timezone

from todos.models import TodoOccurrence
from todos.services import ensure_range

from .google_calendar import (
    GoogleCalendarError,
    authorization_url,
    build_google_calendar_event,
    delete_event,
    exchange_code_for_tokens,
    insert_event,
    is_google_calendar_configured,
    patch_event,
    save_token_response,
)
from .models import GoogleCalendarConnection, GoogleCalendarEventLink

GOOGLE_CALENDAR_STATE_SALT = "daily-todo-sync.google-calendar"
GOOGLE_CALENDAR_STATE_MAX_AGE_SECONDS = 10 * 60


def frontend_url(request=None) -> str:
    if settings.FRONTEND_URL:
        return settings.FRONTEND_URL.rstrip("/")
    if request is not None:
        return request.build_absolute_uri("/").rstrip("/")
    return "/"


def redirect_uri(request) -> str:
    if settings.GOOGLE_CALENDAR_REDIRECT_URI:
        return settings.GOOGLE_CALENDAR_REDIRECT_URI
    return request.build_absolute_uri("/api/integrations/google-calendar/callback")


def build_google_calendar_auth_url(user, request) -> str:
    if not is_google_calendar_configured():
        raise GoogleCalendarError("Google Calendar OAuth is not configured.")
    state = signing.dumps(
        {
            "user_id": str(user.id),
            "return_url": frontend_url(request),
        },
        salt=GOOGLE_CALENDAR_STATE_SALT,
    )
    return authorization_url(state=state, redirect_uri=redirect_uri(request))


def connect_google_calendar_from_callback(*, code: str, state: str, request):
    payload = signing.loads(
        state,
        salt=GOOGLE_CALENDAR_STATE_SALT,
        max_age=GOOGLE_CALENDAR_STATE_MAX_AGE_SECONDS,
    )
    user = get_user_model().objects.get(id=payload["user_id"])
    token_body = exchange_code_for_tokens(code=code, redirect_uri=redirect_uri(request))
    connection, _ = GoogleCalendarConnection.objects.get_or_create(
        user=user,
        defaults={
            "calendar_id": settings.GOOGLE_CALENDAR_DEFAULT_ID,
            "access_token": str(token_body.get("access_token") or ""),
            "refresh_token": str(token_body.get("refresh_token") or ""),
        },
    )
    connection.calendar_id = settings.GOOGLE_CALENDAR_DEFAULT_ID
    connection.sync_enabled = True
    connection.last_error = ""
    connection.save(update_fields=["calendar_id", "sync_enabled", "last_error", "updated_at"])
    save_token_response(connection, token_body)
    return payload.get("return_url") or frontend_url(request)


def google_calendar_status(user) -> dict:
    connection = GoogleCalendarConnection.objects.filter(user=user).first()
    failed_count = GoogleCalendarEventLink.objects.filter(
        user=user,
        status=GoogleCalendarEventLink.Status.ERROR,
    ).count()
    synced_count = GoogleCalendarEventLink.objects.filter(
        user=user,
        status=GoogleCalendarEventLink.Status.SYNCED,
    ).count()
    last_sync_at = (
        connection.last_sync_at.isoformat()
        if connection and connection.last_sync_at
        else None
    )
    return {
        "configured": is_google_calendar_configured(),
        "connected": bool(connection),
        "syncEnabled": bool(connection and connection.sync_enabled),
        "calendarId": connection.calendar_id if connection else settings.GOOGLE_CALENDAR_DEFAULT_ID,
        "connectedAt": connection.connected_at.isoformat() if connection else None,
        "lastSyncAt": last_sync_at,
        "lastError": connection.last_error if connection else "",
        "syncedCount": synced_count,
        "failedCount": failed_count,
    }


@transaction.atomic
def disconnect_google_calendar(user) -> None:
    GoogleCalendarConnection.objects.filter(user=user).delete()


def sync_occurrence_to_google_calendar(user, occurrence: TodoOccurrence) -> None:
    connection = GoogleCalendarConnection.objects.filter(
        user=user,
        sync_enabled=True,
    ).first()
    if not connection or not is_google_calendar_configured():
        return

    occurrence = (
        TodoOccurrence.objects.select_related("task")
        .filter(id=occurrence.id, user=user)
        .first()
    )
    if occurrence is None:
        return

    if occurrence.task.reminder_time is None or occurrence.task.deleted_at or occurrence.deleted_at:
        delete_google_calendar_event_for_occurrence(user, occurrence)
        return

    link, _ = GoogleCalendarEventLink.objects.get_or_create(
        user=user,
        root_id=occurrence.root_id,
        defaults={
            "task": occurrence.task,
            "calendar_id": connection.calendar_id,
            "last_synced_occurrence": occurrence,
        },
    )
    link.task = occurrence.task
    link.calendar_id = connection.calendar_id
    link.last_synced_occurrence = occurrence

    try:
        payload = build_google_calendar_event(occurrence)
        if link.google_event_id and link.status != GoogleCalendarEventLink.Status.DELETED:
            event = patch_event(connection, link.google_event_id, payload)
        else:
            event = insert_event(connection, payload)

        link.google_event_id = str(event.get("id") or link.google_event_id)
        link.google_event_html_link = str(event.get("htmlLink") or "")
        link.status = GoogleCalendarEventLink.Status.SYNCED
        link.last_error = ""
        link.last_synced_at = timezone.now()
        link.save()
        connection.last_sync_at = timezone.now()
        connection.last_error = ""
        connection.save(update_fields=["last_sync_at", "last_error", "updated_at"])
    except GoogleCalendarError as exc:
        link.status = GoogleCalendarEventLink.Status.ERROR
        link.last_error = str(exc)
        link.save(
            update_fields=[
                "task",
                "calendar_id",
                "last_synced_occurrence",
                "status",
                "last_error",
                "updated_at",
            ]
        )
        connection.last_error = str(exc)
        connection.save(update_fields=["last_error", "updated_at"])


def delete_google_calendar_event_for_occurrence(user, occurrence: TodoOccurrence) -> None:
    connection = GoogleCalendarConnection.objects.filter(user=user).first()
    link = GoogleCalendarEventLink.objects.filter(user=user, root_id=occurrence.root_id).first()
    if (
        not connection
        or not link
        or not link.google_event_id
        or not is_google_calendar_configured()
    ):
        return

    try:
        delete_event(connection, link.google_event_id)
        link.status = GoogleCalendarEventLink.Status.DELETED
        link.last_error = ""
        link.last_synced_at = timezone.now()
        link.save(update_fields=["status", "last_error", "last_synced_at", "updated_at"])
        connection.last_sync_at = timezone.now()
        connection.last_error = ""
        connection.save(update_fields=["last_sync_at", "last_error", "updated_at"])
    except GoogleCalendarError as exc:
        link.status = GoogleCalendarEventLink.Status.ERROR
        link.last_error = str(exc)
        link.save(update_fields=["status", "last_error", "updated_at"])
        connection.last_error = str(exc)
        connection.save(update_fields=["last_error", "updated_at"])


def sync_google_calendar_window(user, *, start: date | None = None, days: int = 45) -> dict:
    start = start or timezone.localdate()
    end = start + timedelta(days=days - 1)
    ensure_range(user, start, end)

    occurrences = (
        TodoOccurrence.objects.select_related("task")
        .filter(
            user=user,
            task_date__range=(start, end),
            deleted_at__isnull=True,
            task__deleted_at__isnull=True,
            task__reminder_time__isnull=False,
        )
        .order_by("task_date", "sort_order", "created_at")
    )

    seen_roots = set()
    synced = 0
    for occurrence in occurrences:
        if occurrence.root_id in seen_roots:
            continue
        seen_roots.add(occurrence.root_id)
        before = GoogleCalendarEventLink.objects.filter(
            user=user,
            root_id=occurrence.root_id,
            status=GoogleCalendarEventLink.Status.SYNCED,
        ).exists()
        sync_occurrence_to_google_calendar(user, occurrence)
        after = GoogleCalendarEventLink.objects.filter(
            user=user,
            root_id=occurrence.root_id,
            status=GoogleCalendarEventLink.Status.SYNCED,
        ).exists()
        if after or before:
            synced += 1

    return {
        "start": start.isoformat(),
        "end": end.isoformat(),
        "synced": synced,
    }


def callback_redirect_url(base_url: str, *, status: str, message: str = "") -> str:
    separator = "&" if "?" in base_url else "?"
    query = f"googleCalendar={status}"
    if message:
        query += f"&googleCalendarMessage={quote(message)}"
    return f"{base_url}{separator}{query}"
