from ninja.security import HttpBearer

from .tokens import authenticate_access_token, authenticate_mobility_token


class AccessTokenAuth(HttpBearer):
    def authenticate(self, request, token):
        return authenticate_access_token(token)


class MobilityUploadAuth(HttpBearer):
    """For endpoints the Android tracking service calls directly: accepts
    the long-lived mobility device token, and falls back to a regular
    access token so the JS app (which refreshes normally) can hit the same
    endpoints when it flushes its own queues."""

    def authenticate(self, request, token):
        return authenticate_mobility_token(token) or authenticate_access_token(
            token
        )


bearer_auth = AccessTokenAuth()
mobility_upload_auth = MobilityUploadAuth()

