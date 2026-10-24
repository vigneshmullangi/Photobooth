from urllib.parse import urlsplit
from urllib.parse import urlencode
from datetime import date, timedelta
from io import BytesIO
import base64
import json
import math
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

from django.conf import settings
from django.contrib.auth import authenticate, get_user_model, login
from django.contrib.auth.password_validation import validate_password
from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.core.files.base import ContentFile
from django.core.validators import validate_email
from django.db import transaction
from django.db.models import F, Prefetch
from django.http import Http404, HttpResponse, HttpResponseBadRequest, JsonResponse
from django.shortcuts import redirect, render
from django.urls import reverse
from django.utils import timezone
from django.views.decorators.http import require_GET, require_POST
from PIL import Image, ImageDraw, ImageFont
import qrcode
from django.utils.text import slugify

from .models import BusinessCampaign, Category, Creation, FrameSlot, FrameTemplate, GuestAccountProfile, Inquiry, SiteMetric, SiteVisitor, StripTemplate
from .detect import detect_windows
from .cleaner import remove_checkerboard


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
    # one-window fallback when a real transparent opening can now be detected.
    if (len(slots) == 1 and abs(slots[0].x - 10) < .01 and abs(slots[0].y - 10) < .01
            and abs(slots[0].w - 80) < .01 and abs(slots[0].h - 60) < .01 and template.image):
        with template.image.storage.open(template.image.name, 'rb') as image_file:
            found = detect_windows(image_file)
        if found:
            template.slots.all().delete()
            FrameSlot.objects.bulk_create(
                [FrameSlot(template=template, order=i, **slot) for i, slot in enumerate(found)])
            slots = list(template.slots.all())
    if not slots or not template.width:
        return None
    return {
        'id': template.pk, 'name': template.name, 'image': template.image.url, 'w': template.width, 'h': template.height,
        'community': bool(template.category_id and template.category.name == 'Community designs'),
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


def strip_payloads(template):
    template.build_layout_variants()
    if not template.canvas_width or not template.canvas_height:
        return []
    texts = [{'id': field.pk, 'label': field.label, 'type': field.data_type,
              'text': field.default_text, 'image': field.default_image.url if field.default_image else '',
              'max': field.max_length, 'x': field.x / 100, 'y': field.y / 100,
              'w': field.w / 100, 'h': field.h / 100, 'font': field.font,
              'fontSize': field.font_size, 'bold': field.bold, 'italic': field.italic,
              'underline': field.underline, 'effect': field.effect, 'color': field.color,
              'align': field.align, 'upper': field.uppercase} for field in template.studio_fields.all()]
    payloads = []
    for variant in template.layout_variants.prefetch_related('windows').all():
        windows = list(variant.windows.all())
        if len(windows) != variant.photo_count:
            continue
        artwork = variant.image if variant.image else template.image
        width = variant.canvas_width or template.canvas_width
        height = variant.canvas_height or template.canvas_height
        slots = [{'x': w.x / 100, 'y': w.y / 100, 'w': w.w / 100, 'h': w.h / 100,
                  'shape': 'square'} for w in windows]
        payloads.append({
            'id': f'admin-strip-{template.pk}-{variant.photo_count}',
            'name': template.name, 'n': variant.photo_count, 'image': artwork.url,
            'customArtwork': True, 'width': width, 'height': height,
            'w': width, 'h': height,
            'photoWindows': [{key: slot[key] for key in ('x', 'y', 'w', 'h')} for slot in slots],
            'slots': slots, 'texts': texts,
        })
    return payloads


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
    return render(request, 'booth/index.html', {
        'campaign': config,
        'strip_templates': [payload for item in StripTemplate.objects.filter(is_active=True)
                            for payload in strip_payloads(item)],
        'studio_backgrounds': background_files,
        'google_auth_config': {
            'authenticated': request.user.is_authenticated,
            'googleStartUrl': reverse('google_auth_start'),
            'googleEnabled': bool(settings.GOOGLE_OAUTH_CLIENT_ID and settings.GOOGLE_OAUTH_CLIENT_SECRET),
        },
    })


def _safe_local_next(value):
    parsed = urlsplit(str(value or '/'))
    if (parsed.scheme or parsed.netloc or not parsed.path.startswith('/') or
            parsed.path.startswith('//') or '\\' in parsed.path):
        return '/'
    return parsed.geturl()


def google_auth_prompt(request):
    next_url = _safe_local_next(request.POST.get('next') if request.method == 'POST' else request.GET.get('next'))
    popup = (request.POST.get('popup') if request.method == 'POST' else request.GET.get('popup')) == '1'
    if request.user.is_authenticated:
        if popup:
            return render(request, 'booth/auth_complete.html')
        return redirect(next_url)
    configured = bool(settings.GOOGLE_OAUTH_CLIENT_ID and settings.GOOGLE_OAUTH_CLIENT_SECRET)
    active_tab = request.POST.get('action') if request.method == 'POST' else 'login'
    email = (request.POST.get('email') or '').strip().lower()
    error = ''
    if request.method == 'POST':
        User = get_user_model()
        action = request.POST.get('action')
        if action == 'signup':
            password = request.POST.get('password', '')
            confirm_password = request.POST.get('confirm_password', '')
            organization = (request.POST.get('organization') or '').strip()
            try:
                validate_email(email)
                if not organization or len(organization) > 160:
                    raise ValidationError('Enter an organization name (160 characters or fewer).')
                if User.objects.filter(email__iexact=email).exists():
                    raise ValidationError('An account with this email already exists. Log in or continue with Google.')
                if password != confirm_password:
                    raise ValidationError('The passwords do not match.')
                validate_password(password)
                username_field = User.USERNAME_FIELD
                user_data = {username_field: email}
                if username_field != 'email':
                    username_max = User._meta.get_field(username_field).max_length or 150
                    username = email if len(email) <= username_max else f'guest_{secrets.token_hex(12)}'
                    if User.objects.filter(**{f'{username_field}__iexact': username}).exists():
                        username = f'guest_{secrets.token_hex(12)}'
                    user_data[username_field] = username
                    user_data['email'] = email
                user = User(**user_data)
                user.set_password(password)
                user.save()
                GuestAccountProfile.objects.create(user=user, organization_name=organization)
                login(request, user, backend='django.contrib.auth.backends.ModelBackend')
                if popup:
                    return render(request, 'booth/auth_complete.html')
                return redirect(next_url)
            except ValidationError as exc:
                error = ' '.join(exc.messages)
        elif action == 'login':
            User = get_user_model()
            user_record = User.objects.filter(email__iexact=email).first()
            identifier = user_record.get_username() if user_record else email
            credentials = {User.USERNAME_FIELD: identifier, 'password': request.POST.get('password', '')}
            user = authenticate(request, **credentials)
            if user is not None and user.is_active:
                login(request, user)
                if popup:
                    return render(request, 'booth/auth_complete.html')
                return redirect(next_url)
            error = 'Email or password is incorrect. If you used Google to create your account, continue with Google.'
        else:
            error = 'Choose log in or sign up to continue.'
    return render(request, 'booth/google_login.html', {
        'next_url': next_url,
        'configured': configured,
        'error': error or request.GET.get('error', ''),
        'active_tab': active_tab if active_tab in {'login', 'signup'} else 'login',
        'email': email,
        'popup': popup,
    })


def google_auth_start(request):
    next_url = _safe_local_next(request.GET.get('next'))
    popup = request.GET.get('popup') == '1'
    if request.user.is_authenticated:
        if popup:
            return render(request, 'booth/auth_complete.html')
        return redirect(next_url)
    if not (settings.GOOGLE_OAUTH_CLIENT_ID and settings.GOOGLE_OAUTH_CLIENT_SECRET):
        return redirect(f"{reverse('google_auth_prompt')}?{urlencode({'next': next_url, 'error': 'not_configured', 'popup': int(popup)})}")
    redirect_uri = settings.GOOGLE_OAUTH_REDIRECT_URI or request.build_absolute_uri(reverse('google_auth_callback'))
    state, nonce = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    request.session['google_oauth_state'] = state
    request.session['google_oauth_nonce'] = nonce
    request.session['google_oauth_next'] = next_url
    request.session['google_oauth_popup'] = popup
    query = urlencode({
        'client_id': settings.GOOGLE_OAUTH_CLIENT_ID,
        'redirect_uri': redirect_uri,
        'response_type': 'code',
        'scope': 'openid email profile',
        'state': state,
        'nonce': nonce,
        'prompt': 'select_account',
    })
    return redirect(f'https://accounts.google.com/o/oauth2/v2/auth?{query}')


def google_auth_callback(request):
    state = request.GET.get('state', '')
    expected_state = request.session.pop('google_oauth_state', '')
    expected_nonce = request.session.pop('google_oauth_nonce', '')
    next_url = _safe_local_next(request.session.pop('google_oauth_next', '/'))
    popup = request.session.pop('google_oauth_popup', False)
    if not expected_state or not secrets.compare_digest(state, expected_state):
        return HttpResponseBadRequest('Google sign-in could not be verified. Please try again.')
    if request.GET.get('error'):
        return redirect(f"{reverse('google_auth_prompt')}?{urlencode({'next': next_url, 'error': 'cancelled', 'popup': int(popup)})}")
    code = request.GET.get('code', '')
    if not code or not (settings.GOOGLE_OAUTH_CLIENT_ID and settings.GOOGLE_OAUTH_CLIENT_SECRET):
        return redirect(f"{reverse('google_auth_prompt')}?{urlencode({'next': next_url, 'error': 'failed', 'popup': int(popup)})}")
    redirect_uri = settings.GOOGLE_OAUTH_REDIRECT_URI or request.build_absolute_uri(reverse('google_auth_callback'))
    try:
        token_request = urllib.request.Request(
            'https://oauth2.googleapis.com/token',
            data=urlencode({
                'code': code,
                'client_id': settings.GOOGLE_OAUTH_CLIENT_ID,
                'client_secret': settings.GOOGLE_OAUTH_CLIENT_SECRET,
                'redirect_uri': redirect_uri,
                'grant_type': 'authorization_code',
            }).encode(),
            headers={'Content-Type': 'application/x-www-form-urlencoded'},
            method='POST',
        )
        with urllib.request.urlopen(token_request, timeout=12) as response:
            token_data = json.loads(response.read().decode())
        id_token = token_data.get('id_token')
        if not id_token:
            raise ValueError('Google did not return an identity token.')
        verify_url = 'https://oauth2.googleapis.com/tokeninfo?' + urlencode({'id_token': id_token})
        with urllib.request.urlopen(verify_url, timeout=12) as response:
            identity = json.loads(response.read().decode())
        issuer = identity.get('iss')
        if (identity.get('aud') != settings.GOOGLE_OAUTH_CLIENT_ID or
                issuer not in {'accounts.google.com', 'https://accounts.google.com'} or
                identity.get('nonce') != expected_nonce or
                identity.get('email_verified') not in {'true', True} or
                int(identity.get('exp', '0')) <= int(time.time()) or
                not identity.get('email')):
            raise ValueError('Google identity verification failed.')
        email = identity['email'].strip().lower()
        User = get_user_model()
        user = User.objects.filter(email__iexact=email).first()
        if user is None:
            username_field = User.USERNAME_FIELD
            username = email
            if User.objects.filter(**{f'{username_field}__iexact': username}).exists():
                username = f'google_{secrets.token_hex(12)}'
            user_data = {username_field: username}
            if username_field != 'email':
                user_data['email'] = email
            user = User(**user_data)
            user.set_unusable_password()
        if not user.is_active:
            raise ValueError('This account is inactive.')
        if hasattr(user, 'first_name'):
            user.first_name = identity.get('given_name', '')[:150]
            user.last_name = identity.get('family_name', '')[:150]
        user.save()
        GuestAccountProfile.objects.get_or_create(user=user)
        login(request, user, backend='django.contrib.auth.backends.ModelBackend')
        if popup:
            return render(request, 'booth/auth_complete.html')
        return redirect(next_url)
    except (urllib.error.URLError, urllib.error.HTTPError, ValueError, TypeError, KeyError, json.JSONDecodeError):
        return redirect(f"{reverse('google_auth_prompt')}?{urlencode({'next': next_url, 'error': 'failed', 'popup': int(popup)})}")


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
def api_save_shared_frame(request):
    """Save an authenticated guest-personalized frame as a public template."""
    if not request.user.is_authenticated:
        return JsonResponse({'ok': False, 'error': 'Log in or sign up before saving a personalized frame.'}, status=401)
    name = request.POST.get('name', '').strip()[:120]
    upload = request.FILES.get('image')
    if not name or not upload or upload.size > 15 * 1024 * 1024:
        return JsonResponse({'ok': False, 'error': 'Add a frame name and choose an image under 15 MB.'}, status=400)
    try:
        slots = json.loads(request.POST.get('slots', ''))
        if not isinstance(slots, list) or not 1 <= len(slots) <= 4:
            raise ValueError
        cleaned_slots = []
        for slot in slots:
            values = {key: float(slot[key]) for key in ('x', 'y', 'w', 'h')}
            shape = str(slot.get('shape', 'square'))
            if shape not in {'square', 'circle', 'diamond', 'heart'}:
                raise ValueError
            if (not all(math.isfinite(value) for value in values.values()) or
                    not (0 <= values['x'] < 100 and 0 <= values['y'] < 100 and
                         0 < values['w'] <= 100 and 0 < values['h'] <= 100 and
                         values['x'] + values['w'] <= 100.01 and values['y'] + values['h'] <= 100.01)):
                raise ValueError
            cleaned_slots.append({**values, 'shape': shape})
        raw = upload.read()
        with Image.open(BytesIO(raw)) as source:
            if source.width > 6000 or source.height > 8000 or source.width * source.height > 12_000_000:
                return JsonResponse({'ok': False, 'error': 'Frame dimensions are too large.'}, status=400)
            source.verify()
        with Image.open(BytesIO(raw)) as source:
            image = source.convert('RGBA')
        if image.getchannel('A').getextrema()[0] >= 255:
            return JsonResponse({'ok': False, 'error': 'The frame needs transparent photo windows.'}, status=400)
        png = BytesIO()
        image.save(png, format='PNG', optimize=True)
    except (ValueError, KeyError, TypeError, json.JSONDecodeError, OSError):
        return JsonResponse({'ok': False, 'error': 'The frame could not be read. Please try saving it again.'}, status=400)

    brand_name = request.POST.get('campaign_name', '').strip()[:120] or name
    campaign_slug_name = request.POST.get('campaign_slug_name', '').strip()[:120] or brand_name
    logo_upload = request.FILES.get('campaign_logo')
    try:
        with transaction.atomic():
            category, _ = Category.objects.get_or_create(name='Community designs', defaults={'order': 999})
            if not category.is_active:
                category.is_active = True
                category.save(update_fields=['is_active'])
            frame = FrameTemplate(name=name, category=category, default_filter='Normal', is_active=True)
            frame._skip_detect = True
            frame.image.save('community-frame.png', ContentFile(png.getvalue()), save=False)
            frame.save()
            FrameSlot.objects.bulk_create([
                FrameSlot(template=frame, order=index, **slot)
                for index, slot in enumerate(cleaned_slots)
            ])
            campaign = create_campaign_for_frame(frame, brand_name, logo_upload, slug_name=campaign_slug_name)
    except (OSError, ValueError) as exc:
        return JsonResponse({'ok': False, 'error': str(exc) or 'Could not create a campaign for this frame.'}, status=400)
    return JsonResponse({
        'ok': True, 'id': frame.pk, 'name': frame.name,
        'campaignId': campaign.pk, 'campaignSlug': campaign.slug, 'campaignName': campaign.brand_name,
        'shareUrl': campaign.public_url,
        'qrUrl': f'/api/shared-frames/{frame.pk}/qr.png',
    })


def create_campaign_for_frame(frame, brand_name, logo_upload=None, slug_name=None):
    existing = BusinessCampaign.objects.filter(frame_template=frame, is_active=True).order_by('pk').first()
    if existing:
        return existing
    brand_name = (brand_name or frame.name).strip()[:120] or frame.name
    base_slug = slugify(slug_name or brand_name)[:63].strip('-') or f'frame-{frame.pk}'
    slug = base_slug
    suffix = 2
    while BusinessCampaign.objects.filter(slug=slug).exists():
        tail = f'-{suffix}'
        slug = f'{base_slug[:63 - len(tail)].rstrip("-")}{tail}'
        suffix += 1

    if logo_upload:
        if logo_upload.size > 12 * 1024 * 1024:
            raise ValueError('Choose a brand logo under 12 MB.')
        with Image.open(logo_upload) as source:
            if source.width > 6000 or source.height > 8000:
                raise ValueError('Brand logo dimensions are too large.')
            source.verify()
        logo_upload.seek(0)
        with Image.open(logo_upload) as source:
            logo = source.convert('RGBA')
            logo.thumbnail((1600, 600), Image.LANCZOS)
    else:
        logo = Image.new('RGBA', (1200, 320), (255, 255, 255, 0))
        draw = ImageDraw.Draw(logo)
        draw.rounded_rectangle((50, 50, 270, 270), radius=70, fill='#e4492b')
        try:
            mark_font = ImageFont.truetype('DejaVuSans-Bold.ttf', 150)
            text_font = ImageFont.truetype('DejaVuSans.ttf', 92)
        except OSError:
            mark_font = text_font = ImageFont.load_default()
        mark_box = draw.textbbox((0, 0), 'P', font=mark_font)
        draw.text((160 - (mark_box[2] - mark_box[0]) / 2, 156 - (mark_box[3] - mark_box[1]) / 2 - mark_box[1]),
                  'P', fill='white', font=mark_font)
        text_box = draw.textbbox((0, 0), brand_name, font=text_font)
        text_height = text_box[3] - text_box[1]
        draw.text((315, (320 - text_height) / 2 - text_box[1]), brand_name, fill='#211d18', font=text_font)

    logo_bytes = BytesIO()
    logo.save(logo_bytes, format='PNG', optimize=True)
    campaign = BusinessCampaign(brand_name=brand_name, slug=slug, frame_template=frame, is_active=True)
    campaign.logo.save(f'{slug}-logo.png', ContentFile(logo_bytes.getvalue()), save=False)
    campaign.save()
    return campaign


@require_POST
def api_ensure_shared_frame_campaign(request, pk):
    frame = FrameTemplate.objects.filter(pk=pk, is_active=True, category__name='Community designs').first()
    if not frame or not frame.slots.exists():
        raise Http404('Shared frame not found.')
    brand_name = request.POST.get('brand_name', '').strip()[:120] or frame.name
    try:
        campaign = create_campaign_for_frame(frame, brand_name, request.FILES.get('campaign_logo'), slug_name=brand_name)
    except (OSError, ValueError):
        return JsonResponse({'ok': False, 'error': 'Could not create a campaign for this frame.'}, status=400)
    return JsonResponse({'ok': True, 'campaignId': campaign.pk, 'campaignSlug': campaign.slug,
                         'shareUrl': campaign.public_url, 'qrUrl': f'/api/shared-frames/{frame.pk}/qr.png'})


@require_GET
def api_shared_frame_qr(request, pk):
    frame = FrameTemplate.objects.filter(pk=pk, is_active=True, category__name='Community designs').first()
    if not frame:
        raise Http404('Shared frame not found.')
    campaign = BusinessCampaign.objects.filter(frame_template=frame, is_active=True).order_by('pk').first()
    if not campaign:
        raise Http404('Campaign not found for this frame.')
    target = campaign.public_url
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_Q, box_size=12, border=4)
    qr.add_data(target)
    qr.make(fit=True)
    output = BytesIO()
    code = qr.make_image(fill_color='#171512', back_color='white').convert('RGB')
    image = code
    if request.GET.get('download'):
        try:
            with campaign.logo.open('rb') as logo_file:
                logo = Image.open(logo_file).convert('RGBA')
                logo.thumbnail((int(code.width * .46), int(code.width * .22)), Image.LANCZOS)
            margin = max(24, code.width // 14)
            header_height = logo.height + margin * 2
            image = Image.new('RGB', (code.width + margin * 2, code.height + header_height + margin), 'white')
            image.paste(logo, ((image.width - logo.width) // 2, margin), logo)
            image.paste(code, ((image.width - code.width) // 2, header_height))
        except (OSError, ValueError):
            image = code
    image.save(output, format='PNG', optimize=True)
    response = HttpResponse(output.getvalue(), content_type='image/png')
    response['Content-Disposition'] = f'attachment; filename="{campaign.slug}-qr.png"' if request.GET.get('download') else 'inline'
    response['Cache-Control'] = 'no-store'
    return response


@require_POST
def api_detect_uploaded_template(request):
    upload = request.FILES.get('image')
    if not upload or upload.size > 12 * 1024 * 1024:
        return JsonResponse({'ok': False, 'error': 'Choose an image under 12 MB.'}, status=400)
    try:
        raw = upload.read()
        with Image.open(BytesIO(raw)) as source:
            if source.width > 6000 or source.height > 8000 or source.width * source.height > 12_000_000:
                return JsonResponse({'ok': False, 'error': 'Image dimensions are too large.'}, status=400)
            source.verify()
        cleaned = remove_checkerboard(BytesIO(raw))
        processed = cleaned or raw
        with Image.open(BytesIO(processed)) as source:
            has_transparency = source.convert('RGBA').getchannel('A').getextrema()[0] < 255
        windows = detect_windows(BytesIO(processed)) if has_transparency else []
        response = {'ok': True, 'windows': windows,
                    'cleanedImage': f'data:image/png;base64,{base64.b64encode(cleaned).decode("ascii")}' if cleaned else None}
        return JsonResponse(response)
    except (OSError, ValueError):
        return JsonResponse({'ok': False, 'error': 'Could not inspect the uploaded image.'}, status=400)


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


SITE_VISITOR_COOKIE = 'booth_visitor'
SITE_VISITOR_MAX_AGE = 60 * 60 * 24 * 365
ACTIVE_VISITOR_WINDOW = timedelta(minutes=5)


def site_stats_payload(now=None):
    now = now or timezone.now()
    metric_counts = dict(SiteMetric.objects.values_list('key', 'count'))
    return {
        'photos_captured': metric_counts.get(SiteMetric.PHOTOS_CAPTURED, 0),
        'downloads': metric_counts.get(SiteMetric.DOWNLOADS, 0),
        'users': SiteVisitor.objects.count(),
        'active_now': SiteVisitor.objects.filter(last_seen__gte=now - ACTIVE_VISITOR_WINDOW).count(),
    }


@require_GET
def api_site_stats(request):
    now = timezone.now()
    cookie_value = request.COOKIES.get(SITE_VISITOR_COOKIE, '')
    try:
        visitor_id = uuid.UUID(cookie_value)
        new_visitor_cookie = False
    except (ValueError, AttributeError, TypeError):
        visitor_id = uuid.uuid4()
        new_visitor_cookie = True

    visitor, created = SiteVisitor.objects.get_or_create(
        visitor_id=visitor_id,
        defaults={'last_seen': now},
    )
    if not created:
        SiteVisitor.objects.filter(pk=visitor.pk).update(last_seen=now)

    response = JsonResponse(site_stats_payload(now))
    response['Cache-Control'] = 'no-store'
    if new_visitor_cookie:
        response.set_cookie(
            SITE_VISITOR_COOKIE,
            str(visitor_id),
            max_age=SITE_VISITOR_MAX_AGE,
            httponly=True,
            secure=request.is_secure(),
            samesite='Lax',
        )
    return response


@require_POST
def api_site_metric(request):
    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return JsonResponse({'ok': False, 'error': 'Invalid request.'}, status=400)

    metric_key = data.get('event') if isinstance(data, dict) else None
    if metric_key not in {SiteMetric.PHOTOS_CAPTURED, SiteMetric.DOWNLOADS}:
        return JsonResponse({'ok': False, 'error': 'Invalid metric.'}, status=400)

    metric, _ = SiteMetric.objects.get_or_create(key=metric_key)
    SiteMetric.objects.filter(pk=metric.pk).update(count=F('count') + 1)
    return JsonResponse({'ok': True, **site_stats_payload()})


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
