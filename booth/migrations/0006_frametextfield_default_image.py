from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('booth', '0005_frametextfield'),
    ]

    operations = [
        migrations.AddField(
            model_name='frametextfield',
            name='default_image',
            field=models.ImageField(
                blank=True,
                help_text='Optional image shown by default in Studio; guests can replace it.',
                upload_to='frame_fields/',
            ),
        ),
    ]
