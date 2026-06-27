import json

from django.conf import settings
from django.contrib import admin
from django.http import JsonResponse
from django.urls import path
from ninja import NinjaAPI

from accounts.api import router as auth_router
from daily_todo.ai_api import router as ai_router
from integrations.api import router as integrations_router
from todos.api import router as todos_router

api = NinjaAPI(title="Daily Todo Sync API", version="0.1.0")


@api.get("/health")
def health(request):
    return {"status": "ok"}


@api.get("/mobile/releases/latest")
def latest_mobile_release(request):
    try:
        payload = json.loads(settings.MOBILE_RELEASE_MANIFEST_PATH.read_text())
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return JsonResponse(
            {"detail": "Android release manifest is not available yet."},
            status=503,
        )

    response = JsonResponse(payload)
    response["Cache-Control"] = "no-store"
    return response


api.add_router("/auth", auth_router)
api.add_router("/ai", ai_router)
api.add_router("/integrations", integrations_router)
api.add_router("", todos_router)

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", api.urls),
]
