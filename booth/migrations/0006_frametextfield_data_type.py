from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [('booth', '0005_frametextfield')]

    operations = [
        migrations.AddField(
            model_name='frametextfield',
            name='data_type',
            field=models.CharField(
                choices=[('text', 'Text'), ('date', 'Date'), ('upload', 'Image upload')],
                default='text', max_length=10),
        ),
    ]
