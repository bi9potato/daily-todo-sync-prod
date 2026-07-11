from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("mobility", "0001_initial")]

    operations = [
        migrations.AddField(
            model_name="locationpoint",
            name="activity_type",
            field=models.CharField(blank=True, default="", max_length=24),
        ),
    ]
