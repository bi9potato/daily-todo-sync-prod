import django.db.models.deletion
import uuid
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="Task",
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
                ("root_id", models.UUIDField(db_index=True, editable=False)),
                ("text", models.CharField(max_length=280)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("deleted_at", models.DateTimeField(blank=True, null=True)),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
        ),
        migrations.CreateModel(
            name="TodoOccurrence",
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
                ("task_date", models.DateField()),
                (
                    "status",
                    models.CharField(
                        choices=[("pending", "Pending"), ("done", "Done")],
                        default="pending",
                        max_length=16,
                    ),
                ),
                ("completed_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("deleted_at", models.DateTimeField(blank=True, null=True)),
                ("version", models.PositiveIntegerField(default=1)),
                ("client_mutation_id", models.CharField(blank=True, max_length=80, null=True)),
                (
                    "carryover_from_occurrence",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="carried_to_occurrences",
                        to="todos.todooccurrence",
                    ),
                ),
                (
                    "task",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="occurrences",
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
            model_name="task",
            index=models.Index(fields=["user", "deleted_at"], name="todos_task_user_id_6b794b_idx"),
        ),
        migrations.AddIndex(
            model_name="task",
            index=models.Index(fields=["user", "root_id"], name="todos_task_user_id_650d4e_idx"),
        ),
        migrations.AddConstraint(
            model_name="todooccurrence",
            constraint=models.UniqueConstraint(
                condition=models.Q(deleted_at__isnull=True),
                fields=("user", "root_id", "task_date"),
                name="uniq_active_occurrence_per_root_day",
            ),
        ),
        migrations.AddIndex(
            model_name="todooccurrence",
            index=models.Index(
                fields=["user", "task_date", "status"],
                name="todos_occur_user_id_02c368_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="todooccurrence",
            index=models.Index(
                fields=["user", "root_id", "task_date"],
                name="todos_occur_user_id_bfc0fa_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="todooccurrence",
            index=models.Index(fields=["deleted_at"], name="todos_occur_deleted_b8767d_idx"),
        ),
    ]
