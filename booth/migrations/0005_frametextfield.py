import django.core.validators
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('booth', '0004_frametemplate_optional_category'),
    ]

    operations = [
        migrations.CreateModel(
            name='FrameTextField',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('order', models.PositiveIntegerField(default=0)),
                ('label', models.CharField(help_text='Shown to the visitor, e.g. "Names" or "Year".', max_length=60)),
                ('default_text', models.CharField(blank=True, help_text='Pre-filled text, e.g. "Jon weds Mary" or "2026".', max_length=80)),
                ('max_length', models.PositiveIntegerField(default=30)),
                ('x', models.FloatField(default=10, validators=[django.core.validators.MinValueValidator(0), django.core.validators.MaxValueValidator(100)], verbose_name='left %')),
                ('y', models.FloatField(default=5, validators=[django.core.validators.MinValueValidator(0), django.core.validators.MaxValueValidator(100)], verbose_name='top %')),
                ('w', models.FloatField(default=80, validators=[django.core.validators.MinValueValidator(0), django.core.validators.MaxValueValidator(100)], verbose_name='width %')),
                ('h', models.FloatField(default=8, validators=[django.core.validators.MinValueValidator(0), django.core.validators.MaxValueValidator(100)], verbose_name='height %')),
                ('font', models.CharField(choices=[('script', 'Script (names)'), ('serif', 'Elegant serif'), ('bold', 'Bold sans'), ('modern', 'Modern sans'), ('display', 'Display (heavy)')], default='script', max_length=12)),
                ('color', models.CharField(default='#b8893b', help_text='Hex colour, e.g. #b8893b', max_length=7)),
                ('align', models.CharField(choices=[('center', 'Center'), ('left', 'Left'), ('right', 'Right')], default='center', max_length=6)),
                ('uppercase', models.BooleanField(default=False)),
                ('template', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='text_fields', to='booth.frametemplate')),
            ],
            options={
                'verbose_name': 'editable text',
                'ordering': ['order', 'id'],
            },
        ),
    ]
