from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("todos", "0008_repair_occurrence_attachment_task"),
    ]

    operations = [
        migrations.AddField(
            model_name="todooccurrence",
            name="is_low_priority",
            field=models.BooleanField(default=False),
        ),
        migrations.AddIndex(
            model_name="todooccurrence",
            index=models.Index(
                fields=["user", "task_date", "is_low_priority", "sort_order"],
                name="todos_occur_user_id_8d18f5_idx",
            ),
        ),
    ]
