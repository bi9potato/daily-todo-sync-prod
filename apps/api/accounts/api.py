import base64
import hashlib
import hmac
import logging
import re
import secrets
from datetime import timedelta
from urllib.parse import quote

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import check_password, make_password
from django.contrib.auth.password_validation import validate_password
from django.core import signing
from django.core.exceptions import ValidationError
from django.core.mail import send_mail
from django.core.validators import validate_email
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.http import HttpResponseRedirect
from django.utils import timezone
from ninja import Router, Schema
from ninja.errors import HttpError

from integrations.google_calendar import (
    GOOGLE_ACCOUNT_SCOPE,
    GoogleCalendarError,
    authorization_url,
    exchange_code_for_tokens,
    fetch_google_userinfo,
)
from integrations.models import GoogleCalendarConnection

from .authentication import bearer_auth
from .models import EmailVerificationCode, GoogleLoginExchangeCode, RefreshToken
from .tokens import issue_token_pair

router = Router(tags=["auth"])
logger = logging.getLogger(__name__)
GOOGLE_AUTH_STATE_SALT = "daily-todo-sync.google-auth"
GOOGLE_AUTH_STATE_MAX_AGE_SECONDS = 10 * 60
ANDROID_GOOGLE_FLOW = "android"
ANDROID_GOOGLE_EXCHANGE_TTL_SECONDS = 2 * 60
EMAIL_CODE_MAX_ATTEMPTS = 5
EMAIL_CODE_MAX_PER_HOUR = 5
EMAIL_CODE_MAX_PER_IP_HOUR = 20
EMAIL_CODE_PATTERN = re.compile(r"^\d{6}$")
PKCE_VALUE_PATTERN = re.compile(r"^[A-Za-z0-9_-]{43,128}$")


class AndroidAuthRedirect(HttpResponseRedirect):
    allowed_schemes = [*HttpResponseRedirect.allowed_schemes, "daily-todo"]


class RegisterIn(Schema):
    username: str
    email: str
    password: str


class AndroidRegistrationCodeIn(Schema):
    email: str


class AndroidRegistrationCodeOut(Schema):
    detail: str
    retryAfterSeconds: int


class AndroidRegisterIn(RegisterIn):
    verificationCode: str


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
    displayName: str


class GoogleAuthUrlOut(Schema):
    authorizationUrl: str


class AndroidGoogleAuthIn(Schema):
    codeChallenge: str


class AndroidGoogleAuthUrlOut(GoogleAuthUrlOut):
    redirectUrl: str


class AndroidGoogleExchangeIn(Schema):
    code: str
    codeVerifier: str


class ProfileUpdateIn(Schema):
    displayName: str


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


def android_google_redirect_url(**params: str) -> str:
    return callback_redirect_url(settings.ANDROID_GOOGLE_AUTH_RETURN_URL, **params)


def client_ip(request) -> str | None:
    return request.META.get("REMOTE_ADDR") or None


def validate_android_registration_email(email: str) -> None:
    try:
        validate_email(email)
    except ValidationError as exc:
        raise HttpError(400, "请输入有效的邮箱地址。") from exc


def ensure_registration_identity_available(username: str, email: str) -> None:
    User = get_user_model()
    if User.objects.filter(
        Q(username__iexact=username)
        | Q(email__iexact=username)
        | Q(username__iexact=email)
        | Q(email__iexact=email)
    ).exists():
        raise HttpError(400, "用户名或邮箱已存在。")


def validate_registration_username(username: str) -> None:
    User = get_user_model()
    try:
        User._meta.get_field("username").run_validators(username)
    except ValidationError as exc:
        raise HttpError(400, " ".join(exc.messages)) from exc


def validate_registration_password(username: str, email: str, password: str) -> None:
    User = get_user_model()
    candidate = User(username=username, email=email, first_name=username)
    try:
        validate_password(password, candidate)
    except ValidationError as exc:
        raise HttpError(400, " ".join(exc.messages)) from exc


def create_user(username: str, email: str, password: str):
    User = get_user_model()
    user = User(username=username, email=email, first_name=username)
    user.set_password(password)
    user.save()
    return user


@router.post(
    "/android/register/code",
    response={202: AndroidRegistrationCodeOut},
)
def request_android_registration_code(request, payload: AndroidRegistrationCodeIn):
    email = payload.email.strip().lower()
    if not email:
        raise HttpError(400, "请输入邮箱地址。")
    validate_android_registration_email(email)

    User = get_user_model()
    if User.objects.filter(email__iexact=email).exists():
        raise HttpError(400, "该邮箱已注册。")

    now = timezone.now()
    resend_after = now - timedelta(seconds=settings.EMAIL_VERIFICATION_RESEND_SECONDS)
    if EmailVerificationCode.objects.filter(
        email=email,
        created_at__gt=resend_after,
    ).exists():
        raise HttpError(429, "验证码发送过于频繁，请稍后再试。")

    hourly_cutoff = now - timedelta(hours=1)
    if (
        EmailVerificationCode.objects.filter(
            email=email,
            created_at__gte=hourly_cutoff,
        ).count()
        >= EMAIL_CODE_MAX_PER_HOUR
    ):
        raise HttpError(429, "验证码请求次数过多，请一小时后再试。")

    request_ip = client_ip(request)
    if (
        request_ip
        and EmailVerificationCode.objects.filter(
            request_ip=request_ip,
            created_at__gte=hourly_cutoff,
        ).count()
        >= EMAIL_CODE_MAX_PER_IP_HOUR
    ):
        raise HttpError(429, "验证码请求次数过多，请一小时后再试。")

    code = f"{secrets.randbelow(1_000_000):06d}"
    verification = EmailVerificationCode.objects.create(
        email=email,
        code_hash=make_password(code),
        request_ip=request_ip,
        expires_at=now
        + timedelta(minutes=settings.EMAIL_VERIFICATION_CODE_TTL_MINUTES),
    )
    try:
        sent = send_mail(
            subject="Daily Todo 注册验证码",
            message=(
                f"你的 Daily Todo 注册验证码是：{code}\n\n"
                f"验证码将在 {settings.EMAIL_VERIFICATION_CODE_TTL_MINUTES} 分钟后失效。\n"
                "如果不是你本人操作，请忽略此邮件。"
            ),
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[email],
            fail_silently=False,
        )
        if sent != 1:
            raise RuntimeError("Email backend did not accept the message.")
    except Exception as exc:
        verification.delete()
        logger.exception("Failed to send Android registration verification email")
        raise HttpError(503, "验证码邮件发送失败，请稍后重试。") from exc

    EmailVerificationCode.objects.filter(
        email=email,
        consumed_at__isnull=True,
    ).exclude(id=verification.id).update(consumed_at=now)
    return 202, {
        "detail": "验证码已发送，请检查邮箱。",
        "retryAfterSeconds": settings.EMAIL_VERIFICATION_RESEND_SECONDS,
    }


@router.post("/android/register", response={201: TokenOut})
def android_register(request, payload: AndroidRegisterIn):
    username = payload.username.strip()
    email = payload.email.strip().lower()
    password = payload.password
    verification_code = payload.verificationCode.strip()

    if not username or not email or not password or not verification_code:
        raise HttpError(400, "用户名、邮箱、密码和验证码均为必填项。")
    validate_android_registration_email(email)
    if not EMAIL_CODE_PATTERN.fullmatch(verification_code):
        raise HttpError(400, "请输入 6 位邮箱验证码。")
    validate_registration_username(username)
    validate_registration_password(username, email, password)
    ensure_registration_identity_available(username, email)

    error_message: str | None = None
    user = None
    try:
        with transaction.atomic():
            verification = (
                EmailVerificationCode.objects.select_for_update()
                .filter(email=email, consumed_at__isnull=True)
                .order_by("-created_at")
                .first()
            )
            now = timezone.now()
            if verification is None:
                error_message = "请先获取邮箱验证码。"
            elif verification.expires_at <= now:
                verification.consumed_at = now
                verification.save(update_fields=["consumed_at"])
                error_message = "邮箱验证码已过期，请重新获取。"
            elif verification.failed_attempts >= EMAIL_CODE_MAX_ATTEMPTS:
                verification.consumed_at = now
                verification.save(update_fields=["consumed_at"])
                error_message = "邮箱验证码尝试次数过多，请重新获取。"
            elif not check_password(verification_code, verification.code_hash):
                verification.failed_attempts += 1
                if verification.failed_attempts >= EMAIL_CODE_MAX_ATTEMPTS:
                    verification.consumed_at = now
                verification.save(update_fields=["failed_attempts", "consumed_at"])
                error_message = "邮箱验证码不正确。"
            else:
                user = create_user(username, email, password)
                verification.consumed_at = now
                verification.save(update_fields=["consumed_at"])
    except IntegrityError as exc:
        raise HttpError(400, "用户名或邮箱已存在。") from exc

    if error_message:
        raise HttpError(400, error_message)
    if user is None:
        raise HttpError(400, "注册失败，请重新尝试。")
    return 201, issue_token_pair(request, user)


@router.post("/register", response={201: TokenOut})
def register(request, payload: RegisterIn):
    username = payload.username.strip()
    email = payload.email.strip().lower()
    password = payload.password

    if not username or not email or not password:
        raise HttpError(400, "Username, email, and password are required.")

    User = get_user_model()
    try:
        User._meta.get_field("username").run_validators(username)
    except ValidationError as exc:
        raise HttpError(400, " ".join(exc.messages)) from exc
    if User.objects.filter(
        Q(username__iexact=username)
        | Q(email__iexact=username)
        | Q(username__iexact=email)
        | Q(email__iexact=email)
    ).exists():
        raise HttpError(400, "Username or email already exists.")

    user = User(username=username, email=email, first_name=username)
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


@router.post("/android/google", response=AndroidGoogleAuthUrlOut)
def android_google_auth_url(request, payload: AndroidGoogleAuthIn):
    code_challenge = payload.codeChallenge.strip()
    if not PKCE_VALUE_PATTERN.fullmatch(code_challenge):
        raise HttpError(400, "Google 登录安全参数无效，请重试。")
    if not settings.GOOGLE_CALENDAR_CLIENT_ID or not settings.GOOGLE_CALENDAR_CLIENT_SECRET:
        raise HttpError(400, "Google 登录尚未配置。")

    state = signing.dumps(
        {
            "flow": ANDROID_GOOGLE_FLOW,
            "code_challenge": code_challenge,
        },
        salt=GOOGLE_AUTH_STATE_SALT,
    )
    return {
        "authorizationUrl": authorization_url(
            state=state,
            redirect_uri=google_auth_redirect_uri(request),
            scope=GOOGLE_ACCOUNT_SCOPE,
        ),
        "redirectUrl": settings.ANDROID_GOOGLE_AUTH_RETURN_URL,
    }


@router.get("/google/callback")
def google_auth_callback(
    request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
):
    return_url = frontend_url(request)
    state_payload: dict = {}
    if state:
        try:
            state_payload = signing.loads(
                state,
                salt=GOOGLE_AUTH_STATE_SALT,
                max_age=GOOGLE_AUTH_STATE_MAX_AGE_SECONDS,
            )
        except signing.SignatureExpired:
            try:
                expired_payload = signing.loads(
                    state,
                    salt=GOOGLE_AUTH_STATE_SALT,
                )
            except signing.BadSignature:
                expired_payload = {}
            if expired_payload.get("flow") == ANDROID_GOOGLE_FLOW:
                return AndroidAuthRedirect(
                    android_google_redirect_url(
                        googleAuth="error",
                        message="Google 登录已超时，请重试。",
                    )
                )
            return HttpResponseRedirect(
                callback_redirect_url(
                    return_url,
                    googleAuth="error",
                    message="Google login request expired or was invalid.",
                )
            )
        except signing.BadSignature:
            return HttpResponseRedirect(
                callback_redirect_url(
                    return_url,
                    googleAuth="error",
                    message="Google login request expired or was invalid.",
                )
            )

    is_android = state_payload.get("flow") == ANDROID_GOOGLE_FLOW
    if not is_android:
        return_url = state_payload.get("return_url") or return_url

    if error:
        message = "你已取消 Google 登录。" if error == "access_denied" else "Google 登录失败。"
        if is_android:
            return AndroidAuthRedirect(
                android_google_redirect_url(googleAuth="error", message=message)
            )
        return HttpResponseRedirect(
            callback_redirect_url(return_url, googleAuth="error", message=error)
        )
    if not code or not state or not state_payload:
        if is_android:
            return AndroidAuthRedirect(
                android_google_redirect_url(
                    googleAuth="error",
                    message="Google 登录回调数据不完整。",
                )
            )
        return HttpResponseRedirect(
            callback_redirect_url(
                return_url,
                googleAuth="error",
                message="Missing Google callback data.",
            )
        )

    try:
        token_body = exchange_code_for_tokens(
            code=code,
            redirect_uri=google_auth_redirect_uri(request),
        )
        access_token = str(token_body.get("access_token") or "")
        userinfo = fetch_google_userinfo(access_token)
    except (GoogleCalendarError, KeyError) as exc:
        if is_android:
            logger.warning("Android Google login callback failed: %s", exc)
            return AndroidAuthRedirect(
                android_google_redirect_url(
                    googleAuth="error",
                    message="Google 登录失败，请重试。",
                )
            )
        return HttpResponseRedirect(
            callback_redirect_url(return_url, googleAuth="error", message=str(exc))
        )

    subject = str(userinfo.get("sub") or "").strip()
    email = str(userinfo.get("email") or "").strip().lower()
    if not email:
        if is_android:
            return AndroidAuthRedirect(
                android_google_redirect_url(
                    googleAuth="error",
                    message="Google 账户未返回邮箱地址。",
                )
            )
        return HttpResponseRedirect(
            callback_redirect_url(
                return_url,
                googleAuth="error",
                message="Google account did not return an email.",
            )
        )
    if is_android and userinfo.get("email_verified") is False:
        return AndroidAuthRedirect(
            android_google_redirect_url(
                googleAuth="error",
                message="Google 邮箱尚未验证。",
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
        user = User(username=username, email=email, first_name=username)
        user.set_unusable_password()
        user.save()
    if not user.is_active:
        if is_android:
            return AndroidAuthRedirect(
                android_google_redirect_url(
                    googleAuth="error",
                    message="该账户已停用。",
                )
            )
        return HttpResponseRedirect(
            callback_redirect_url(
                return_url,
                googleAuth="error",
                message="This account is disabled.",
            )
        )

    if is_android:
        code_challenge = str(state_payload.get("code_challenge") or "")
        if not PKCE_VALUE_PATTERN.fullmatch(code_challenge):
            return AndroidAuthRedirect(
                android_google_redirect_url(
                    googleAuth="error",
                    message="Google 登录安全参数无效，请重试。",
                )
            )
        exchange_code = secrets.token_urlsafe(32)
        GoogleLoginExchangeCode.objects.create(
            user=user,
            code_hash=GoogleLoginExchangeCode.hash_code(exchange_code),
            code_challenge=code_challenge,
            expires_at=timezone.now()
            + timedelta(seconds=ANDROID_GOOGLE_EXCHANGE_TTL_SECONDS),
        )
        return AndroidAuthRedirect(
            android_google_redirect_url(
                googleAuth="success",
                code=exchange_code,
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


@router.post("/android/google/exchange", response=TokenOut)
def android_google_exchange(request, payload: AndroidGoogleExchangeIn):
    code = payload.code.strip()
    code_verifier = payload.codeVerifier.strip()
    if not code or not PKCE_VALUE_PATTERN.fullmatch(code_verifier):
        raise HttpError(400, "Google 登录安全参数无效，请重试。")

    verifier_digest = hashlib.sha256(code_verifier.encode("ascii")).digest()
    calculated_challenge = base64.urlsafe_b64encode(verifier_digest).rstrip(b"=").decode("ascii")
    now = timezone.now()
    exchange = None
    with transaction.atomic():
        exchange = (
            GoogleLoginExchangeCode.objects.select_for_update()
            .select_related("user")
            .filter(
                code_hash=GoogleLoginExchangeCode.hash_code(code),
                consumed_at__isnull=True,
                expires_at__gt=now,
                user__is_active=True,
            )
            .first()
        )
        if exchange is None or not hmac.compare_digest(
            calculated_challenge,
            exchange.code_challenge,
        ):
            raise HttpError(400, "Google 登录已过期或无效，请重试。")
        exchange.consumed_at = now
        exchange.save(update_fields=["consumed_at"])

    return issue_token_pair(request, exchange.user)


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
    return {
        "id": str(user.id),
        "username": user.username,
        "email": user.email,
        "displayName": user.username,
    }


@router.patch("/me", response=UserOut, auth=bearer_auth)
def update_me(request, payload: ProfileUpdateIn):
    account_name = payload.displayName.strip()
    if not account_name:
        raise HttpError(400, "Account name is required.")

    user = request.auth
    User = get_user_model()
    try:
        User._meta.get_field("username").run_validators(account_name)
    except ValidationError as exc:
        raise HttpError(400, " ".join(exc.messages)) from exc

    conflict_exists = (
        User.objects.exclude(id=user.id)
        .filter(Q(username__iexact=account_name) | Q(email__iexact=account_name))
        .exists()
    )
    if conflict_exists:
        raise HttpError(400, "Account name is already in use.")

    user.username = account_name
    user.first_name = account_name
    try:
        user.save(update_fields=["username", "first_name", "updated_at"])
    except IntegrityError as exc:
        raise HttpError(400, "Account name is already in use.") from exc

    return {
        "id": str(user.id),
        "username": user.username,
        "email": user.email,
        "displayName": user.username,
    }
