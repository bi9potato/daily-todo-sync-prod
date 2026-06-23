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


def primary_google_connection(user) -> GoogleCalendarConnection | None:
    return (
        GoogleCalendarConnection.objects.filter(user=user)
        .order_by("-is_primary", "-updated_at", "-connected_at")
        .first()
    )


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


def build_google_calendar_auth_url(user, request, connection_id=None) -> str:
    if not is_google_calendar_configured():
        raise GoogleCalendarError("Google Calendar OAuth is not configured.")
    connections = GoogleCalendarConnection.objects.filter(user=user)
    connection = (
        connections.filter(id=connection_id).first()
        if connection_id
        else primary_google_connection(user)
    )
    if connection is None:
        raise GoogleCalendarError("Bind a Google account before enabling Calendar sync.")
    state = signing.dumps(
        {
            "purpose": GOOGLE_OAUTH_PURPOSE_CALENDAR,
            "user_id": str(user.id),
            "connection_id": str(connection.id),
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
        authorize_google_calendar(user, token_body, connection_id=payload.get("connection_id"))
        status = "authorized"
    else:
        raise GoogleCalendarError("Unknown Google OAuth callback purpose.")
    return payload.get("return_url") or frontend_url(request), status


def bind_google_account(user, token_body: dict) -> GoogleCalendarConnection:
    access_token = str(token_body.get("access_token") or "")
    if not access_token:
        raise GoogleCalendarError("Google OAuth response did not include an access token.")
    userinfo = fetch_google_userinfo(access_token)
    google_subject = str(userinfo.get("sub") or "")
    if not google_subject:
        raise GoogleCalendarError("Google account did not return a subject id.")

    has_existing = GoogleCalendarConnection.objects.filter(user=user).exists()
    connection, _ = GoogleCalendarConnection.objects.get_or_create(
        user=user,
        google_subject=google_subject,
        defaults={
            "calendar_id": settings.GOOGLE_CALENDAR_DEFAULT_ID,
            "access_token": access_token,
            "refresh_token": str(token_body.get("refresh_token") or ""),
            "sync_enabled": False,
            "is_primary": not has_existing,
        },
    )
    save_token_response(connection, token_body)
    connection.calendar_id = settings.GOOGLE_CALENDAR_DEFAULT_ID
    connection.google_subject = google_subject
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


def authorize_google_calendar(user, token_body: dict, *, connection_id=None) -> GoogleCalendarConnection:
    connections = GoogleCalendarConnection.objects.filter(user=user)
    connection = (
        connections.filter(id=connection_id).first()
        if connection_id
        else primary_google_connection(user)
    )
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
    connections = list(
        GoogleCalendarConnection.objects.filter(user=user).order_by(
            "-is_primary", "-updated_at", "-connected_at"
        )
    )
    connection = connections[0] if connections else None
    calendar_authorized = bool(
        connection
        and connection.calendar_authorized
        and has_calendar_app_scope(connection)
    )
    active_roots = TodoOccurrence.objects.filter(
        user=user,
        deleted_at__isnull=True,
        task__deleted_at__isnull=True,
    ).values("root_id")
    failed_count = GoogleCalendarEventLink.objects.filter(
        user=user,
        root_id__in=active_roots,
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
        "accounts": [
            {
                "id": str(item.id),
                "googleEmail": item.google_email,
                "googleName": item.google_name,
                "calendarAuthorized": bool(
                    item.calendar_authorized and has_calendar_app_scope(item)
                ),
                "syncEnabled": bool(
                    item.sync_enabled
                    and item.calendar_authorized
                    and has_calendar_app_scope(item)
                ),
                "calendarId": item.calendar_id,
                "calendarName": settings.GOOGLE_CALENDAR_NAME,
                "connectedAt": item.connected_at.isoformat(),
                "lastSyncAt": item.last_sync_at.isoformat() if item.last_sync_at else None,
                "lastError": item.last_error,
                "isPrimary": item.is_primary,
            }
            for item in connections
        ],
    }


@transaction.atomic
def disconnect_google_calendar(user, connection_id=None) -> None:
    queryset = GoogleCalendarConnection.objects.filter(user=user)
    if connection_id:
        queryset = queryset.filter(id=connection_id)
    was_primary = queryset.filter(is_primary=True).exists()
    queryset.delete()
    if was_primary and not GoogleCalendarConnection.objects.filter(user=user, is_primary=True).exists():
        next_connection = GoogleCalendarConnection.objects.filter(user=user).order_by("-updated_at").first()
        if next_connection:
            next_connection.is_primary = True
            next_connection.save(update_fields=["is_primary", "updated_at"])


@transaction.atomic
def set_google_calendar_sync_enabled(user, enabled: bool, connection_id=None) -> dict:
    connection = (
        GoogleCalendarConnection.objects.filter(user=user, id=connection_id).first()
        if connection_id
        else primary_google_connection(user)
    )
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
    connections = GoogleCalendarConnection.objects.filter(
        user=user,
        calendar_authorized=True,
        sync_enabled=True,
    )
    if not connections.exists() or not is_google_calendar_configured():
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

    for connection in connections:
        sync_occurrence_to_google_calendar_connection(user, occurrence, connection)


def sync_occurrence_to_google_calendar_connection(
    user,
    occurrence: TodoOccurrence,
    connection: GoogleCalendarConnection,
) -> None:
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
        connection=connection,
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
    connections = GoogleCalendarConnection.objects.filter(
        user=user,
        calendar_authorized=True,
        sync_enabled=True,
    )
    links = GoogleCalendarEventLink.objects.filter(user=user, root_id=occurrence.root_id)
    if not connections.exists() or not links.exists() or not is_google_calendar_configured():
        return

    connections_by_id = {item.id: item for item in connections}
    for link in links:
        connection = link.connection or primary_google_connection(user)
        if not connection or connection.id not in connections_by_id or not link.google_event_id:
            continue
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

    sync_connections = GoogleCalendarConnection.objects.filter(user=user, sync_enabled=True)
    if not GoogleCalendarConnection.objects.filter(user=user).exists():
        raise GoogleCalendarError("Bind a Google account before syncing Calendar.")
    authorized_connections = [
        item
        for item in sync_connections
        if item.calendar_authorized and has_calendar_app_scope(item)
    ]
    if not authorized_connections:
        if sync_connections.exists():
            raise GoogleCalendarError("Authorize Google Calendar before syncing.")
        raise GoogleCalendarError("Turn on Google Calendar sync before syncing.")
    for connection in authorized_connections:
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
