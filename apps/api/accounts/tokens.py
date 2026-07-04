from datetime import timedelta
from secrets import token_urlsafe

import jwt
from django.conf import settings
from django.contrib.auth import get_user_model
from django.utils import timezone

from .models import RefreshToken

ALGORITHM = "HS256"


def issue_access_token(user) -> str:
    now = timezone.now()
    payload = {
        "type": "access",
        "sub": str(user.id),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=settings.ACCESS_TOKEN_TTL_MINUTES)).timestamp()),
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=ALGORITHM)


def issue_mobility_token(user) -> str:
    """Long-lived token scoped to mobility uploads only. The Android
    foreground service runs for days without the JS runtime (and its
    refresh-token flow) awake, so a 15-minute access token goes stale almost
    immediately; this is the standard scoped-device-token answer. Accepted
    exclusively by mobility endpoints - it cannot read todos or account
    data."""
    now = timezone.now()
    payload = {
        "type": "mobility",
        "sub": str(user.id),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(days=settings.MOBILITY_TOKEN_TTL_DAYS)).timestamp()),
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=ALGORITHM)


def issue_device_timeline_token(user) -> str:
    """Long-lived token scoped to device-timeline uploads only, mirroring
    issue_mobility_token: the Android foreground service that logs app
    switches and screen lock/unlock runs far longer than a 15-minute access
    token survives. Accepted exclusively by device-timeline endpoints."""
    now = timezone.now()
    payload = {
        "type": "device_timeline",
        "sub": str(user.id),
        "iat": int(now.timestamp()),
        "exp": int(
            (now + timedelta(days=settings.DEVICE_TIMELINE_TOKEN_TTL_DAYS)).timestamp()
        ),
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=ALGORITHM)


def issue_refresh_token(request, user) -> str:
    raw_token = token_urlsafe(48)
    RefreshToken.objects.create(
        user=user,
        token_hash=RefreshToken.hash_token(raw_token),
        expires_at=timezone.now() + timedelta(days=settings.REFRESH_TOKEN_TTL_DAYS),
        user_agent=request.META.get("HTTP_USER_AGENT", "")[:255],
        ip_address=request.META.get("REMOTE_ADDR") or None,
    )
    return raw_token


def issue_token_pair(request, user) -> dict[str, str]:
    return {
        "accessToken": issue_access_token(user),
        "refreshToken": issue_refresh_token(request, user),
        "tokenType": "bearer",
    }


def _authenticate_token_of_type(token: str, expected_type: str):
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.PyJWTError:
        return None

    if payload.get("type") != expected_type:
        return None

    user_id = payload.get("sub")
    if not user_id:
        return None

    User = get_user_model()
    return User.objects.filter(id=user_id, is_active=True).first()


def authenticate_access_token(token: str):
    return _authenticate_token_of_type(token, "access")


def authenticate_mobility_token(token: str):
    return _authenticate_token_of_type(token, "mobility")


def authenticate_device_timeline_token(token: str):
    return _authenticate_token_of_type(token, "device_timeline")

