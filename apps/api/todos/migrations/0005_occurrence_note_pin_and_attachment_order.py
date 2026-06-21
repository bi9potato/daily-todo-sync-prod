from django.db import migrations, models
import django.db.models.deletion


def copy_task_notes_and_attach_legacy_images(apps, schema_editor):
    TodoOccurrence = apps.get_model("todos", "TodoOccurrence")
    TaskAttachment = apps.get_model("todos", "TaskAttachment")

    occurrences = TodoOccurrence.objects.select_related("task").filter(note="")
    for occurrence in occurrences.iterator():
        task_note = getattr(occurrence.task, "note", "") or ""
        if task_note:
            occurrence.note = task_note
            occurrence.save(update_fields=["note"])

    legacy_attachments = TaskAttachment.objects.filter(occurrence__isnull=True)
    for attachment in legacy_attachments.iterator():
        occurrence = (
            TodoOccurrence.objects.filter(
                user_id=attachment.user_id,
                task_id=attachment.task_id,
                deleted_at__isnull=True,
            )
            .order_by("-task_date", "-updated_at", "-created_at")
            .first()
        )
        if occurrence is None:
            continue
        next_sort_order = (
            TaskAttachment.objects.filter(
                user_id=attachment.user_id,
                occurrence_id=occurrence.id,
            ).count()
            + 1
        ) * 1000
        attachment.occurrence_id = occurrence.id
        attachment.sort_order = next_sort_order
        attachment.save(update_fields=["occurrence", "sort_order"])


class Migration(migrations.Migration):
    dependencies = [
        ("todos", "0004_taskattachment"),
    ]

    operations = [
        migrations.AddField(
            model_name="todooccurrence",
            name="note",
            field=models.TextField(blank=True, default=""),
        ),
        migrations.AddField(
            model_name="todooccurrence",
            name="is_pinned",
            field=models.BooleanField(default=False),
        ),
        migrations.RemoveIndex(
            model_name="taskattachment",
            name="todos_taska_user_id_21e3c9_idx",
        ),
        migrations.AddField(
            model_name="taskattachment",
            name="occurrence",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="attachments",
                to="todos.todooccurrence",
            ),
        ),
        migrations.AddField(
            model_name="taskattachment",
            name="sort_order",
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.RunPython(copy_task_notes_and_attach_legacy_images, migrations.RunPython.noop),
        migrations.AddIndex(
            model_name="taskattachment",
            index=models.Index(
                fields=["user", "occurrence", "sort_order"],
                name="todos_taska_user_id_21e3c9_idx",
            ),
        ),
    ]
