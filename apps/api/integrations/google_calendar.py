import json
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from django.conf import settings
from django.utils import timezone

from todos.models import Task, TodoOccurrence

from .models import GoogleCalendarConnection

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"
GOOGLE_CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3"
GOOGLE_ACCOUNT_SCOPE = "openid email profile"
GOOGLE_CALENDAR_APP_SCOPE = "https://www.googleapis.com/auth/calendar.app.created"
GOOGLE_CALENDAR_SCOPE = f"{GOOGLE_ACCOUNT_SCOPE} {GOOGLE_CALENDAR_APP_SCOPE}"


class GoogleCalendarError(Exception):
    def __init__(self, message: str, *, status: int | None = None):
        super().__init__(message)
        self.status = status


def is_google_calendar_configured() -> bool:
    return bool(settings.GOOGLE_CALENDAR_CLIENT_ID and settings.GOOGLE_CALENDAR_CLIENT_SECRET)


def authorization_url(
    *,
    state: str,
    redirect_uri: str,
    scope: str,
    login_hint: str = "",
) -> str:
    params = {
        "access_type": "offline",
        "client_id": settings.GOOGLE_CALENDAR_CLIENT_ID,
        "include_granted_scopes": "true",
        "prompt": "consent",
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": scope,
        "state": state,
    }
    if login_hint:
        params["login_hint"] = login_hint
    query = urlencode(params)
    return f"{GOOGLE_AUTH_URL}?{query}"


def exchange_code_for_tokens(*, code: str, redirect_uri: str) -> dict[str, Any]:
    return _post_form(
        GOOGLE_TOKEN_URL,
        {
            "client_id": settings.GOOGLE_CALENDAR_CLIENT_ID,
            "client_secret": settings.GOOGLE_CALENDAR_CLIENT_SECRET,
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": redirect_uri,
        },
    )


def refresh_access_token(connection: GoogleCalendarConnection) -> str:
    if not connection.refresh_token:
        raise GoogleCalendarError("Google Calendar refresh token is missing.")

    body = _post_form(
        GOOGLE_TOKEN_URL,
        {
            "client_id": settings.GOOGLE_CALENDAR_CLIENT_ID,
            "client_secret": settings.GOOGLE_CALENDAR_CLIENT_SECRET,
            "grant_type": "refresh_token",
            "refresh_token": connection.refresh_token,
        },
    )
    save_token_response(connection, body)
    return connection.access_token


def access_token_for(connection: GoogleCalendarConnection) -> str:
    expires_at = connection.token_expires_at
    if expires_at is None or expires_at <= timezone.now() + timedelta(seconds=60):
        return refresh_access_token(connection)
    return connection.access_token


def save_token_response(connection: GoogleCalendarConnection, body: dict[str, Any]) -> None:
    access_token = str(body.get("access_token") or "")
    if not access_token:
        raise GoogleCalendarError("Google OAuth response did not include an access token.")

    expires_in = int(body.get("expires_in") or 3600)
    connection.access_token = access_token
    if body.get("refresh_token"):
        connection.refresh_token = str(body["refresh_token"])
    connection.token_expires_at = timezone.now() + timedelta(seconds=expires_in)
    if body.get("scope"):
        connection.scope = str(body["scope"])
    connection.last_error = ""
    connection.save(
        update_fields=[
            "access_token",
            "refresh_token",
            "token_expires_at",
            "scope",
            "last_error",
            "updated_at",
        ]
    )


def has_calendar_app_scope(connection: GoogleCalendarConnection) -> bool:
    scopes = set((connection.scope or "").split())
    return (
        GOOGLE_CALENDAR_APP_SCOPE in scopes
        or "https://www.googleapis.com/auth/calendar" in scopes
    )


def ensure_app_calendar(connection: GoogleCalendarConnection) -> None:
    if connection.calendar_id and connection.calendar_id != "primary":
        return

    token = access_token_for(connection)
    calendar = _calendar_request(
        "POST",
        "/calendars",
        token=token,
        payload={
            "summary": settings.GOOGLE_CALENDAR_NAME,
            "timeZone": settings.TIME_ZONE,
        },
    )
    calendar_id = str(calendar.get("id") or "")
    if not calendar_id:
        raise GoogleCalendarError("Google Calendar did not return a calendar id.")

    connection.calendar_id = calendar_id
    connection.save(update_fields=["calendar_id", "updated_at"])


def insert_event(connection: GoogleCalendarConnection, payload: dict[str, Any]) -> dict[str, Any]:
    ensure_app_calendar(connection)
    token = access_token_for(connection)
    calendar_id = connection.calendar_id or "primary"
    path = f"/calendars/{calendar_id}/events?{urlencode({'sendUpdates': 'none'})}"
    return _calendar_request("POST", path, token=token, payload=payload)


def patch_event(
    connection: GoogleCalendarConnection,
    event_id: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    ensure_app_calendar(connection)
    token = access_token_for(connection)
    calendar_id = connection.calendar_id or "primary"
    path = f"/calendars/{calendar_id}/events/{event_id}?{urlencode({'sendUpdates': 'none'})}"
    return _calendar_request("PATCH", path, token=token, payload=payload)


def delete_event(
    connection: GoogleCalendarConnection,
    event_id: str,
    *,
    calendar_id: str = "",
) -> None:
    token = access_token_for(connection)
    calendar_id = calendar_id or connection.calendar_id or "primary"
    path = f"/calendars/{calendar_id}/events/{event_id}?{urlencode({'sendUpdates': 'none'})}"
    try:
        _calendar_request("DELETE", path, token=token)
    except GoogleCalendarError as exc:
        if exc.status != 404:
            raise


def fetch_google_userinfo(access_token: str) -> dict[str, Any]:
    request = Request(
        GOOGLE_USERINFO_URL,
        headers={"Authorization": f"Bearer {access_token}"},
        method="GET",
    )
    return _send_json_request(request)


def build_google_calendar_event(occurrence: TodoOccurrence) -> dict[str, Any]:
    task = occurrence.task
    start_date = task.recurrence_start_date if is_recurring(task) else occurrence.task_date
    summary = f"{'[Done] ' if occurrence.status == TodoOccurrence.Status.DONE else ''}{task.text}"
    event_date = start_date or occurrence.task_date

    payload: dict[str, Any] = {
        "summary": summary,
        "description": event_description(task),
        "extendedProperties": {
            "private": {
                "dailyTodoRootId": str(occurrence.root_id),
                "dailyTodoTaskId": str(task.id),
            }
        },
    }

    if task.reminder_time is None:
        payload["start"] = {"date": event_date.isoformat()}
        payload["end"] = {"date": (event_date + timedelta(days=1)).isoformat()}
        payload["reminders"] = {"useDefault": False}
    else:
        start_at = combine_date_and_time(event_date, task.reminder_time)
        end_at = start_at + timedelta(minutes=settings.GOOGLE_CALENDAR_EVENT_DURATION_MINUTES)
        payload["start"] = {
            "dateTime": start_at.isoformat(),
            "timeZone": settings.TIME_ZONE,
        }
        payload["end"] = {
            "dateTime": end_at.isoformat(),
            "timeZone": settings.TIME_ZONE,
        }
        payload["reminders"] = {"useDefault": True}

    recurrence = recurrence_rule(task)
    if recurrence:
        payload["recurrence"] = [recurrence]

    return payload


def combine_date_and_time(task_date, reminder_time):
    if reminder_time is None:
        raise GoogleCalendarError("Cannot build a timed Google Calendar event without a reminder time.")
    naive = datetime.combine(task_date, reminder_time)
    return timezone.make_aware(naive, timezone.get_current_timezone())


def event_description(task: Task) -> str:
    lines = []
    if task.note:
        lines.append(task.note)
        lines.append("")
    lines.append("Synced one-way from Daily Todo Sync.")
    lines.append("Changes made in Google Calendar will not update the todo.")
    return "\n".join(lines)


def is_recurring(task: Task) -> bool:
    return task.recurrence_kind != Task.RecurrenceKind.NONE


def recurrence_rule(task: Task) -> str | None:
    if not is_recurring(task):
        return None

    interval = max(task.recurrence_interval or 1, 1)
    parts: list[str]
    if task.recurrence_kind == Task.RecurrenceKind.DAILY:
        parts = ["FREQ=DAILY"]
    elif task.recurrence_kind == Task.RecurrenceKind.WEEKDAYS:
        parts = ["FREQ=WEEKLY", "BYDAY=MO,TU,WE,TH,FR"]
    elif task.recurrence_kind == Task.RecurrenceKind.WEEKLY:
        days = task.recurrence_days_of_week or []
        by_day = ",".join(weekday_to_rrule(day) for day in days)
        parts = ["FREQ=WEEKLY"]
        if by_day:
            parts.append(f"BYDAY={by_day}")
    elif task.recurrence_kind == Task.RecurrenceKind.MONTHLY:
        parts = ["FREQ=MONTHLY"]
    elif task.recurrence_kind == Task.RecurrenceKind.YEARLY:
        parts = ["FREQ=YEARLY"]
    else:
        return None

    if interval > 1:
        parts.append(f"INTERVAL={interval}")
    if task.recurrence_until:
        until = datetime.combine(task.recurrence_until, datetime.max.time())
        until_utc = timezone.make_aware(until, timezone.get_current_timezone()).astimezone(UTC)
        parts.append(f"UNTIL={until_utc.strftime('%Y%m%dT%H%M%SZ')}")
    return "RRULE:" + ";".join(parts)


def weekday_to_rrule(day: int) -> str:
    return ["MO", "TU", "WE", "TH", "FR", "SA", "SU"][day]


def _post_form(url: str, data: dict[str, str]) -> dict[str, Any]:
    encoded = urlencode(data).encode()
    request = Request(
        url,
        data=encoded,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    return _send_json_request(request)


def _calendar_request(
    method: str,
    path: str,
    *,
    token: str,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    data = json.dumps(payload).encode() if payload is not None else None
    request = Request(
        GOOGLE_CALENDAR_API_BASE + path,
        data=data,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method=method,
    )
    return _send_json_request(request)


def _send_json_request(request: Request) -> dict[str, Any]:
    try:
        with urlopen(request, timeout=10) as response:
            raw = response.read().decode()
            return json.loads(raw) if raw else {}
    except HTTPError as exc:
        body = exc.read().decode()
        message = body
        try:
            payload = json.loads(body)
            message = (
                payload.get("error_description")
                or payload.get("error", {}).get("message")
                or payload.get("error")
                or body
            )
        except json.JSONDecodeError:
            pass
        raise GoogleCalendarError(str(message), status=exc.code) from exc
