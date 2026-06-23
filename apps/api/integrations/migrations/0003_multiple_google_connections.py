from django.db import migrations, models
import django.db.models.deletion


def mark_existing_connections_primary(apps, schema_editor):
    GoogleCalendarConnection = apps.get_model("integrations", "GoogleCalendarConnection")
    GoogleCalendarEventLink = apps.get_model("integrations", "GoogleCalendarEventLink")
    for connection in GoogleCalendarConnection.objects.all():
        connection.is_primary = True
        connection.save(update_fields=["is_primary"])
        GoogleCalendarEventLink.objects.filter(user=connection.user).update(
            connection=connection
        )


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0001_initial"),
        ("integrations", "0002_google_account_binding"),
    ]

    operations = [
        migrations.AlterField(
            model_name="googlecalendarconnection",
            name="user",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name="google_calendar_connections",
                to="accounts.user",
            ),
        ),
        migrations.AddField(
            model_name="googlecalendarconnection",
            name="is_primary",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="googlecalendareventlink",
            name="connection",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="event_links",
                to="integrations.googlecalendarconnection",
            ),
        ),
        migrations.RunPython(mark_existing_connections_primary, migrations.RunPython.noop),
        migrations.RemoveConstraint(
            model_name="googlecalendareventlink",
            name="uniq_google_calendar_link_per_root",
        ),
        migrations.AddConstraint(
            model_name="googlecalendarconnection",
            constraint=models.UniqueConstraint(
                fields=("user", "google_subject"),
                name="uniq_google_connection_subject_per_user",
            ),
        ),
        migrations.AddConstraint(
            model_name="googlecalendareventlink",
            constraint=models.UniqueConstraint(
                fields=("connection", "root_id"),
                name="uniq_google_calendar_link_per_connection_root",
            ),
        ),
        migrations.AddIndex(
            model_name="googlecalendarconnection",
            index=models.Index(fields=["user", "is_primary"], name="integration_user_id_ba1142_idx"),
        ),
    ]
