# Manually authored: scope OJT rows to authenticated users for server-side storage.

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("CalculateHours", "0003_userprofile"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="ojtentry",
            name="user",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="ojt_entries",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AlterField(
            model_name="ojtentry",
            name="client_key",
            field=models.CharField(blank=True, db_index=True, default="", max_length=64),
        ),
        migrations.AlterUniqueTogether(
            name="ojtentry",
            unique_together=set(),
        ),
        migrations.AddConstraint(
            model_name="ojtentry",
            constraint=models.UniqueConstraint(
                condition=models.Q(user__isnull=False),
                fields=("user", "client_id"),
                name="ojtentry_user_client_id_uniq",
            ),
        ),
        migrations.AddConstraint(
            model_name="ojtentry",
            constraint=models.UniqueConstraint(
                condition=models.Q(user__isnull=True),
                fields=("client_key", "client_id"),
                name="ojtentry_client_key_client_id_uniq",
            ),
        ),
    ]
