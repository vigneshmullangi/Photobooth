from datetime import timedelta
from functools import wraps
from io import BytesIO
import json
import math
from pathlib import Path

import qrcode
from PIL import Image
from django.contrib import messages
from django.contrib.auth import login, logout
from django.contrib.auth.views import redirect_to_login
from django.core.files.base import ContentFile
from django.core.paginator import Paginator
from django.db import transaction
from django.db.models import Count, Q, ProtectedError
from django.http import HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.utils import timezone
from django.utils.http import url_has_allowed_host_and_scheme
from django.utils.text import slugify
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_GET, require_POST

from ..models import BusinessCampaign, Category, Creation, FrameSlot, FrameTemplate, Inquiry
from .context import notification_payload
from .forms import CampaignForm, CategoryForm, FrameForm, SlotFormSet, StaffAuthenticationForm, TextFieldFormSet


# ---------------------------------------------------------------- helpers
def staff_required(view):
    @wraps(view)
    def wrapper(request, *args, **kwargs):
        user = request.user
        if not (user.is_authenticated and user.is_staff and user.is_active):
            if request.path.endswith('/api/notifications/'):
                return JsonResponse({'error': 'auth'}, status=401)
            return redirect_to_login(request.get_full_path(), reverse('panel:login'))
        return view(request, *args, **kwargs)
    return never_cache(wrapper)


def paginate(request, queryset, per_page):
    page = Paginator(queryset, per_page).get_page(request.GET.get('page'))
    params = request.GET.copy()
    params.pop('page', None)
    return page, params.urlencode()


def page_ctx(section, title, **extra):
    return {'section': section, 'page_title': title, **extra}


def safe_next(request, fallback):
    target = request.POST.get('next') or request.GET.get('next') or ''
    if target and url_has_allowed_host_and_scheme(target, {request.get_host()}, request.is_secure()):
        return target
    return reverse(fallback)


# ---------------------------------------------------------------- auth
def login_view(request):
    if request.user.is_authenticated and request.user.is_staff:
        return redirect('panel:dashboard')
    form = StaffAuthenticationForm(request, data=request.POST or None)
    if request.method == 'POST' and form.is_valid():
        login(request, form.get_user())
        return redirect(safe_next(request, 'panel:dashboard'))
    return render(request, 'panel/login.html', {'form': form, 'next': request.GET.get('next', '')})


@require_POST
def logout_view(request):
    logout(request)
    return redirect('panel:login')


# ---------------------------------------------------------------- dashboard
@staff_required
def dashboard(request):
    now = timezone.localtime()
    today = now.date()
    days = [today - timedelta(days=i) for i in range(13, -1, -1)]
    since = now.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=13)

    # Bucket by day in Python so this works on MySQL without timezone tables.
    inq_by_day, cre_by_day = {d: 0 for d in days}, {d: 0 for d in days}
    for created in Inquiry.objects.filter(created__gte=since).values_list('created', flat=True):
        inq_by_day[timezone.localtime(created).date()] += 1
    for created in Creation.objects.filter(created__gte=since).values_list('created', flat=True):
        cre_by_day[timezone.localtime(created).date()] += 1
    peak = max([1, *inq_by_day.values(), *cre_by_day.values()])
    chart = [{'label': d.strftime('%d %b'), 'short': d.strftime('%d'), 'inq': inq_by_day[d], 'cre': cre_by_day[d],
              'inq_h': round(inq_by_day[d] / peak * 100, 1), 'cre_h': round(cre_by_day[d] / peak * 100, 1)}
             for d in days]

    ctx = page_ctx(
        'dashboard', 'Dashboard',
        stats={
            'campaigns': BusinessCampaign.objects.count(),
            'campaigns_active': BusinessCampaign.objects.filter(is_active=True).count(),
            'frames': FrameTemplate.objects.count(),
            'frames_active': FrameTemplate.objects.filter(is_active=True, category__isnull=False).count(),
            'creations': Creation.objects.count(),
            'creations_week': Creation.objects.filter(created__gte=now - timedelta(days=7)).count(),
            'inquiries_new': Inquiry.objects.filter(is_read=False).count(),
            'inquiries_total': Inquiry.objects.count(),
        },
        chart=chart, chart_total_inq=sum(inq_by_day.values()), chart_total_cre=sum(cre_by_day.values()),
        recent_inquiries=Inquiry.objects.all()[:6],
        recent_campaigns=BusinessCampaign.objects.select_related('frame_template').order_by('-created')[:5],
        recent_creations=Creation.objects.select_related('template')[:8],
    )
    return render(request, 'panel/dashboard.html', ctx)


# ---------------------------------------------------------------- campaigns
@staff_required
def campaigns(request):
    q = request.GET.get('q', '').strip()
    status = request.GET.get('status', '')
    qs = BusinessCampaign.objects.select_related('frame_template__category')
    if q:
        qs = qs.filter(Q(brand_name__icontains=q) | Q(slug__icontains=q))
    if status in ('active', 'paused'):
        qs = qs.filter(is_active=(status == 'active'))
    page, qs_params = paginate(request, qs, 20)
    return render(request, 'panel/campaigns.html', page_ctx(
        'campaigns', 'Business campaigns', page=page, qs_params=qs_params, q=q, status=status))


@staff_required
def campaign_edit(request, pk=None):
    campaign = get_object_or_404(BusinessCampaign, pk=pk) if pk else None
    form = CampaignForm(request.POST or None, request.FILES or None, instance=campaign)
    if request.method == 'POST' and form.is_valid():
        saved = form.save()
        messages.success(request, f'Campaign "{saved.brand_name}" saved.' if campaign else
                         f'Campaign "{saved.brand_name}" created. Its QR code is ready to download.')
        return redirect('panel:campaign_edit', pk=saved.pk)
    return render(request, 'panel/campaign_form.html', page_ctx(
        'campaigns', campaign.brand_name if campaign else 'New campaign', form=form, campaign=campaign))


@staff_required
def campaign_qr(request, pk):
    campaign = get_object_or_404(BusinessCampaign, pk=pk)
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_Q, box_size=16, border=4)
    qr.add_data(campaign.public_url)
    qr.make(fit=True)
    out = BytesIO()
    qr.make_image(fill_color='black', back_color='white').save(out, format='PNG')
    response = HttpResponse(out.getvalue(), content_type='image/png')
    disposition = 'attachment' if request.GET.get('download') else 'inline'
    response['Content-Disposition'] = f'{disposition}; filename="{campaign.slug}-qr.png"'
    return response


@staff_required
@require_POST
def campaign_toggle(request, pk):
    campaign = get_object_or_404(BusinessCampaign, pk=pk)
    campaign.is_active = not campaign.is_active
    try:
        campaign.full_clean(exclude=['logo'])
    except Exception as exc:
        messages.error(request, 'Could not activate this campaign: ' + '; '.join(
            m for ms in getattr(exc, 'message_dict', {'': [str(exc)]}).values() for m in ms))
    else:
        campaign.save(update_fields=['is_active', 'updated'])
        messages.success(request, f'"{campaign.brand_name}" is now {"live" if campaign.is_active else "paused"}.')
    return redirect(safe_next(request, 'panel:campaigns'))


@staff_required
@require_POST
def campaign_delete(request, pk):
    campaign = get_object_or_404(BusinessCampaign, pk=pk)
    name = campaign.brand_name
    campaign.delete()
    messages.success(request, f'Campaign "{name}" deleted. Its link and QR code no longer work.')
    return redirect('panel:campaigns')


# ---------------------------------------------------------------- frames
@staff_required
def frame_designer(request):
    campaign_id = request.GET.get('campaign_id', '').strip()
    campaign = get_object_or_404(BusinessCampaign, pk=campaign_id) if campaign_id.isdigit() else None
    frame_id = request.GET.get('frame_id', '').strip()
    frame = get_object_or_404(FrameTemplate, pk=frame_id) if frame_id.isdigit() else None
    if frame and frame.category_id:
        messages.info(request, 'Studio saves campaign designs as campaign-only frames. The original public frame remains unchanged.')
        frame = None
    return render(request, 'booth/index.html', {
        'campaign': None,
        'admin_studio': True,
        'studio_backgrounds': [],
        'admin_studio_config': {
            'saveUrl': reverse('panel:frame_designer_save'),
            'returnUrl': reverse('panel:campaign_edit', args=[campaign.pk]) if campaign else reverse('panel:frames'),
            'campaignId': campaign.pk if campaign else None,
            'frameId': frame.pk if frame else None,
            'defaultName': f'{campaign.brand_name} frame' if campaign else (f'{frame.name} copy' if frame else 'Campaign frame'),
        },
    })


@staff_required
@require_POST
def frame_designer_save(request):
    name = request.POST.get('name', '').strip()[:120]
    upload = request.FILES.get('image')
    if not name or not upload or upload.size > 20 * 1024 * 1024:
        return JsonResponse({'ok': False, 'error': 'Add a frame name and a PNG under 20 MB.'}, status=400)
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
        default_filter = request.POST.get('filter', 'Normal')
        if default_filter not in {'Normal', 'B&W', 'Sepia', 'Vivid', 'Warm', 'Cool', 'Vintage', 'Dreamy', 'Noir', 'Fade'}:
            raise ValueError
        raw = upload.read()
        image = Image.open(BytesIO(raw))
        image.verify()
        image = Image.open(BytesIO(raw)).convert('RGBA')
        if image.width > 6000 or image.height > 8000 or image.getchannel('A').getextrema()[0] >= 255:
            return JsonResponse({'ok': False, 'error': 'The frame PNG must contain transparent photo windows.'}, status=400)
        png = BytesIO()
        image.save(png, format='PNG', optimize=True)
    except (ValueError, KeyError, TypeError, json.JSONDecodeError, OSError):
        return JsonResponse({'ok': False, 'error': 'The frame design could not be read. Review the photo windows and try again.'}, status=400)

    campaign_id = request.POST.get('campaign_id', '').strip()
    campaign = get_object_or_404(BusinessCampaign, pk=campaign_id) if campaign_id.isdigit() else None
    frame_id = request.POST.get('frame_id', '').strip()
    frame = get_object_or_404(FrameTemplate, pk=frame_id) if frame_id.isdigit() else None
    with transaction.atomic():
        if frame:
            frame.name = name
            frame.image = ContentFile(png.getvalue(), name=f'{slugify(name) or "campaign-frame"}.png')
            frame.width = 0
            frame.default_filter = default_filter
            frame._skip_detect = True
            frame.save()
            frame.slots.all().delete()
        else:
            frame = FrameTemplate(name=name, category=None, is_active=True,
                                  default_filter=default_filter,
                                  image=ContentFile(png.getvalue(), name=f'{slugify(name) or "campaign-frame"}.png'))
            frame._skip_detect = True
            frame.save()
        FrameSlot.objects.bulk_create([
            FrameSlot(template=frame, order=index, **slot) for index, slot in enumerate(cleaned_slots)
        ])
        if campaign:
            campaign.frame_template = frame
            campaign.save(update_fields=['frame_template', 'updated'])
    messages.success(request, f'Frame "{frame.name}" saved from Studio.' +
                     (f' It is now assigned to {campaign.brand_name}.' if campaign else ''))
    return JsonResponse({'ok': True, 'frameId': frame.pk, 'frameName': frame.name,
                         'url': reverse('panel:campaign_edit', args=[campaign.pk]) if campaign
                         else reverse('panel:frame_edit', args=[frame.pk])})


@staff_required
def frames(request):
    q = request.GET.get('q', '').strip()
    category = request.GET.get('category', '')
    status = request.GET.get('status', '')
    qs = FrameTemplate.objects.select_related('category').annotate(n_slots=Count('slots', distinct=True))
    if q:
        qs = qs.filter(name__icontains=q)
    if category.isdigit():
        qs = qs.filter(category_id=category)
    if status in ('active', 'hidden'):
        qs = qs.filter(is_active=(status == 'active'))
    page, qs_params = paginate(request, qs, 24)
    return render(request, 'panel/frames.html', page_ctx(
        'frames', 'Frames', page=page, qs_params=qs_params, q=q, category=category, status=status,
        categories=Category.objects.all()))


@staff_required
def frame_edit(request, pk=None):
    frame = get_object_or_404(FrameTemplate, pk=pk) if pk else None
    form = FrameForm(request.POST or None, request.FILES or None, instance=frame)
    formset = SlotFormSet(request.POST or None, instance=frame, prefix='slots') if frame else None
    tformset = TextFieldFormSet(request.POST or None, request.FILES or None, instance=frame, prefix='texts') if frame else None
    if request.method == 'POST' and form.is_valid() and (formset is None or (formset.is_valid() and tformset.is_valid())):
        with transaction.atomic():
            obj = form.save(commit=False)
            obj._skip_detect = True
            if frame and 'image' in form.changed_data:
                obj.slots.all().delete()
            obj.save()
            if formset is not None and 'image' not in form.changed_data:
                formset.instance = obj
                formset.save()
                tformset.instance = obj
                tformset.save()
        found = 0
        if not obj.slots.exists():
            found = obj.detect_slots()
        if found:
            messages.info(request, f'Detected {found} photo window(s). Check the numbered preview below.')
        messages.success(request, f'Frame "{obj.name}" saved.')
        return redirect('panel:frame_edit', pk=obj.pk)
    return render(request, 'panel/frame_form.html', page_ctx(
        'frames', frame.name if frame else 'Upload frame', form=form, formset=formset, tformset=tformset, frame=frame,
        texts=list(frame.text_fields.all()) if frame else [],
        slots=list(frame.slots.all()) if frame else []))


@staff_required
def frames_bulk(request):
    cats = Category.objects.all()
    if request.method == 'POST':
        category_id = request.POST.get('category', '').strip()
        cat = get_object_or_404(Category, pk=category_id) if category_id else None
        made = failed = 0
        for f in request.FILES.getlist('images'):
            name = Path(f.name).stem.replace('_', ' ').replace('-', ' ').strip().title()[:120] or 'Untitled frame'
            try:
                FrameTemplate(name=name, category=cat, image=f).save()
                made += 1
            except Exception:
                failed += 1
        if made:
            if cat:
                messages.success(request, f'Uploaded {made} frame(s) to "{cat.name}". You can rename them from the list.')
            else:
                messages.success(request, f'Uploaded {made} campaign-only frame(s). They are not listed on the public website.')
        if failed:
            messages.error(request, f'{failed} file(s) could not be read as images.')
        if not made and not failed:
            messages.error(request, 'Choose at least one image to upload.')
            return redirect('panel:frames_bulk')
        return redirect('panel:frames')
    return render(request, 'panel/frames_bulk.html', page_ctx('frames', 'Bulk upload', categories=cats))


@staff_required
@require_POST
def frames_action(request):
    ids = [i for i in request.POST.getlist('ids') if i.isdigit()]
    action = request.POST.get('action', '')
    qs = FrameTemplate.objects.filter(pk__in=ids)
    if not ids or not qs.exists():
        messages.error(request, 'Select at least one frame first.')
        return redirect(safe_next(request, 'panel:frames'))
    n = qs.count()
    if action == 'show':
        qs.update(is_active=True)
        messages.success(request, f'{n} frame(s) activated.')
    elif action == 'hide':
        qs.update(is_active=False)
        messages.success(request, f'{n} frame(s) deactivated.')
    elif action == 'redetect':
        for t in qs:
            t.detect_slots(force=True)
        messages.success(request, f'Photo windows re-detected for {n} frame(s).')
    elif action == 'fix':
        fixed = 0
        for t in qs:
            try:
                if t.clean_checkerboard():
                    t.slots.all().delete()
                    t.save()
                    fixed += 1
            except Exception:
                pass
        messages.success(request, f'Checkerboard removed from {fixed} of {n} frame(s). Others were left unchanged.')
    elif action == 'duplicate':
        for t in list(qs):
            slots = list(t.slots.all())
            texts = list(t.text_fields.all())
            t.pk = None
            t._state.adding = True
            t.name = f'{t.name} copy'[:120]
            t._skip_detect = True
            t.save()
            FrameSlot.objects.bulk_create([FrameSlot(template=t, order=s.order, x=s.x, y=s.y, w=s.w, h=s.h, shape=s.shape) for s in slots])
            for tf in texts:
                tf.pk = None
                tf.template = t
                tf.save()
        messages.success(request, f'{n} frame(s) duplicated.')
    elif action == 'delete':
        deleted = blocked = 0
        for t in qs:
            try:
                t.delete()
                deleted += 1
            except ProtectedError:
                blocked += 1
        if deleted:
            messages.success(request, f'{deleted} frame(s) deleted.')
        if blocked:
            messages.error(request, f'{blocked} frame(s) are used by a business campaign and were not deleted.')
    else:
        messages.error(request, 'Choose an action.')
    return redirect(safe_next(request, 'panel:frames'))


@staff_required
@require_POST
def frame_delete(request, pk):
    frame = get_object_or_404(FrameTemplate, pk=pk)
    try:
        frame.delete()
    except ProtectedError:
        messages.error(request, f'"{frame.name}" is used by a business campaign. Change or delete that campaign first.')
        return redirect('panel:frame_edit', pk=pk)
    messages.success(request, f'Frame "{frame.name}" deleted.')
    return redirect('panel:frames')


# ---------------------------------------------------------------- categories
@staff_required
def categories(request):
    items = Category.objects.annotate(n_frames=Count('templates'))
    return render(request, 'panel/categories.html', page_ctx('categories', 'Categories', items=items))


@staff_required
def category_edit(request, pk=None):
    category = get_object_or_404(Category, pk=pk) if pk else None
    form = CategoryForm(request.POST or None, instance=category)
    if request.method == 'POST' and form.is_valid():
        saved = form.save()
        messages.success(request, f'Category "{saved.name}" saved.')
        return redirect('panel:categories')
    return render(request, 'panel/category_form.html', page_ctx(
        'categories', category.name if category else 'New category', form=form, category=category))


@staff_required
@require_POST
def category_delete(request, pk):
    category = get_object_or_404(Category, pk=pk)
    try:
        category.delete()
    except ProtectedError:
        messages.error(request, f'"{category.name}" still has frames. Move or delete them first.')
    else:
        messages.success(request, f'Category "{category.name}" deleted.')
    return redirect('panel:categories')


# ---------------------------------------------------------------- creations
@staff_required
def creations(request):
    category = request.GET.get('category', '')
    qs = Creation.objects.select_related('template__category')
    if category.isdigit():
        qs = qs.filter(template__category_id=category)
    page, qs_params = paginate(request, qs, 24)
    return render(request, 'panel/creations.html', page_ctx(
        'creations', 'Gallery', page=page, qs_params=qs_params, category=category, categories=Category.objects.all()))


@staff_required
@require_POST
def creation_delete(request, pk):
    get_object_or_404(Creation, pk=pk).delete()
    messages.success(request, 'Picture deleted from the gallery.')
    return redirect(safe_next(request, 'panel:creations'))


# ---------------------------------------------------------------- inquiries
@staff_required
def inquiries(request):
    q = request.GET.get('q', '').strip()
    status = request.GET.get('status', '')
    qs = Inquiry.objects.all()
    counts = {s: Inquiry.objects.filter(status=s).count() for s, _ in Inquiry.STATUS_CHOICES}
    counts['all'] = sum(counts.values())
    counts['unread'] = Inquiry.objects.filter(is_read=False).count()
    if status == 'unread':
        qs = qs.filter(is_read=False)
    elif status in counts:
        qs = qs.filter(status=status)
    if q:
        qs = qs.filter(Q(name__icontains=q) | Q(email__icontains=q) | Q(message__icontains=q) | Q(phone__icontains=q))
    page, qs_params = paginate(request, qs, 20)
    return render(request, 'panel/inquiries.html', page_ctx(
        'inquiries', 'Inquiries', page=page, qs_params=qs_params, q=q, status=status, counts=counts))


@staff_required
def inquiry_detail(request, pk):
    inquiry = get_object_or_404(Inquiry, pk=pk)
    if request.method == 'POST':
        action = request.POST.get('action')
        if action == 'status' and request.POST.get('status') in dict(Inquiry.STATUS_CHOICES):
            inquiry.status = request.POST['status']
            inquiry.is_read = True
            inquiry.save(update_fields=['status', 'is_read'])
            messages.success(request, f'Marked as {inquiry.get_status_display().lower()}.')
        elif action == 'unread':
            inquiry.is_read = False
            inquiry.save(update_fields=['is_read'])
            messages.success(request, 'Marked as unread.')
            return redirect('panel:inquiries')
        return redirect('panel:inquiry_detail', pk=pk)
    if not inquiry.is_read:
        inquiry.is_read = True
        inquiry.save(update_fields=['is_read'])
    return render(request, 'panel/inquiry_detail.html', page_ctx('inquiries', inquiry.name, inquiry=inquiry))


@staff_required
@require_POST
def inquiry_delete(request, pk):
    get_object_or_404(Inquiry, pk=pk).delete()
    messages.success(request, 'Inquiry deleted.')
    return redirect('panel:inquiries')


@staff_required
@require_POST
def inquiries_read_all(request):
    n = Inquiry.objects.filter(is_read=False).update(is_read=True)
    messages.success(request, f'{n} inquiries marked as read.' if n else 'Nothing to mark as read.')
    return redirect(safe_next(request, 'panel:inquiries'))


@staff_required
@require_GET
def notifications_api(request):
    return JsonResponse(notification_payload())
