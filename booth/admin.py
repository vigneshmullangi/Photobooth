from pathlib import Path
from io import BytesIO

from django import forms
from django.contrib import admin, messages
from django.conf import settings
from django.core.exceptions import PermissionDenied
from django.db.models import Count
from django.http import HttpResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import path, reverse
from django.utils.html import format_html
from django.utils.safestring import mark_safe
import qrcode

from .models import BusinessCampaign, Category, Creation, FrameSlot, FrameTemplate, FrameTextField, GuestAccountProfile, StripTemplate

CHECKER = 'repeating-conic-gradient(#ddd 0 25%,#fff 0 50%) 0 0/14px 14px'


@admin.register(GuestAccountProfile)
class GuestAccountProfileAdmin(admin.ModelAdmin):
    """Account directory for staff; password values are intentionally never displayed."""
    list_display = ('organization_name', 'email', 'created', 'last_login')
    search_fields = ('organization_name', 'user__email', 'user__username')
    list_filter = ('user__is_active',)
    readonly_fields = ('user', 'organization_name', 'email', 'created', 'last_login')
    fields = ('organization_name', 'email', 'created', 'last_login')
    ordering = ('-user__date_joined',)

    def get_queryset(self, request):
        return super().get_queryset(request).select_related('user')

    @admin.display(description='Email', ordering='user__email')
    def email(self, obj):
        return obj.user.email

    @admin.display(description='Account created', ordering='user__date_joined')
    def created(self, obj):
        return obj.user.date_joined

    @admin.display(description='Last login', ordering='user__last_login')
    def last_login(self, obj):
        return obj.user.last_login


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ('name', 'slug', 'frames', 'order', 'is_active')
    list_editable = ('order', 'is_active')
    prepopulated_fields = {'slug': ('name',)}
    search_fields = ('name',)

    def get_queryset(self, request):
        return super().get_queryset(request).annotate(_n=Count('templates'))

    @admin.display(description='Frames', ordering='_n')
    def frames(self, obj):
        return obj._n


@admin.register(StripTemplate)
class StripTemplateAdmin(admin.ModelAdmin):
    list_display = ('name', 'photo_count', 'is_active', 'order', 'created')
    list_editable = ('photo_count', 'is_active', 'order')
    list_filter = ('photo_count', 'is_active')
    search_fields = ('name',)
    fields = ('name', 'photo_count', 'image', 'is_active', 'order')


class FrameTextFieldAdminForm(forms.ModelForm):
    font_size = forms.TypedChoiceField(
        choices=[(str(size / 24), f'{size} pt') for size in
                 (8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72, 96, 120)],
        coerce=float,
        label='Font size',
    )

    class Meta:
        model = FrameTextField
        fields = '__all__'


class TextFieldInline(admin.StackedInline):
    model = FrameTextField
    form = FrameTextFieldAdminForm
    extra = 0
    classes = ('collapse',)
    fields = (
        ('order', 'label', 'data_type'),
        ('default_text', 'default_image', 'max_length'),
        ('x', 'y', 'w', 'h'),
        ('font', 'font_size'),
        ('bold', 'italic', 'underline'),
        ('effect', 'color', 'align'),
        'uppercase',
    )


class SlotInline(admin.TabularInline):
    model = FrameSlot
    extra = 0
    fields = ('order', 'x', 'y', 'w', 'h', 'shape')
    verbose_name = 'photo window'
    verbose_name_plural = 'photo windows (auto-detected, edit if needed)'


@admin.register(FrameTemplate)
class FrameTemplateAdmin(admin.ModelAdmin):
    list_display = ('thumb', 'name', 'category', 'photos', 'is_active', 'order', 'updated')
    list_display_links = ('thumb',)
    list_editable = ('name', 'category', 'is_active', 'order')
    list_filter = ('category', 'is_active')
    search_fields = ('name',)
    list_per_page = 40
    inlines = [SlotInline, TextFieldInline]
    readonly_fields = ('slot_preview', 'width', 'height', 'created', 'updated')
    fields = ('name', 'category', 'image', 'is_active', 'order', 'slot_preview', 'width', 'height', 'created', 'updated')
    actions = ['fix_checkerboard', 'redetect', 'duplicate', 'activate', 'deactivate']
    change_list_template = 'admin/booth/frametemplate/change_list.html'

    # ---- list helpers ----
    @admin.display(description='Preview')
    def thumb(self, obj):
        if not obj.image:
            return '-'
        return format_html('<span style="display:inline-block;background:{}"><img src="{}" style="height:64px;display:block"></span>',
                           CHECKER, obj.image.url)

    @admin.display(description='Photos')
    def photos(self, obj):
        return obj.slots.count()

    @admin.display(description='Photo windows (numbered)')
    def slot_preview(self, obj):
        if not obj.pk or not obj.image:
            return 'Save the frame first to see its photo windows.'
        boxes = mark_safe(''.join(
            format_html('<div style="position:absolute;left:{}%;top:{}%;width:{}%;height:{}%;border:2px solid #e4492b;'
                        'background:rgba(228,73,43,.22);color:#c93b20;font:700 16px sans-serif;display:flex;'
                        'align-items:center;justify-content:center">{}</div>', s.x, s.y, s.w, s.h, i + 1)
            for i, s in enumerate(obj.slots.all())))
        return format_html('<div style="position:relative;display:inline-block;background:{}"><img src="{}" '
                           'style="display:block;max-width:340px;max-height:460px">{}</div>', CHECKER, obj.image.url, boxes)

    # ---- saving: detect photo windows after inline edits are stored ----
    def save_model(self, request, obj, form, change):
        obj._skip_detect = True
        if change and 'image' in form.changed_data:
            obj.slots.all().delete()
        super().save_model(request, obj, form, change)

    def save_related(self, request, form, formsets, change):
        super().save_related(request, form, formsets, change)
        obj = form.instance
        if not obj.slots.exists():
            n = obj.detect_slots()
            self.message_user(request, f'Detected {n} photo window(s). Check the numbered preview below.', messages.INFO)

    # ---- actions ----
    @admin.action(description='Fix fake-transparent frames (remove checkerboard) and re-detect windows')
    def fix_checkerboard(self, request, qs):
        fixed = 0
        for t in qs:
            try:
                if t.clean_checkerboard():
                    t.slots.all().delete()
                    t.save()
                    fixed += 1
            except Exception:
                pass
        self.message_user(request, f'Fixed {fixed} of {qs.count()} frame(s). Frames without a checkerboard pattern were left unchanged.')

    @admin.action(description='Re-detect photo windows from the image')
    def redetect(self, request, qs):
        for t in qs:
            t.detect_slots(force=True)
        self.message_user(request, f'Re-detected windows for {qs.count()} frame(s).')

    @admin.action(description='Duplicate selected frames')
    def duplicate(self, request, qs):
        for t in qs:
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
        self.message_user(request, 'Duplicated.')

    @admin.action(description='Activate selected frames')
    def activate(self, request, qs):
        self.message_user(request, f'{qs.update(is_active=True)} frame(s) activated.')

    @admin.action(description='Deactivate selected frames')
    def deactivate(self, request, qs):
        self.message_user(request, f'{qs.update(is_active=False)} frame(s) deactivated.')

    # ---- bulk upload ----
    def get_urls(self):
        extra = [path('bulk-upload/', self.admin_site.admin_view(self.bulk_upload),
                      name='booth_frametemplate_bulk_upload')]
        return extra + super().get_urls()

    def bulk_upload(self, request):
        if not self.has_add_permission(request):
            raise PermissionDenied
        cats = Category.objects.all()
        if request.method == 'POST':
            cat = get_object_or_404(Category, pk=request.POST.get('category'))
            made = failed = 0
            for f in request.FILES.getlist('images'):
                name = Path(f.name).stem.replace('_', ' ').replace('-', ' ').strip().title()[:120] or 'Untitled frame'
                try:
                    FrameTemplate(name=name, category=cat, image=f).save()
                    made += 1
                except Exception:
                    failed += 1
            if made:
                messages.success(request, f'Uploaded {made} frame(s) to "{cat.name}". Rename them below if you like.')
            if failed:
                messages.error(request, f'{failed} file(s) could not be read as images.')
            return redirect('admin:booth_frametemplate_changelist')
        ctx = dict(self.admin_site.each_context(request), title='Bulk upload frames',
                   categories=cats, opts=self.model._meta)
        return render(request, 'admin/booth/bulk_upload.html', ctx)


@admin.register(BusinessCampaign)
class BusinessCampaignAdmin(admin.ModelAdmin):
    list_display = ('brand_name', 'slug', 'frame_template', 'is_active', 'created')
    list_editable = ('is_active',)
    list_filter = ('is_active',)
    search_fields = ('brand_name', 'slug')
    prepopulated_fields = {'slug': ('brand_name',)}
    readonly_fields = ('campaign_link', 'qr_code', 'created', 'updated')
    fields = ('brand_name', 'slug', 'logo', 'frame_template', 'is_active',
              'campaign_link', 'qr_code', 'created', 'updated')

    def get_urls(self):
        extra = [path('<path:object_id>/qr/', self.admin_site.admin_view(self.qr_image),
                      name='booth_businesscampaign_qr')]
        return extra + super().get_urls()

    def formfield_for_foreignkey(self, db_field, request, **kwargs):
        if db_field.name == 'frame_template':
            kwargs['queryset'] = FrameTemplate.objects.filter(
                is_active=True, slots__isnull=False).distinct()
        return super().formfield_for_foreignkey(db_field, request, **kwargs)

    def _campaign_url(self, obj):
        host = f'{obj.slug}.{settings.CAMPAIGN_BASE_DOMAIN}'
        if settings.CAMPAIGN_BASE_PORT:
            host = f'{host}:{settings.CAMPAIGN_BASE_PORT}'
        return f'{"http" if settings.DEBUG else "https"}://{host}/'

    @admin.display(description='Campaign link')
    def campaign_link(self, obj):
        if not obj.pk:
            return 'Save the campaign to generate its link.'
        return format_html('<a href="{}" target="_blank" rel="noopener">{}</a>',
                           self._campaign_url(obj), self._campaign_url(obj))

    @admin.display(description='QR code')
    def qr_code(self, obj):
        if not obj.pk:
            return 'Save the campaign to generate its QR code.'
        url = reverse('admin:booth_businesscampaign_qr', args=[obj.pk])
        return format_html('<a href="{}" download="{}-qr.png"><img src="{}" alt="Campaign QR code" '
                           'style="width:180px;height:180px;display:block"></a><a href="{}" '
                           'download="{}-qr.png">Download QR code</a>',
                           url, obj.slug, url, url, obj.slug)

    def qr_image(self, request, object_id):
        campaign = get_object_or_404(BusinessCampaign, pk=object_id)
        image = qrcode.make(self._campaign_url(campaign))
        output = BytesIO()
        image.save(output, format='PNG')
        response = HttpResponse(output.getvalue(), content_type='image/png')
        response['Content-Disposition'] = f'inline; filename="{campaign.slug}-qr.png"'
        return response


@admin.register(Creation)
class CreationAdmin(admin.ModelAdmin):
    list_display = ('thumb', 'template', 'created')
    list_filter = ('template__category',)
    readonly_fields = ('thumb', 'created')
    date_hierarchy = 'created'

    @admin.display(description='Picture')
    def thumb(self, obj):
        return format_html('<img src="{}" style="height:80px">', obj.image.url) if obj.image else '-'
