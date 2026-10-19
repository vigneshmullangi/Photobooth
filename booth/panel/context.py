from django.conf import settings
from django.urls import reverse
from django.utils.text import Truncator

from ..models import Inquiry


def notification_payload():
    unread = Inquiry.objects.filter(is_read=False)
    items = [{
        'id': i.pk,
        'name': i.name,
        'interest': i.interest or 'General question',
        'snippet': Truncator(i.message).chars(90),
        'created': i.created.isoformat(),
        'url': reverse('panel:inquiry_detail', args=[i.pk]),
    } for i in unread[:6]]
    return {
        'unread': unread.count(),
        'newest_id': Inquiry.objects.values_list('pk', flat=True).first() or 0,
        'items': items,
    }


def notifications(request):
    """Adds the bell/unread data to every panel page."""
    user = getattr(request, 'user', None)
    if not request.path.startswith('/panel/') or not (user and user.is_authenticated and user.is_staff):
        return {}
    payload = notification_payload()
    host = settings.CAMPAIGN_BASE_DOMAIN
    if settings.CAMPAIGN_BASE_PORT:
        host = f'{host}:{settings.CAMPAIGN_BASE_PORT}'
    return {'notify': payload, 'notify_items': payload['items'], 'campaign_host': host}
