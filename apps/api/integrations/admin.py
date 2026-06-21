from django.contrib import admin

from .models import GoogleCalendarConnection, GoogleCalendarEventLink


@admin.register(GoogleCalendarConnection)
class GoogleCalendarConnectionAdmin(admin.ModelAdmin):
    list_display = ("user", "calendar_id", "sync_enabled", "connected_at", "last_sync_at")
    list_filter = ("sync_enabled", "calendar_id")
    search_fields = ("user__username", "user__email", "calendar_id")
    readonly_fields = ("id", "connected_at", "updated_at")


@admin.register(GoogleCalendarEventLink)
class GoogleCalendarEventLinkAdmin(admin.ModelAdmin):
    list_display = ("user", "task", "calendar_id", "status", "last_synced_at")
    list_filter = ("status", "calendar_id")
    search_fields = ("task__text", "user__username", "user__email", "google_event_id")
    readonly_fields = ("id", "created_at", "updated_at")
