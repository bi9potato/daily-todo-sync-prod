from django.db import migrations, models


def mark_existing_calendar_authorizations(apps, schema_editor):
    connection_model = apps.get_model("integrations", "GoogleCalendarConnection")
    for connection in connection_model.objects.all():
        if "https://www.googleapis.com/auth/calendar.events" in (connection.scope or ""):
            connection.calendar_authorized = True
            connection.save(update_fields=["calendar_authorized"])


class Migration(migrations.Migration):
    dependencies = [
        ("integrations", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="googlecalendarconnection",
            name="calendar_authorized",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="googlecalendarconnection",
            name="google_email",
            field=models.EmailField(blank=True, default="", max_length=254),
        ),
        migrations.AddField(
            model_name="googlecalendarconnection",
            name="google_name",
            field=models.CharField(blank=True, default="", max_length=255),
        ),
        migrations.AddField(
            model_name="googlecalendarconnection",
            name="google_subject",
            field=models.CharField(blank=True, default="", max_length=255),
        ),
        migrations.AlterField(
            model_name="googlecalendarconnection",
            name="sync_enabled",
            field=models.BooleanField(default=False),
        ),
        migrations.AddIndex(
            model_name="googlecalendarconnection",
            index=models.Index(fields=["google_email"], name="integration_google__6adf2f_idx"),
        ),
        migrations.RunPython(
            mark_existing_calendar_authorizations,
            migrations.RunPython.noop,
        ),
    ]
