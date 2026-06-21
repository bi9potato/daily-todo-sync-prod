from django.db import migrations, models


def repair_occurrence_attachment_task(apps, schema_editor):
    TaskAttachment = apps.get_model("todos", "TaskAttachment")
    attachments = (
        TaskAttachment.objects.select_related("occurrence")
        .filter(occurrence__isnull=False)
        .exclude(task_id=models.F("occurrence__task_id"))
        .iterator()
    )
    for attachment in attachments:
        attachment.task_id = attachment.occurrence.task_id
        attachment.save(update_fields=["task"])


class Migration(migrations.Migration):
    dependencies = [
        ("todos", "0007_repair_auto_occurrence_ordering"),
    ]

    operations = [
        migrations.RunPython(repair_occurrence_attachment_task, migrations.RunPython.noop),
    ]
