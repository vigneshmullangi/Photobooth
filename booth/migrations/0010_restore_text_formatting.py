import django.core.validators
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('booth', '0009_remove_frametextfield_bold_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='frametextfield',
            name='bold',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='frametextfield',
            name='effect',
            field=models.CharField(
                choices=[('none', 'None'), ('shadow', 'Soft shadow'), ('outline', 'Outline')],
                default='none',
                max_length=8,
            ),
        ),
        migrations.AddField(
            model_name='frametextfield',
            name='font_size',
            field=models.FloatField(
                default=1,
                help_text='Relative to the frame text box (1 = default).',
                validators=[
                    django.core.validators.MinValueValidator(0.25),
                    django.core.validators.MaxValueValidator(5),
                ],
            ),
        ),
        migrations.AddField(
            model_name='frametextfield',
            name='italic',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='frametextfield',
            name='underline',
            field=models.BooleanField(default=False),
        ),
        migrations.AlterField(
            model_name='frametextfield',
            name='font',
            field=models.CharField(
                choices=[
                    ('script', 'Script'), ('serif', 'Elegant serif'), ('bold', 'Bold sans'),
                    ('modern', 'Modern sans'), ('display', 'Display (heavy)'), ('mono', 'Monospace'),
                    ('rounded', 'Rounded'), ('arial', 'Arial'), ('verdana', 'Verdana'),
                    ('trebuchet', 'Trebuchet MS'), ('georgia', 'Georgia'),
                    ('times', 'Times New Roman'), ('courier', 'Courier New'), ('impact', 'Impact'),
                    ('inter', 'Inter'), ('fraunces', 'Fraunces'), ('playfair', 'Playfair Display'),
                    ('montserrat', 'Montserrat'), ('bebas', 'Bebas Neue'),
                ],
                default='script',
                max_length=20,
            ),
        ),
    ]
