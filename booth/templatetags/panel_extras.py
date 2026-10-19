from django import template
from django.utils.timesince import timesince

register = template.Library()


@register.filter
def ago(value):
    """'3 hours ago', 'just now' - only the largest unit, for compact lists."""
    if not value:
        return ''
    first = timesince(value).replace('\xa0', ' ').split(',')[0].strip()
    return 'just now' if first.startswith('0 ') else f'{first} ago'
