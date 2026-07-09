import json

from django.conf import settings
from django.contrib import admin
from django.http import FileResponse, JsonResponse
from django.urls import path
from ninja import NinjaAPI

from accounts.api import router as auth_router
from daily_todo.ai_api import router as ai_router
from device_timeline.api import router as device_timeline_router
from diagnostics.api import router as diagnostics_router
from integrations.api import router as integrations_router
from mobility.api import router as mobility_router
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


@api.get("/mobile/releases/latest/apk")
def latest_mobile_release_apk(request):
    """Serve the latest Android APK from this server.

    Distribution used to link straight to the GitHub release asset, but
    62MB downloads from GitHub are unreliable on mainland-China networks -
    truncated files failing with Android's generic "app not installed".
    This server is already proven reachable from the user's network, so the
    update manifest's apkUrl points here instead. The file sits next to the
    manifest on the persistent media volume.
    """
    apk_path = settings.MOBILE_RELEASE_MANIFEST_PATH.parent / "daily-todo-arm64-v8a.apk"
    if not apk_path.is_file():
        return JsonResponse(
            {"detail": "Android APK is not available yet."},
            status=503,
        )
    response = FileResponse(
        apk_path.open("rb"),
        as_attachment=True,
        filename="daily-todo-arm64-v8a.apk",
        content_type="application/vnd.android.package-archive",
    )
    response["Cache-Control"] = "no-store"
    return response


api.add_router("/auth", auth_router)
api.add_router("/ai", ai_router)
api.add_router("/device-timeline", device_timeline_router)
api.add_router("/diagnostics", diagnostics_router)
api.add_router("/integrations", integrations_router)
api.add_router("/mobility", mobility_router)
api.add_router("", todos_router)

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", api.urls),
]
