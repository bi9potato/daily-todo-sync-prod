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
    GOOGLE_ACCOUNT_SCOPE,
    GOOGLE_CALENDAR_SCOPE,
    GoogleCalendarError,
    authorization_url,
    build_google_calendar_event,
    delete_event,
    ensure_app_calendar,
    exchange_code_for_tokens,
    fetch_google_userinfo,
    has_calendar_app_scope,
    insert_event,
    is_google_calendar_configured,
    patch_event,
    save_token_response,
)
from .models import GoogleCalendarConnection, GoogleCalendarEventLink

GOOGLE_CALENDAR_STATE_SALT = "daily-todo-sync.google-calendar"
GOOGLE_CALENDAR_STATE_MAX_AGE_SECONDS = 10 * 60
GOOGLE_OAUTH_PURPOSE_BIND = "bind"
GOOGLE_OAUTH_PURPOSE_CALENDAR = "calendar"


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


def build_google_account_bind_url(user, request) -> str:
    if not is_google_calendar_configured():
        raise GoogleCalendarError("Google Calendar OAuth is not configured.")
    state = signing.dumps(
        {
            "purpose": GOOGLE_OAUTH_PURPOSE_BIND,
            "user_id": str(user.id),
            "return_url": frontend_url(request),
        },
        salt=GOOGLE_CALENDAR_STATE_SALT,
    )
    return authorization_url(
        state=state,
        redirect_uri=redirect_uri(request),
        scope=GOOGLE_ACCOUNT_SCOPE,
    )


def build_google_calendar_auth_url(user, request) -> str:
    if not is_google_calendar_configured():
        raise GoogleCalendarError("Google Calendar OAuth is not configured.")
    connection = GoogleCalendarConnection.objects.filter(user=user).first()
    if connection is None:
        raise GoogleCalendarError("Bind a Google account before enabling Calendar sync.")
    state = signing.dumps(
        {
            "purpose": GOOGLE_OAUTH_PURPOSE_CALENDAR,
            "user_id": str(user.id),
            "return_url": frontend_url(request),
        },
        salt=GOOGLE_CALENDAR_STATE_SALT,
    )
    return authorization_url(
        state=state,
        redirect_uri=redirect_uri(request),
        scope=GOOGLE_CALENDAR_SCOPE,
        login_hint=connection.google_email,
    )


def handle_google_oauth_callback(*, code: str, state: str, request):
    payload = signing.loads(
        state,
        salt=GOOGLE_CALENDAR_STATE_SALT,
        max_age=GOOGLE_CALENDAR_STATE_MAX_AGE_SECONDS,
    )
    user = get_user_model().objects.get(id=payload["user_id"])
    token_body = exchange_code_for_tokens(code=code, redirect_uri=redirect_uri(request))
    purpose = payload.get("purpose")
    if purpose == GOOGLE_OAUTH_PURPOSE_BIND:
        bind_google_account(user, token_body)
        status = "bound"
    elif purpose == GOOGLE_OAUTH_PURPOSE_CALENDAR:
        authorize_google_calendar(user, token_body)
        status = "authorized"
    else:
        raise GoogleCalendarError("Unknown Google OAuth callback purpose.")
    return payload.get("return_url") or frontend_url(request), status


def bind_google_account(user, token_body: dict) -> GoogleCalendarConnection:
    connection, _ = GoogleCalendarConnection.objects.get_or_create(
        user=user,
        defaults={
            "calendar_id": settings.GOOGLE_CALENDAR_DEFAULT_ID,
            "access_token": str(token_body.get("access_token") or ""),
            "refresh_token": str(token_body.get("refresh_token") or ""),
            "sync_enabled": False,
        },
    )
    save_token_response(connection, token_body)
    userinfo = fetch_google_userinfo(connection.access_token)
    connection.calendar_id = settings.GOOGLE_CALENDAR_DEFAULT_ID
    connection.google_subject = str(userinfo.get("sub") or "")
    connection.google_email = str(userinfo.get("email") or "")
    connection.google_name = str(userinfo.get("name") or "")
    connection.last_error = ""
    connection.save(
        update_fields=[
            "calendar_id",
            "google_subject",
            "google_email",
            "google_name",
            "last_error",
            "updated_at",
        ]
    )
    return connection


def authorize_google_calendar(user, token_body: dict) -> GoogleCalendarConnection:
    connection = GoogleCalendarConnection.objects.filter(user=user).first()
    if connection is None:
        raise GoogleCalendarError("Bind a Google account before enabling Calendar sync.")

    previous_token_state = {
        "access_token": connection.access_token,
        "refresh_token": connection.refresh_token,
        "token_expires_at": connection.token_expires_at,
        "scope": connection.scope,
    }
    save_token_response(connection, token_body)
    try:
        userinfo = fetch_google_userinfo(connection.access_token)
        google_subject = str(userinfo.get("sub") or "")
        google_email = str(userinfo.get("email") or "")
        if connection.google_subject and google_subject != connection.google_subject:
            raise GoogleCalendarError(
                "Please authorize with the Google account that is already bound."
            )
        if connection.google_email and google_email.lower() != connection.google_email.lower():
            raise GoogleCalendarError(
                "Please authorize with the Google email that is already bound."
            )
        if not has_calendar_app_scope(connection):
            raise GoogleCalendarError("Google Calendar app calendar permission was not granted.")
        ensure_app_calendar(connection)
    except GoogleCalendarError as exc:
        connection.access_token = previous_token_state["access_token"]
        connection.refresh_token = previous_token_state["refresh_token"]
        connection.token_expires_at = previous_token_state["token_expires_at"]
        connection.scope = previous_token_state["scope"]
        connection.calendar_authorized = False
        connection.sync_enabled = False
        connection.last_error = str(exc)
        connection.save(
            update_fields=[
                "access_token",
                "refresh_token",
                "token_expires_at",
                "scope",
                "calendar_authorized",
                "sync_enabled",
                "last_error",
                "updated_at",
            ]
        )
        raise

    connection.calendar_authorized = True
    connection.sync_enabled = True
    connection.last_error = ""
    connection.save(
        update_fields=[
            "calendar_authorized",
            "sync_enabled",
            "last_error",
            "updated_at",
        ]
    )
    return connection


def google_calendar_status(user) -> dict:
    connection = GoogleCalendarConnection.objects.filter(user=user).first()
    calendar_authorized = bool(
        connection
        and connection.calendar_authorized
        and has_calendar_app_scope(connection)
    )
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
        "googleBound": bool(connection),
        "googleEmail": connection.google_email if connection else "",
        "googleName": connection.google_name if connection else "",
        "calendarAuthorized": calendar_authorized,
        "canUseCalendarSync": bool(connection and is_google_calendar_configured()),
        "syncEnabled": bool(connection and connection.sync_enabled and calendar_authorized),
        "calendarId": connection.calendar_id if connection else settings.GOOGLE_CALENDAR_DEFAULT_ID,
        "calendarName": settings.GOOGLE_CALENDAR_NAME,
        "connectedAt": connection.connected_at.isoformat() if connection else None,
        "lastSyncAt": last_sync_at,
        "lastError": connection.last_error if connection else "",
        "syncedCount": synced_count,
        "failedCount": failed_count,
    }


@transaction.atomic
def disconnect_google_calendar(user) -> None:
    GoogleCalendarConnection.objects.filter(user=user).delete()


@transaction.atomic
def set_google_calendar_sync_enabled(user, enabled: bool) -> dict:
    connection = GoogleCalendarConnection.objects.filter(user=user).first()
    if connection is None:
        raise GoogleCalendarError("Bind a Google account before enabling Calendar sync.")
    if enabled:
        if not connection.calendar_authorized or not has_calendar_app_scope(connection):
            raise GoogleCalendarError("Authorize Google Calendar before enabling sync.")
        ensure_app_calendar(connection)
    connection.sync_enabled = enabled
    connection.save(update_fields=["sync_enabled", "updated_at"])
    return google_calendar_status(user)


def sync_occurrence_to_google_calendar(user, occurrence: TodoOccurrence) -> None:
    connection = GoogleCalendarConnection.objects.filter(
        user=user,
        calendar_authorized=True,
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

    if occurrence.task.deleted_at or occurrence.deleted_at:
        delete_google_calendar_event_for_occurrence(user, occurrence)
        return

    if not has_calendar_app_scope(connection):
        connection.sync_enabled = False
        connection.last_error = "Authorize Google Calendar before syncing."
        connection.save(update_fields=["sync_enabled", "last_error", "updated_at"])
        return

    try:
        ensure_app_calendar(connection)
    except GoogleCalendarError as exc:
        connection.last_error = str(exc)
        connection.save(update_fields=["last_error", "updated_at"])
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
    if (
        link.google_event_id
        and link.calendar_id
        and link.calendar_id != connection.calendar_id
        and link.status != GoogleCalendarEventLink.Status.DELETED
    ):
        try:
            delete_event(connection, link.google_event_id, calendar_id=link.calendar_id)
        except GoogleCalendarError:
            pass
        link.google_event_id = ""
        link.google_event_html_link = ""
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
    connection = GoogleCalendarConnection.objects.filter(
        user=user,
        calendar_authorized=True,
        sync_enabled=True,
    ).first()
    link = GoogleCalendarEventLink.objects.filter(user=user, root_id=occurrence.root_id).first()
    if (
        not connection
        or not link
        or not link.google_event_id
        or not is_google_calendar_configured()
    ):
        return

    try:
        delete_event(connection, link.google_event_id, calendar_id=link.calendar_id)
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
    if days < 1 or days > 180:
        raise GoogleCalendarError("Google Calendar sync range must be between 1 and 180 days.")

    connection = GoogleCalendarConnection.objects.filter(user=user).first()
    if connection is None:
        raise GoogleCalendarError("Bind a Google account before syncing Calendar.")
    if not connection.calendar_authorized or not has_calendar_app_scope(connection):
        raise GoogleCalendarError("Authorize Google Calendar before syncing.")
    if not connection.sync_enabled:
        raise GoogleCalendarError("Turn on Google Calendar sync before syncing.")
    ensure_app_calendar(connection)

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
        )
        .order_by("root_id", "-task_date", "-updated_at")
    )

    latest_by_root = {}
    for occurrence in occurrences:
        latest_by_root.setdefault(occurrence.root_id, occurrence)

    synced = 0
    for occurrence in sorted(
        latest_by_root.values(),
        key=lambda item: (item.task_date, item.sort_order, item.created_at),
    ):
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
