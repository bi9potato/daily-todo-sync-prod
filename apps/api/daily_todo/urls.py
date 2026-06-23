from django.contrib import admin
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


api.add_router("/auth", auth_router)
api.add_router("/ai", ai_router)
api.add_router("/integrations", integrations_router)
api.add_router("", todos_router)

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", api.urls),
]
