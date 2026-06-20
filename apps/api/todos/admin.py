from django.contrib import admin

from .models import Task, TodoOccurrence


@admin.register(Task)
class TaskAdmin(admin.ModelAdmin):
    list_display = ("id", "user", "text", "created_at", "deleted_at")
    list_filter = ("deleted_at",)
    search_fields = ("text", "user__username", "user__email")
    readonly_fields = ("id", "root_id", "created_at", "updated_at")


@admin.register(TodoOccurrence)
class TodoOccurrenceAdmin(admin.ModelAdmin):
    list_display = ("id", "user", "task_date", "status", "task", "created_at")
    list_filter = ("status", "task_date", "deleted_at")
    search_fields = ("task__text", "user__username", "user__email")
    readonly_fields = ("id", "root_id", "created_at", "updated_at")

