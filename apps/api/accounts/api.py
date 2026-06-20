from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.db import IntegrityError
from django.db.models import Q
from django.utils import timezone
from ninja import Router, Schema
from ninja.errors import HttpError

from .authentication import bearer_auth
from .models import RefreshToken
from .tokens import issue_token_pair

router = Router(tags=["auth"])


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

