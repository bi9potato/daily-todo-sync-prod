from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("todos", "0011_todosynccursor"),
    ]

    operations = [
        migrations.AddField(
            model_name="task",
            name="is_archived",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="task",
            name="archived_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddIndex(
            model_name="task",
            index=models.Index(
                fields=["user", "is_archived"],
                name="todos_task_user_archived_idx",
            ),
        ),
    ]
