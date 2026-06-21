from django.db import migrations


def repair_auto_occurrence_ordering(apps, schema_editor):
    TodoOccurrence = apps.get_model("todos", "TodoOccurrence")
    auto_sources = ["carryover", "recurring"]
    occurrences = (
        TodoOccurrence.objects.filter(
            source__in=auto_sources,
            deleted_at__isnull=True,
        )
        .order_by("user_id", "root_id", "task_date", "created_at")
        .iterator()
    )

    for occurrence in occurrences:
        template = (
            TodoOccurrence.objects.filter(
                user_id=occurrence.user_id,
                root_id=occurrence.root_id,
                task_date__lt=occurrence.task_date,
                deleted_at__isnull=True,
            )
            .order_by("-task_date", "-updated_at", "-created_at")
            .first()
        )
        if template is None:
            continue
        if (
            occurrence.is_pinned == template.is_pinned
            and occurrence.sort_order == template.sort_order
        ):
            continue
        occurrence.is_pinned = template.is_pinned
        occurrence.sort_order = template.sort_order
        occurrence.save(update_fields=["is_pinned", "sort_order", "updated_at"])


class Migration(migrations.Migration):
    dependencies = [
        ("todos", "0006_long_term_content_and_repair_legacy_attachments"),
    ]

    operations = [
        migrations.RunPython(repair_auto_occurrence_ordering, migrations.RunPython.noop),
    ]
