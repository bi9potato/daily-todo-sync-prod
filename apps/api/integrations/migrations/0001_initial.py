# Generated manually for the Google Calendar single-way sync integration.

import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        ("todos", "0003_task_note"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="GoogleCalendarConnection",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ("calendar_id", models.CharField(default="primary", max_length=255)),
                ("access_token", models.TextField()),
                ("refresh_token", models.TextField(blank=True, default="")),
                ("token_expires_at", models.DateTimeField(blank=True, null=True)),
                ("scope", models.TextField(blank=True, default="")),
                ("sync_enabled", models.BooleanField(default=True)),
                ("last_sync_at", models.DateTimeField(blank=True, null=True)),
                ("last_error", models.TextField(blank=True, default="")),
                ("connected_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "user",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
        ),
        migrations.CreateModel(
            name="GoogleCalendarEventLink",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ("root_id", models.UUIDField(db_index=True)),
                ("calendar_id", models.CharField(default="primary", max_length=255)),
                ("google_event_id", models.CharField(blank=True, default="", max_length=255)),
                ("google_event_html_link", models.URLField(blank=True, default="")),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("synced", "Synced"),
                            ("error", "Error"),
                            ("deleted", "Deleted"),
                        ],
                        default="synced",
                        max_length=16,
                    ),
                ),
                ("last_error", models.TextField(blank=True, default="")),
                ("last_synced_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "last_synced_occurrence",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="google_calendar_sync_links",
                        to="todos.todooccurrence",
                    ),
                ),
                (
                    "task",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="google_calendar_links",
                        to="todos.task",
                    ),
                ),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
        ),
        migrations.AddIndex(
            model_name="googlecalendarconnection",
            index=models.Index(
                fields=["user", "sync_enabled"],
                name="integration_user_id_2a1e47_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="googlecalendareventlink",
            index=models.Index(fields=["user", "status"], name="integration_user_id_60e6d2_idx"),
        ),
        migrations.AddIndex(
            model_name="googlecalendareventlink",
            index=models.Index(fields=["google_event_id"], name="integration_google__97e65f_idx"),
        ),
        migrations.AddConstraint(
            model_name="googlecalendareventlink",
            constraint=models.UniqueConstraint(
                fields=("user", "root_id"),
                name="uniq_google_calendar_link_per_root",
            ),
        ),
    ]
