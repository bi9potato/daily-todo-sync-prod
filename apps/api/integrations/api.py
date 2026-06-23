from django.core import signing
from django.http import HttpResponseRedirect
from ninja import Router, Schema
from ninja.errors import HttpError

from accounts.authentication import bearer_auth

from .google_calendar import GoogleCalendarError
from .services import (
    build_google_account_bind_url,
    build_google_calendar_auth_url,
    callback_redirect_url,
    disconnect_google_calendar,
    frontend_url,
    google_calendar_status,
    handle_google_oauth_callback,
    set_google_calendar_sync_enabled,
    sync_google_calendar_window,
)

router = Router(tags=["integrations"])


class GoogleCalendarAccountOut(Schema):
    id: str
    googleEmail: str
    googleName: str
    calendarAuthorized: bool
    syncEnabled: bool
    calendarId: str
    calendarName: str
    connectedAt: str
    lastSyncAt: str | None
    lastError: str
    isPrimary: bool


class GoogleCalendarStatusOut(Schema):
    configured: bool
    connected: bool
    googleBound: bool
    googleEmail: str
    googleName: str
    calendarAuthorized: bool
    canUseCalendarSync: bool
    syncEnabled: bool
    calendarId: str
    calendarName: str
    connectedAt: str | None
    lastSyncAt: str | None
    lastError: str
    syncedCount: int
    failedCount: int
    accounts: list[GoogleCalendarAccountOut] = []


class GoogleCalendarAuthUrlOut(Schema):
    authorizationUrl: str


class GoogleCalendarSyncOut(Schema):
    start: str
    end: str
    synced: int


class GoogleCalendarSyncToggleIn(Schema):
    enabled: bool
    connectionId: str | None = None


class GoogleCalendarConnectionIn(Schema):
    connectionId: str | None = None


@router.get("/google-calendar/status", response=GoogleCalendarStatusOut, auth=bearer_auth)
def get_google_calendar_status(request):
    return google_calendar_status(request.auth)


@router.post("/google-account/bind", response=GoogleCalendarAuthUrlOut, auth=bearer_auth)
def bind_google_account(request):
    try:
        return {"authorizationUrl": build_google_account_bind_url(request.auth, request)}
    except GoogleCalendarError as exc:
        raise HttpError(400, str(exc)) from exc


@router.post("/google-account/disconnect", response={204: None}, auth=bearer_auth)
def disconnect_google_account_endpoint(request, payload: GoogleCalendarConnectionIn | None = None):
    disconnect_google_calendar(request.auth, payload.connectionId if payload else None)
    return 204, None


@router.post("/google-calendar/connect", response=GoogleCalendarAuthUrlOut, auth=bearer_auth)
def connect_google_calendar(request, payload: GoogleCalendarConnectionIn | None = None):
    try:
        return {
            "authorizationUrl": build_google_calendar_auth_url(
                request.auth,
                request,
                payload.connectionId if payload else None,
            )
        }
    except GoogleCalendarError as exc:
        raise HttpError(400, str(exc)) from exc


@router.post("/google-calendar/authorize", response=GoogleCalendarAuthUrlOut, auth=bearer_auth)
def authorize_google_calendar(request, payload: GoogleCalendarConnectionIn | None = None):
    try:
        return {
            "authorizationUrl": build_google_calendar_auth_url(
                request.auth,
                request,
                payload.connectionId if payload else None,
            )
        }
    except GoogleCalendarError as exc:
        raise HttpError(400, str(exc)) from exc


@router.post("/google-calendar/disconnect", response={204: None}, auth=bearer_auth)
def disconnect_google_calendar_endpoint(request):
    disconnect_google_calendar(request.auth)
    return 204, None


@router.post("/google-calendar/sync", response=GoogleCalendarSyncOut, auth=bearer_auth)
def sync_google_calendar(request, days: int = 45):
    try:
        return sync_google_calendar_window(request.auth, days=days)
    except GoogleCalendarError as exc:
        raise HttpError(400, str(exc)) from exc


@router.patch("/google-calendar/sync-enabled", response=GoogleCalendarStatusOut, auth=bearer_auth)
def set_google_calendar_sync(request, payload: GoogleCalendarSyncToggleIn):
    try:
        return set_google_calendar_sync_enabled(
            request.auth,
            payload.enabled,
            payload.connectionId,
        )
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
        return_url, oauth_status = handle_google_oauth_callback(
            code=code,
            state=state,
            request=request,
        )
    except (GoogleCalendarError, signing.BadSignature, signing.SignatureExpired, KeyError) as exc:
        return HttpResponseRedirect(
            callback_redirect_url(frontend_url(request), status="error", message=str(exc))
        )

    return HttpResponseRedirect(callback_redirect_url(return_url, status=oauth_status))
