from urllib.parse import quote

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core import signing
from django.core.exceptions import ValidationError
from django.db import IntegrityError
from django.db.models import Q
from django.http import HttpResponseRedirect
from django.utils import timezone
from integrations.google_calendar import (
    GOOGLE_ACCOUNT_SCOPE,
    GoogleCalendarError,
    authorization_url,
    exchange_code_for_tokens,
    fetch_google_userinfo,
)
from integrations.models import GoogleCalendarConnection
from ninja import Router, Schema
from ninja.errors import HttpError

from .authentication import bearer_auth
from .models import RefreshToken
from .tokens import issue_token_pair

router = Router(tags=["auth"])
GOOGLE_AUTH_STATE_SALT = "daily-todo-sync.google-auth"
GOOGLE_AUTH_STATE_MAX_AGE_SECONDS = 10 * 60


class RegisterIn(Schema):
    username: str
    email: str
    password: str


class LoginIn(Schema):
    identifier: str
    password: str


class RefreshIn(Schema):
    refreshToken: str


class LogoutIn(Schema):
    refreshToken: str | None = None


class TokenOut(Schema):
    accessToken: str
    refreshToken: str
    tokenType: str


class UserOut(Schema):
    id: str
    username: str
    email: str


class GoogleAuthUrlOut(Schema):
    authorizationUrl: str


def frontend_url(request) -> str:
    if settings.FRONTEND_URL:
        return settings.FRONTEND_URL.rstrip("/")
    return request.build_absolute_uri("/").rstrip("/")


def google_auth_redirect_uri(request) -> str:
    if settings.GOOGLE_AUTH_REDIRECT_URI:
        return settings.GOOGLE_AUTH_REDIRECT_URI
    return request.build_absolute_uri("/api/auth/google/callback")


def callback_redirect_url(base_url: str, **params: str) -> str:
    separator = "&" if "?" in base_url else "?"
    query = "&".join(f"{key}={quote(value)}" for key, value in params.items())
    return f"{base_url}{separator}{query}"


@router.post("/register", response={201: TokenOut})
def register(request, payload: RegisterIn):
    username = payload.username.strip()
    email = payload.email.strip().lower()
    password = payload.password

    if not username or not email or not password:
        raise HttpError(400, "Username, email, and password are required.")

    User = get_user_model()
    user = User(username=username, email=email)
    try:
        validate_password(password, user)
    except ValidationError as exc:
        raise HttpError(400, " ".join(exc.messages)) from exc

    user.set_password(password)
    try:
        user.save()
    except IntegrityError as exc:
        raise HttpError(400, "Username or email already exists.") from exc

    return 201, issue_token_pair(request, user)


@router.post("/login", response=TokenOut)
def login(request, payload: LoginIn):
    identifier = payload.identifier.strip()
    password = payload.password

    User = get_user_model()
    user = User.objects.filter(Q(username=identifier) | Q(email__iexact=identifier)).first()
    if user is None or not user.check_password(password) or not user.is_active:
        raise HttpError(401, "Invalid credentials.")

    return issue_token_pair(request, user)


@router.post("/google", response=GoogleAuthUrlOut)
def google_auth_url(request):
    if not settings.GOOGLE_CALENDAR_CLIENT_ID or not settings.GOOGLE_CALENDAR_CLIENT_SECRET:
        raise HttpError(400, "Google login is not configured.")
    state = signing.dumps(
        {"return_url": frontend_url(request)},
        salt=GOOGLE_AUTH_STATE_SALT,
    )
    return {
        "authorizationUrl": authorization_url(
            state=state,
            redirect_uri=google_auth_redirect_uri(request),
            scope=GOOGLE_ACCOUNT_SCOPE,
        )
    }


@router.get("/google/callback")
def google_auth_callback(
    request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
):
    return_url = frontend_url(request)
    if error:
        return HttpResponseRedirect(
            callback_redirect_url(return_url, googleAuth="error", message=error)
        )
    if not code or not state:
        return HttpResponseRedirect(
            callback_redirect_url(
                return_url,
                googleAuth="error",
                message="Missing Google callback data.",
            )
        )

    try:
        payload = signing.loads(
            state,
            salt=GOOGLE_AUTH_STATE_SALT,
            max_age=GOOGLE_AUTH_STATE_MAX_AGE_SECONDS,
        )
        return_url = payload.get("return_url") or return_url
        token_body = exchange_code_for_tokens(
            code=code,
            redirect_uri=google_auth_redirect_uri(request),
        )
        access_token = str(token_body.get("access_token") or "")
        userinfo = fetch_google_userinfo(access_token)
    except (GoogleCalendarError, signing.BadSignature, signing.SignatureExpired, KeyError) as exc:
        return HttpResponseRedirect(
            callback_redirect_url(return_url, googleAuth="error", message=str(exc))
        )

    subject = str(userinfo.get("sub") or "").strip()
    email = str(userinfo.get("email") or "").strip().lower()
    name = str(userinfo.get("name") or "").strip()
    if not email:
        return HttpResponseRedirect(
            callback_redirect_url(
                return_url,
                googleAuth="error",
                message="Google account did not return an email.",
            )
        )

    User = get_user_model()
    connection = None
    if subject:
        connection = (
            GoogleCalendarConnection.objects.select_related("user")
            .filter(google_subject=subject, user__is_active=True)
            .first()
        )
    user = connection.user if connection else User.objects.filter(email__iexact=email).first()
    if user is None:
        base_username = (email.split("@")[0] or "google").replace(".", "-")[:140]
        username = base_username
        suffix = 1
        while User.objects.filter(username=username).exists():
            suffix += 1
            username = f"{base_username}-{suffix}"[:150]
        user = User(username=username, email=email, first_name=name[:150])
        user.set_unusable_password()
        user.save()
    if not user.is_active:
        return HttpResponseRedirect(
            callback_redirect_url(
                return_url,
                googleAuth="error",
                message="This account is disabled.",
            )
        )

    tokens = issue_token_pair(request, user)
    return HttpResponseRedirect(
        callback_redirect_url(
            return_url,
            googleAuth="success",
            accessToken=tokens["accessToken"],
            refreshToken=tokens["refreshToken"],
        )
    )


@router.post("/refresh", response=TokenOut)
def refresh(request, payload: RefreshIn):
    now = timezone.now()
    token_hash = RefreshToken.hash_token(payload.refreshToken)
    refresh_token = (
        RefreshToken.objects.select_related("user")
        .filter(
            token_hash=token_hash,
            revoked_at__isnull=True,
            expires_at__gt=now,
            user__is_active=True,
        )
        .first()
    )
    if refresh_token is None:
        raise HttpError(401, "Invalid refresh token.")

    refresh_token.revoked_at = now
    refresh_token.save(update_fields=["revoked_at"])
    return issue_token_pair(request, refresh_token.user)


@router.post("/logout", response={204: None})
def logout(request, payload: LogoutIn):
    if payload.refreshToken:
        RefreshToken.objects.filter(
            token_hash=RefreshToken.hash_token(payload.refreshToken),
            revoked_at__isnull=True,
        ).update(revoked_at=timezone.now())
    return 204, None


@router.get("/me", response=UserOut, auth=bearer_auth)
def me(request):
    user = request.auth
    return {"id": str(user.id), "username": user.username, "email": user.email}
