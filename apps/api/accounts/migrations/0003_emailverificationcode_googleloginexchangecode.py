import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0002_sync_account_name"),
    ]

    operations = [
        migrations.CreateModel(
            name="EmailVerificationCode",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ("email", models.EmailField(max_length=254)),
                ("code_hash", models.CharField(max_length=128)),
                ("request_ip", models.GenericIPAddressField(blank=True, null=True)),
                ("failed_attempts", models.PositiveSmallIntegerField(default=0)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("expires_at", models.DateTimeField()),
                ("consumed_at", models.DateTimeField(blank=True, null=True)),
            ],
        ),
        migrations.CreateModel(
            name="GoogleLoginExchangeCode",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ("code_hash", models.CharField(max_length=64, unique=True)),
                ("code_challenge", models.CharField(max_length=128)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("expires_at", models.DateTimeField()),
                ("consumed_at", models.DateTimeField(blank=True, null=True)),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
        ),
        migrations.AddIndex(
            model_name="emailverificationcode",
            index=models.Index(
                fields=["email", "created_at"],
                name="accounts_em_email_5e7f7e_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="emailverificationcode",
            index=models.Index(
                fields=["expires_at"],
                name="accounts_em_expires_64f0a2_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="googleloginexchangecode",
            index=models.Index(
                fields=["expires_at"],
                name="accounts_go_expires_560f35_idx",
            ),
        ),
    ]
