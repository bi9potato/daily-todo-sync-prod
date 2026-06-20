from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("todos", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="task",
            name="recurrence_days_of_week",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name="task",
            name="recurrence_interval",
            field=models.PositiveIntegerField(default=1),
        ),
        migrations.AddField(
            model_name="task",
            name="recurrence_kind",
            field=models.CharField(
                choices=[
                    ("none", "None"),
                    ("daily", "Daily"),
                    ("weekdays", "Weekdays"),
                    ("weekly", "Weekly"),
                    ("monthly", "Monthly"),
                    ("yearly", "Yearly"),
                ],
                default="none",
                max_length=16,
            ),
        ),
        migrations.AddField(
            model_name="task",
            name="recurrence_start_date",
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="task",
            name="recurrence_until",
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="task",
            name="reminder_time",
            field=models.TimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="todooccurrence",
            name="sort_order",
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="todooccurrence",
            name="source",
            field=models.CharField(
                choices=[
                    ("manual", "Manual"),
                    ("carryover", "Carryover"),
                    ("recurring", "Recurring"),
                ],
                default="manual",
                max_length=16,
            ),
        ),
        migrations.AddIndex(
            model_name="task",
            index=models.Index(
                fields=["user", "recurrence_kind", "recurrence_start_date"],
                name="todos_task_user_id_29e252_idx",
            ),
        ),
        migrations.RemoveIndex(
            model_name="todooccurrence",
            name="todos_occur_user_id_02c368_idx",
        ),
        migrations.AddIndex(
            model_name="todooccurrence",
            index=models.Index(
                fields=["user", "task_date", "status", "sort_order"],
                name="todos_occur_user_id_9159c1_idx",
            ),
        ),
    ]
