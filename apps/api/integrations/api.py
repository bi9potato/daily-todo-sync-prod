from django.core import signing
from django.http import HttpResponseRedirect
from ninja import Router, Schema
from ninja.errors import HttpError

from accounts.authentication import bearer_auth

from .google_calendar import GoogleCalendarError
from .services import (
    build_google_calendar_auth_url,
    callback_redirect_url,
    connect_google_calendar_from_callback,
    disconnect_google_calendar,
    frontend_url,
    google_calendar_status,
    sync_google_calendar_window,
)

router = Router(tags=["integrations"])


class GoogleCalendarStatusOut(Schema):
    configured: bool
    connected: bool
    syncEnabled: bool
    calendarId: str
    connectedAt: str | None
    lastSyncAt: str | None
    lastError: str
    syncedCount: int
    failedCount: int


class GoogleCalendarAuthUrlOut(Schema):
    authorizationUrl: str


class GoogleCalendarSyncOut(Schema):
    start: str
    end: str
    synced: int


@router.get("/google-calendar/status", response=GoogleCalendarStatusOut, auth=bearer_auth)
def get_google_calendar_status(request):
    return google_calendar_status(request.auth)


@router.post("/google-calendar/connect", response=GoogleCalendarAuthUrlOut, auth=bearer_auth)
def connect_google_calendar(request):
    try:
        return {"authorizationUrl": build_google_calendar_auth_url(request.auth, request)}
    except GoogleCalendarError as exc:
        raise HttpError(400, str(exc)) from exc


@router.post("/google-calendar/disconnect", response={204: None}, auth=bearer_auth)
def disconnect_google_calendar_endpoint(request):
    disconnect_google_calendar(request.auth)
    return 204, None


@router.post("/google-calendar/sync", response=GoogleCalendarSyncOut, auth=bearer_auth)
def sync_google_calendar(request):
    try:
        return sync_google_calendar_window(request.auth)
    except GoogleCalendarError as exc:
        raise HttpError(400, str(exc)) from exc


@router.get("/google-calendar/callback")
def google_calendar_callback(
    request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
):
    return_url = frontend_url(request)
    if error:
        return HttpResponseRedirect(
            callback_redirect_url(return_url, status="error", message=error)
        )
    if not code or not state:
        return HttpResponseRedirect(
            callback_redirect_url(
                return_url,
                status="error",
                message="Missing OAuth callback data.",
            )
        )

    try:
        return_url = connect_google_calendar_from_callback(
            code=code,
            state=state,
            request=request,
        )
    except (GoogleCalendarError, signing.BadSignature, signing.SignatureExpired, KeyError) as exc:
        return HttpResponseRedirect(
            callback_redirect_url(frontend_url(request), status="error", message=str(exc))
        )

    return HttpResponseRedirect(callback_redirect_url(return_url, status="connected"))
