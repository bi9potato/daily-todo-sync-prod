from django.contrib import admin

from .models import Task, TaskAttachment, TodoOccurrence


@admin.register(Task)
class TaskAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "user",
        "text",
        "content_mode",
        "recurrence_kind",
        "reminder_time",
        "created_at",
        "deleted_at",
    )
    list_filter = ("content_mode", "recurrence_kind", "deleted_at")
    search_fields = ("text", "user__username", "user__email")
    readonly_fields = ("id", "root_id", "created_at", "updated_at")


@admin.register(TodoOccurrence)
class TodoOccurrenceAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "user",
        "task_date",
        "status",
        "source",
        "is_pinned",
        "sort_order",
        "task",
        "created_at",
    )
    list_filter = ("status", "source", "is_pinned", "task_date", "deleted_at")
    search_fields = ("task__text", "user__username", "user__email")
    readonly_fields = ("id", "root_id", "created_at", "updated_at")


@admin.register(TaskAttachment)
class TaskAttachmentAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "user",
        "task",
        "occurrence",
        "original_filename",
        "sort_order",
        "created_at",
    )
    search_fields = ("original_filename", "task__text", "user__username", "user__email")
    readonly_fields = ("id", "created_at")
