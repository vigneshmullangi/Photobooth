import re

from django import forms
from django.contrib.auth.forms import AuthenticationForm
from django.forms import inlineformset_factory

from ..models import BusinessCampaign, Category, FrameSlot, FrameTemplate, FrameTextField, StripLayoutVariant, StripPhotoWindow, StripStudioField, StripTemplate

HOST_LABEL = re.compile(r'^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$')


class StaffAuthenticationForm(AuthenticationForm):
    """Only staff accounts may sign in to the panel."""
    error_messages = {
        **AuthenticationForm.error_messages,
        'invalid_login': 'The username or password is incorrect.',
        'not_staff': 'This account does not have access to the admin panel.',
    }

    def confirm_login_allowed(self, user):
        super().confirm_login_allowed(user)
        if not user.is_staff:
            raise forms.ValidationError(self.error_messages['not_staff'], code='not_staff')


class CategoryForm(forms.ModelForm):
    class Meta:
        model = Category
        fields = ('name', 'order', 'is_active')


class StripTemplateForm(forms.ModelForm):
    class Meta:
        model = StripTemplate
        fields = ('name', 'image', 'order', 'is_active')

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if self.instance.pk:
            self.fields['image'].required = False


class StripStudioFieldForm(forms.ModelForm):
    font_size = forms.TypedChoiceField(
        choices=[(str(size / 24), f'{size} pt') for size in
                 (8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72, 96, 120)],
        coerce=float,
        label='Font size',
    )

    class Meta:
        model = StripStudioField
        fields = ('order', 'label', 'data_type', 'default_text', 'default_image', 'max_length',
                  'x', 'y', 'w', 'h', 'font', 'font_size', 'bold', 'italic', 'underline',
                  'effect', 'color', 'align', 'uppercase')
        widgets = {'x': forms.HiddenInput, 'y': forms.HiddenInput,
                   'w': forms.HiddenInput, 'h': forms.HiddenInput}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if self.instance.pk:
            self.fields['default_image'].required = False


StripStudioFieldFormSet = inlineformset_factory(
    StripTemplate, StripStudioField, form=StripStudioFieldForm, extra=0, can_delete=True)


class StripPhotoWindowForm(forms.ModelForm):
    class Meta:
        model = StripPhotoWindow
        fields = ('order', 'x', 'y', 'w', 'h')


StripPhotoWindowFormSet = inlineformset_factory(
    StripLayoutVariant, StripPhotoWindow, form=StripPhotoWindowForm, extra=0, can_delete=False)


class CampaignForm(forms.ModelForm):
    class Meta:
        model = BusinessCampaign
        fields = ('brand_name', 'slug', 'logo', 'frame_template', 'is_active')

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        usable = FrameTemplate.objects.filter(is_active=True, slots__isnull=False)
        if self.instance.pk:
            usable = FrameTemplate.objects.filter(pk=self.instance.frame_template_id) | usable
        self.fields['frame_template'].queryset = usable.select_related('category').distinct().order_by('name')
        self.fields['frame_template'].empty_label = 'Choose a frame'
        self.fields['frame_template'].label_from_instance = lambda f: (
            f'{f.name}  ({f.category.name if f.category_id else "Campaign-only"})')

    def clean_slug(self):
        slug = self.cleaned_data['slug'].lower()
        if not HOST_LABEL.match(slug):
            raise forms.ValidationError(
                'Use only lowercase letters, numbers and hyphens (no spaces or underscores), '
                'and do not start or end with a hyphen. Maximum 63 characters.')
        return slug


class FrameForm(forms.ModelForm):
    class Meta:
        model = FrameTemplate
        fields = ('name', 'category', 'image', 'is_active', 'order')

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields['category'].queryset = Category.objects.all()
        self.fields['category'].required = False
        self.fields['category'].empty_label = 'Campaign-only (not listed on website)'
        if self.instance.pk:
            self.fields['image'].required = False


SlotFormSet = inlineformset_factory(
    FrameTemplate, FrameSlot, fields=('order', 'x', 'y', 'w', 'h', 'shape'), extra=0, can_delete=True)


TextFieldFormSet = inlineformset_factory(
    FrameTemplate, FrameTextField,
    fields=('order', 'label', 'data_type', 'default_text', 'default_image', 'max_length', 'x', 'y', 'w', 'h', 'font', 'color', 'align', 'uppercase'),
    widgets={'x': forms.HiddenInput, 'y': forms.HiddenInput,
             'w': forms.HiddenInput, 'h': forms.HiddenInput},
    extra=0, can_delete=True)
