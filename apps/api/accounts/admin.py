from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import RefreshToken, User


@admin.register(User)
class CustomUserAdmin(UserAdmin):
    fieldsets = UserAdmin.fieldsets + (
        ("Sync metadata", {"fields": ("created_at", "updated_at")}),
    )
    readonly_fields = ("created_at", "updated_at")


@admin.register(RefreshToken)
class RefreshTokenAdmin(admin.ModelAdmin):
    list_display = ("id", "user", "created_at", "expires_at", "revoked_at")
    list_filter = ("revoked_at", "expires_at")
    search_fields = ("user__username", "user__email")
    readonly_fields = ("token_hash", "created_at")

