from django.db import migrations, models


def repair_legacy_attachment_occurrences(apps, schema_editor):
    TaskAttachment = apps.get_model("todos", "TaskAttachment")
    TodoOccurrence = apps.get_model("todos", "TodoOccurrence")

    attachments = TaskAttachment.objects.select_related("task", "occurrence").filter(
        occurrence__isnull=False,
    )
    for attachment in attachments.iterator():
        file_name = attachment.file.name or ""
        task_id = str(attachment.task_id)
        occurrence_id = str(attachment.occurrence_id)

        if f"/{task_id}/" not in file_name or f"/{occurrence_id}/" in file_name:
            continue

        first_occurrence = (
            TodoOccurrence.objects.filter(
                user_id=attachment.user_id,
                root_id=attachment.task.root_id,
                deleted_at__isnull=True,
            )
            .order_by("task_date", "created_at")
            .first()
        )
        if first_occurrence is None or first_occurrence.id == attachment.occurrence_id:
            continue

        next_sort_order = (
            TaskAttachment.objects.filter(
                user_id=attachment.user_id,
                occurrence_id=first_occurrence.id,
            ).count()
            + 1
        ) * 1000
        attachment.occurrence_id = first_occurrence.id
        attachment.sort_order = next_sort_order
        attachment.save(update_fields=["occurrence", "sort_order"])


class Migration(migrations.Migration):
    dependencies = [
        ("todos", "0005_occurrence_note_pin_and_attachment_order"),
    ]

    operations = [
        migrations.AddField(
            model_name="task",
            name="content_mode",
            field=models.CharField(
                choices=[
                    ("occurrence", "Occurrence"),
                    ("future", "Future"),
                ],
                default="occurrence",
                max_length=16,
            ),
        ),
        migrations.RunPython(
            repair_legacy_attachment_occurrences,
            migrations.RunPython.noop,
        ),
    ]
