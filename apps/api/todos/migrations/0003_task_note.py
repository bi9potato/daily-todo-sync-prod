from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("todos", "0002_reminders_recurrence_and_order"),
    ]

    operations = [
        migrations.AddField(
            model_name="task",
            name="note",
            field=models.TextField(blank=True, default=""),
        ),
    ]
