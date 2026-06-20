from ninja.security import HttpBearer

from .tokens import authenticate_access_token


class AccessTokenAuth(HttpBearer):
    def authenticate(self, request, token):
        return authenticate_access_token(token)


bearer_auth = AccessTokenAuth()

