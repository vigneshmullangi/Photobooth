# Generated for guest account organization details.
import django.conf
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('booth', '0013_site_metrics'),
        migrations.swappable_dependency(django.conf.settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='GuestAccountProfile',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('organization_name', models.CharField(blank=True, default='', max_length=160)),
                ('user', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='booth_profile', to=django.conf.settings.AUTH_USER_MODEL)),
            ],
        ),
    ]
