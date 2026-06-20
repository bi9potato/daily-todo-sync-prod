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


def authenticate_access_token(token: str):
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.PyJWTError:
        return None

    if payload.get("type") != "access":
        return None

    user_id = payload.get("sub")
    if not user_id:
        return None

    User = get_user_model()
    return User.objects.filter(id=user_id, is_active=True).first()

