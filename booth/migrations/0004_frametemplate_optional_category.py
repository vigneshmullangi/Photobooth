from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('booth', '0003_inquiry'),
    ]

    operations = [
        migrations.AlterField(
            model_name='frametemplate',
            name='category',
            field=models.ForeignKey(
                blank=True,
                help_text='Leave empty for a campaign-only frame that is not listed on the public website.',
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name='templates',
                to='booth.category',
            ),
        ),
    ]
