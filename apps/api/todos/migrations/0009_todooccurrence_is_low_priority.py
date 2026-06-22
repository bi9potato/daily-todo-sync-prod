from django.db import migrations, models


def disable_postgres_statement_timeout(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("SET statement_timeout = 0")


class Migration(migrations.Migration):
    dependencies = [
        ("todos", "0008_repair_occurrence_attachment_task"),
    ]

    operations = [
        migrations.RunPython(
            disable_postgres_statement_timeout,
            reverse_code=migrations.RunPython.noop,
        ),
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
