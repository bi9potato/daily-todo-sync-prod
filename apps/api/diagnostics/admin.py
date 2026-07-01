from django.contrib import admin

from .models import ClientLogEntry


@admin.register(ClientLogEntry)
class ClientLogEntryAdmin(admin.ModelAdmin):
    list_display = (
        "occurred_at",
        "level",
        "user",
        "source",
        "platform",
        "app_version",
        "message_preview",
    )
    list_filter = ("level", "platform", "app_version", "source", "created_at")
    search_fields = ("message", "stack", "session_id", "device_id", "user__username")
    readonly_fields = (
        "id",
        "user",
        "client_id",
        "session_id",
        "device_id",
        "level",
        "source",
        "message",
        "stack",
        "context",
        "occurred_at",
        "app_version",
        "build_sha",
        "platform",
        "os_version",
        "created_at",
    )

    def has_add_permission(self, request):
        return False

    @admin.display(description="message")
    def message_preview(self, entry):
        return entry.message[:120]
