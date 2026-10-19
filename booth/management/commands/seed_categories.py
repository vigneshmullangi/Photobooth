from django.core.management.base import BaseCommand

from booth.models import Category

NAMES = ['Birthday', 'Wedding', 'Corporate & Branding', 'Festivals', 'Graduation',
         'Baby & Family', 'Restaurant & Loyalty', 'Photo Strips']


class Command(BaseCommand):
    help = 'Create the default frame categories (safe to run more than once).'

    def handle(self, *args, **opts):
        for i, name in enumerate(NAMES):
            _, made = Category.objects.get_or_create(name=name, defaults={'order': i})
            self.stdout.write(('created ' if made else 'exists  ') + name)
