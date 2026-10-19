from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('booth', '0002_businesscampaign'),
    ]

    operations = [
        migrations.CreateModel(
            name='Inquiry',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=120)),
                ('email', models.EmailField(max_length=254)),
                ('phone', models.CharField(blank=True, max_length=30)),
                ('interest', models.CharField(blank=True, max_length=80)),
                ('event_date', models.DateField(blank=True, null=True)),
                ('message', models.TextField()),
                ('status', models.CharField(choices=[('new', 'New'), ('contacted', 'Contacted'), ('closed', 'Closed')], default='new', max_length=12)),
                ('is_read', models.BooleanField(default=False)),
                ('created', models.DateTimeField(auto_now_add=True)),
            ],
            options={
                'verbose_name_plural': 'inquiries',
                'ordering': ['-created'],
            },
        ),
    ]
