from django.db import migrations, models


def sync_account_names(apps, schema_editor):
    User = apps.get_model("accounts", "User")
    User.objects.using(schema_editor.connection.alias).update(
        first_name=models.F("username"),
    )


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(sync_account_names, migrations.RunPython.noop),
    ]
