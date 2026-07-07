from django.db import migrations


def backfill_carryover_notes(apps, schema_editor):
    """Heal notes lost by the old carryover sweep.

    Until now the daily carryover created the next day's occurrence without
    copying `note`, so regular/low-priority tasks silently lost their note
    each midnight (long-term tasks keep theirs on Task and were unaffected).
    Walk carryover chains forward, filling empty notes from the occurrence
    each copy was carried from. Multiple passes resolve multi-day chains
    (day1 -> day2 -> day3) oldest-first.
    """
    TodoOccurrence = apps.get_model("todos", "TodoOccurrence")

    for _ in range(60):  # bounded: chains longer than 60 days are implausible
        stale = (
            TodoOccurrence.objects.filter(
                note="",
                carryover_from_occurrence__isnull=False,
            )
            .exclude(carryover_from_occurrence__note="")
            .select_related("carryover_from_occurrence")
            .order_by("task_date")
        )
        updated = 0
        for occurrence in stale.iterator():
            occurrence.note = occurrence.carryover_from_occurrence.note
            occurrence.save(update_fields=["note", "updated_at"])
            updated += 1
        if updated == 0:
            break


class Migration(migrations.Migration):
    dependencies = [
        ("todos", "0013_todooccurrence_location_radius_meters_and_more"),
    ]

    operations = [
        migrations.RunPython(backfill_carryover_notes, migrations.RunPython.noop),
    ]
