from urllib.parse import urlsplit

from django.conf import settings
from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db.models import Prefetch
from django.http import Http404, JsonResponse
from django.shortcuts import render
from django.views.decorators.http import require_GET, require_POST
from PIL import Image

from datetime import date

from .models import BusinessCampaign, Category, Creation, FrameSlot, FrameTemplate, Inquiry
from .detect import detect_windows


def campaign_for_request(request):
    host = urlsplit(f'//{request.get_host()}').hostname or ''
    host = host.rstrip('.').lower()
    base_domain = settings.CAMPAIGN_BASE_DOMAIN
    if not base_domain or host == base_domain:
        return None
    suffix = f'.{base_domain}'
    if not host.endswith(suffix):
        return None
    slug = host[:-len(suffix)]
    if not slug or '.' in slug:
        raise Http404('Campaign not found.')
    try:
        campaign = BusinessCampaign.objects.select_related('frame_template').get(slug=slug, is_active=True)
    except BusinessCampaign.DoesNotExist as exc:
        raise Http404('Campaign not found.') from exc
    if not campaign.frame_template.is_active or not campaign.frame_template.slots.exists():
        raise Http404('Campaign is not available.')
    return campaign


def template_payload(template):
    slots = list(template.slots.all())
    # Upgrade older opaque uploads that were previously assigned the generic
    # one-window fallback. Re-detect once and persist only when multiple real
    # framed photo windows are found.
    if (len(slots) == 1 and abs(slots[0].x - 10) < .01 and abs(slots[0].y - 10) < .01
            and abs(slots[0].w - 80) < .01 and abs(slots[0].h - 60) < .01 and template.image):
        with template.image.storage.open(template.image.name, 'rb') as image_file:
            found = detect_windows(image_file)
        if len(found) > 1:
            template.slots.all().delete()
            FrameSlot.objects.bulk_create(
                [FrameSlot(template=template, order=i, **slot) for i, slot in enumerate(found)])
            slots = list(template.slots.all())
    if not slots or not template.width:
        return None
    return {
        'id': template.pk, 'name': template.name, 'image': template.image.url, 'w': template.width, 'h': template.height,
        'filter': template.default_filter,
        'slots': [{'x': s.x / 100, 'y': s.y / 100, 'w': s.w / 100, 'h': s.h / 100, 'shape': s.shape} for s in slots],
        'texts': [{'id': t.pk, 'label': t.label, 'type': t.data_type, 'text': t.default_text,
                   'image': t.default_image.url if t.default_image else '', 'max': t.max_length,
                   'x': t.x / 100, 'y': t.y / 100, 'w': t.w / 100, 'h': t.h / 100,
                   'font': t.font, 'fontSize': t.font_size, 'bold': t.bold, 'italic': t.italic,
                   'underline': t.underline, 'effect': t.effect, 'color': t.color,
                   'align': t.align, 'upper': t.uppercase}
                  for t in template.text_fields.all()],
    }


def index(request):
    campaign = campaign_for_request(request)
    config = None
    if campaign:
        config = {
            'brandName': campaign.brand_name,
            'logoUrl': campaign.logo.url,
            'template': template_payload(campaign.frame_template),
        }
    backgrounds_dir = settings.MEDIA_ROOT / 'backgrounds'
    background_files = []
    if backgrounds_dir.is_dir():
        for image in sorted(backgrounds_dir.iterdir(), key=lambda item: item.name.casefold()):
            if image.is_file() and image.suffix.lower() in {'.png', '.jpg', '.jpeg', '.webp', '.gif', '.jfif'}:
                label = image.stem.replace('_', ' ').replace('-', ' ').title()
                background_files.append({'name': label, 'url': f'{settings.MEDIA_URL}backgrounds/{image.name}'})
    return render(request, 'booth/index.html', {'campaign': config, 'studio_backgrounds': background_files})


@require_GET
def api_templates(request):
    campaign = campaign_for_request(request)
    if campaign:
        template = template_payload(campaign.frame_template)
        return JsonResponse({'categories': [], 'campaign': template})
    frames = FrameTemplate.objects.filter(is_active=True).prefetch_related('slots', 'text_fields')
    cats = Category.objects.filter(is_active=True).prefetch_related(Prefetch('templates', queryset=frames))
    out = []
    for c in cats:
        items = []
        for t in c.templates.all():
            payload = template_payload(t)
            if payload:
                items.append(payload)
        if items:
            out.append({'name': c.name, 'slug': c.slug, 'templates': items})
    return JsonResponse({'categories': out})


@require_POST
def api_creation(request):
    f = request.FILES.get('image')
    if not f or f.size > 15 * 1024 * 1024:
        return JsonResponse({'ok': False, 'error': 'missing or too large'}, status=400)
    try:
        Image.open(f).verify()
        f.seek(0)
    except Exception:
        return JsonResponse({'ok': False, 'error': 'not an image'}, status=400)
    tpl = FrameTemplate.objects.filter(pk=request.POST.get('template') or 0).first()
    c = Creation.objects.create(template=tpl, image=f)
    return JsonResponse({'ok': True, 'id': c.pk})


INQUIRY_LIMIT = 5          # messages allowed per visitor
INQUIRY_WINDOW = 60 * 60   # ... per hour


@require_POST
def api_inquiry(request):
    """Contact form on the public site. Saved to the database and shown in the admin panel."""
    data = request.POST
    if data.get('website'):  # hidden honeypot field: real visitors never fill it
        return JsonResponse({'ok': True})
    ip = request.META.get('REMOTE_ADDR', 'unknown')
    key = f'inquiry-rate:{ip}'
    sent = cache.get(key, 0)
    if sent >= INQUIRY_LIMIT:
        return JsonResponse({'ok': False, 'error': 'Too many messages. Please try again later.'}, status=429)

    name = data.get('name', '').strip()
    email = data.get('email', '').strip()
    message = data.get('message', '').strip()
    errors = {}
    if not name:
        errors['name'] = 'Please enter your name.'
    try:
        validate_email(email)
    except ValidationError:
        errors['email'] = 'Please enter a valid email address.'
    if not message:
        errors['message'] = 'Please write a message.'
    event_date = None
    if data.get('event_date'):
        try:
            event_date = date.fromisoformat(data['event_date'])
        except ValueError:
            errors['event_date'] = 'Please choose a valid date.'
    if errors:
        return JsonResponse({'ok': False, 'errors': errors}, status=400)

    Inquiry.objects.create(
        name=name[:120], email=email[:254], phone=data.get('phone', '').strip()[:30],
        interest=data.get('interest', '').strip()[:80], event_date=event_date, message=message[:5000])
    cache.set(key, sent + 1, INQUIRY_WINDOW)
    return JsonResponse({'ok': True})
