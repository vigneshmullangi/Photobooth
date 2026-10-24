from pathlib import Path
import uuid

from django.conf import settings
from django.core.files.base import ContentFile
from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from PIL import ImageChops
from django.utils.text import slugify
from PIL import Image

from .cleaner import remove_checkerboard
from .detect import detect_windows

PCT = [MinValueValidator(0), MaxValueValidator(100)]


class Category(models.Model):
    name = models.CharField(max_length=80, unique=True)
    slug = models.SlugField(max_length=90, unique=True, blank=True)
    order = models.PositiveIntegerField(default=0, help_text='Lower numbers appear first.')
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ['order', 'name']
        verbose_name_plural = 'categories'

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        if not self.slug:
            base = slugify(self.name) or 'category'
            slug, i = base, 2
            while Category.objects.filter(slug=slug).exclude(pk=self.pk).exists():
                slug, i = f'{base}-{i}', i + 1
            self.slug = slug
        super().save(*args, **kwargs)


class FrameTemplate(models.Model):
    name = models.CharField(max_length=120, help_text='Shown to visitors. You can rename it any time.')
    category = models.ForeignKey(
        Category, null=True, blank=True, on_delete=models.PROTECT, related_name='templates',
        help_text='Leave empty for a campaign-only frame that is not listed on the public website.')
    image = models.ImageField(
        upload_to='frames/%Y/%m/',
        help_text='Transparent PNG. The see-through areas become the photo windows.')
    width = models.PositiveIntegerField(default=0, editable=False)
    height = models.PositiveIntegerField(default=0, editable=False)
    default_filter = models.CharField(max_length=20, default='Normal')
    is_active = models.BooleanField(default=True, help_text='Untick to hide it from the site.')
    order = models.PositiveIntegerField(default=0, help_text='Lower numbers appear first.')
    created = models.DateTimeField(auto_now_add=True)
    updated = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['order', '-created']
        verbose_name = 'frame'

    def __str__(self):
        return self.name

    @property
    def photo_count(self):
        return self.slots.count()

    def _read_size(self):
        f = self.image.file
        with Image.open(f) as im:
            self.width, self.height = im.size
        f.seek(0)

    def clean_checkerboard(self):
        """Make a baked-in checkerboard background really transparent. Returns True if changed."""
        cleaned = remove_checkerboard(self.image.file)
        if not cleaned:
            return False
        self.image.save(Path(self.image.name).stem + '.png', ContentFile(cleaned), save=False)
        self.width = 0  # force re-read of the size
        return True

    def save(self, *args, **kwargs):
        if self.image and not self.image._committed:
            self.clean_checkerboard()
        if self.image and (not self.width or not self.image._committed):
            self._read_size()
        super().save(*args, **kwargs)
        if not getattr(self, '_skip_detect', False) and not self.slots.exists():
            self.detect_slots()

    def detect_slots(self, force=False):
        """Create photo windows from the transparent areas of the image."""
        if force:
            self.slots.all().delete()
        if self.slots.exists() or not self.image:
            return 0
        with self.image.storage.open(self.image.name, 'rb') as f:
            found = detect_windows(f)
        FrameSlot.objects.bulk_create(
            [FrameSlot(template=self, order=i, **s) for i, s in enumerate(found)])
        return len(found)


class StripTemplate(models.Model):
    PHOTO_COUNT_CHOICES = [(2, '2 photos'), (3, '3 photos'), (4, '4 photos')]
    name = models.CharField(max_length=120)
    photo_count = models.PositiveSmallIntegerField(choices=PHOTO_COUNT_CHOICES, default=3)
    image = models.ImageField(
        upload_to='strips/%Y/%m/',
        help_text='Transparent PNG artwork. Photo windows are detected from transparency when saved.')
    canvas_width = models.PositiveIntegerField(default=0, editable=False)
    canvas_height = models.PositiveIntegerField(default=0, editable=False)
    photo_windows = models.JSONField(default=list, blank=True, editable=False)
    is_active = models.BooleanField(default=True)
    order = models.PositiveIntegerField(default=0, help_text='Lower numbers appear first.')
    created = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['order', 'name']
        verbose_name = 'strip template'
        verbose_name_plural = 'strip templates'

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        image_changed = not self.pk or bool(self.image and not self.image._committed)
        if self.image:
            # New uploads are still in Django's temporary upload storage here;
            # opening their name from MEDIA_ROOT fails because they have not
            # been persisted yet. Inspect the uploaded file directly first.
            source = self.image.file if not self.image._committed else self.image.storage.open(self.image.name, 'rb')
            try:
                source.seek(0)
                cleaned = remove_checkerboard(source)
            finally:
                if self.image._committed:
                    source.close()
                else:
                    source.seek(0)
            if cleaned:
                self.image.save(Path(self.image.name).stem + '.png', ContentFile(cleaned), save=False)
                image_changed = True
        super().save(*args, **kwargs)
        if not self.image:
            return
        with self.image.storage.open(self.image.name, 'rb') as image_file:
            with Image.open(image_file) as image:
                self.canvas_width, self.canvas_height = image.size
            image_file.seek(0)
            self.photo_windows = detect_windows(image_file, max_slots=4, fallback=False, detect_light=True)
        # If the photo openings were solid white in a JPEG, make only those
        # detected white areas transparent so the captured photos show through.
        with self.image.storage.open(self.image.name, 'rb') as image_file, Image.open(image_file) as source:
            image = source.convert('RGBA')
        alpha = image.getchannel('A')
        if alpha.getextrema() == (255, 255) and self.photo_windows:
            red, green, blue = image.convert('RGB').split()
            brightest = ImageChops.darker(ImageChops.darker(red, green), blue)
            darkest = ImageChops.lighter(ImageChops.lighter(red, green), blue)
            white = brightest.point(lambda value: 255 if value >= 225 else 0)
            even = ImageChops.subtract(darkest, brightest).point(lambda value: 255 if value <= 28 else 0)
            white = ImageChops.multiply(white, even)
            for window in self.photo_windows:
                box = (round(window['x'] * self.canvas_width / 100),
                       round(window['y'] * self.canvas_height / 100),
                       round((window['x'] + window['w']) * self.canvas_width / 100),
                       round((window['y'] + window['h']) * self.canvas_height / 100))
                current = alpha.crop(box)
                alpha.paste(ImageChops.subtract(current, white.crop(box)), box[:2])
            image.putalpha(alpha)
            output = ContentFile(b'')
            image.save(output, format='PNG', optimize=True)
            self.image.save(Path(self.image.name).stem + '.png', output, save=False)
            super().save(*args, **kwargs)
        type(self).objects.filter(pk=self.pk).update(
            canvas_width=self.canvas_width, canvas_height=self.canvas_height,
            photo_windows=self.photo_windows)
        if image_changed or not self.layout_variants.exists():
            self.build_layout_variants(reset=image_changed)

    def build_layout_variants(self, reset=False):
        defaults = {
            2: [(9.0, 3.0, 82.0, 38.78), (9.0, 44.56, 82.0, 38.78)],
            3: [(9.0, 3.0, 82.0, 25.83), (9.0, 31.06, 82.0, 25.83), (9.0, 59.11, 82.0, 25.83)],
            4: [(9.0, 3.0, 82.0, 19.22), (9.0, 24.22, 82.0, 19.22),
                (9.0, 45.44, 82.0, 19.22), (9.0, 66.67, 82.0, 19.22)],
        }
        for count in (2, 3, 4):
            variant, _ = StripLayoutVariant.objects.get_or_create(template=self, photo_count=count)
            if variant.windows.exists() and not reset:
                continue
            variant.windows.all().delete()
            if count == len(self.photo_windows):
                source = [(w['x'], w['y'], w['w'], w['h']) for w in self.photo_windows]
            else:
                source = defaults[count]
            StripPhotoWindow.objects.bulk_create([
                StripPhotoWindow(variant=variant, order=i, x=x, y=y, w=w, h=h)
                for i, (x, y, w, h) in enumerate(source)
            ])


class StripStudioField(models.Model):
    TYPE_CHOICES = [('text', 'Text'), ('date', 'Date'), ('upload', 'Image upload')]
    FONT_CHOICES = [
        ('script', 'Script'), ('serif', 'Elegant serif'), ('bold', 'Bold sans'),
        ('modern', 'Modern sans'), ('display', 'Display (heavy)'), ('mono', 'Monospace'),
        ('rounded', 'Rounded'), ('arial', 'Arial'), ('verdana', 'Verdana'),
        ('trebuchet', 'Trebuchet MS'), ('georgia', 'Georgia'), ('times', 'Times New Roman'),
        ('courier', 'Courier New'), ('impact', 'Impact'), ('inter', 'Inter'),
        ('fraunces', 'Fraunces'), ('playfair', 'Playfair Display'), ('montserrat', 'Montserrat'),
        ('bebas', 'Bebas Neue'),
    ]
    ALIGN_CHOICES = [('center', 'Center'), ('left', 'Left'), ('right', 'Right')]
    EFFECT_CHOICES = [('none', 'None'), ('shadow', 'Soft shadow'), ('outline', 'Outline')]

    template = models.ForeignKey(StripTemplate, on_delete=models.CASCADE, related_name='studio_fields')
    order = models.PositiveIntegerField(default=0)
    label = models.CharField(max_length=60)
    data_type = models.CharField(max_length=10, choices=TYPE_CHOICES, default='text')
    default_text = models.CharField(max_length=80, blank=True)
    default_image = models.ImageField(upload_to='strip_fields/', blank=True)
    max_length = models.PositiveIntegerField(default=30)
    x = models.FloatField('left %', default=10, validators=PCT)
    y = models.FloatField('top %', default=5, validators=PCT)
    w = models.FloatField('width %', default=80, validators=PCT)
    h = models.FloatField('height %', default=8, validators=PCT)
    font = models.CharField(max_length=20, choices=FONT_CHOICES, default='script')
    font_size = models.FloatField(default=1, validators=[MinValueValidator(.25), MaxValueValidator(5)])
    bold = models.BooleanField(default=False)
    italic = models.BooleanField(default=False)
    underline = models.BooleanField(default=False)
    effect = models.CharField(max_length=8, choices=EFFECT_CHOICES, default='none')
    color = models.CharField(max_length=7, default='#b8893b')
    align = models.CharField(max_length=6, choices=ALIGN_CHOICES, default='center')
    uppercase = models.BooleanField(default=False)

    class Meta:
        ordering = ['order', 'id']

    def __str__(self):
        return f'{self.template} · {self.label}'


class StripLayoutVariant(models.Model):
    template = models.ForeignKey(StripTemplate, on_delete=models.CASCADE, related_name='layout_variants')
    photo_count = models.PositiveSmallIntegerField(choices=StripTemplate.PHOTO_COUNT_CHOICES)
    image = models.ImageField(upload_to='strips/layouts/%Y/%m/', blank=True)
    canvas_width = models.PositiveIntegerField(default=0, editable=False)
    canvas_height = models.PositiveIntegerField(default=0, editable=False)

    class Meta:
        ordering = ['photo_count']
        constraints = [models.UniqueConstraint(fields=('template', 'photo_count'), name='uniq_strip_template_photo_count')]

    def __str__(self):
        return f'{self.template} · {self.photo_count} photos'


class StripPhotoWindow(models.Model):
    variant = models.ForeignKey(StripLayoutVariant, on_delete=models.CASCADE, related_name='windows')
    order = models.PositiveIntegerField(default=0)
    x = models.FloatField('left %', default=9, validators=PCT)
    y = models.FloatField('top %', default=3, validators=PCT)
    w = models.FloatField('width %', default=82, validators=PCT)
    h = models.FloatField('height %', default=20, validators=PCT)

    class Meta:
        ordering = ['order', 'id']

    def __str__(self):
        return f'{self.variant} · photo {self.order + 1}'


class FrameTextField(models.Model):
    """An editable text area on a frame (names, year, date...). Values are percentages of the frame image."""
    TYPE_CHOICES = [('text', 'Text'), ('date', 'Date'), ('upload', 'Image upload')]
    FONT_CHOICES = [
        ('script', 'Script'), ('serif', 'Elegant serif'), ('bold', 'Bold sans'),
        ('modern', 'Modern sans'), ('display', 'Display (heavy)'), ('mono', 'Monospace'),
        ('rounded', 'Rounded'), ('arial', 'Arial'), ('verdana', 'Verdana'),
        ('trebuchet', 'Trebuchet MS'), ('georgia', 'Georgia'), ('times', 'Times New Roman'),
        ('courier', 'Courier New'), ('impact', 'Impact'), ('inter', 'Inter'),
        ('fraunces', 'Fraunces'), ('playfair', 'Playfair Display'),
        ('montserrat', 'Montserrat'), ('bebas', 'Bebas Neue'),
    ]
    ALIGN_CHOICES = [('center', 'Center'), ('left', 'Left'), ('right', 'Right')]
    EFFECT_CHOICES = [('none', 'None'), ('shadow', 'Soft shadow'), ('outline', 'Outline')]

    template = models.ForeignKey(FrameTemplate, on_delete=models.CASCADE, related_name='text_fields')
    order = models.PositiveIntegerField(default=0)
    label = models.CharField(max_length=60, help_text='Shown to the visitor, e.g. "Names" or "Year".')
    data_type = models.CharField(max_length=10, choices=TYPE_CHOICES, default='text')
    default_text = models.CharField(max_length=80, blank=True, help_text='Pre-filled text, e.g. "Jon weds Mary" or "2026".')
    default_image = models.ImageField(upload_to='frame_fields/', blank=True,
                                     help_text='Optional image shown by default in Studio; guests can replace it.')
    max_length = models.PositiveIntegerField(default=30)
    x = models.FloatField('left %', default=10, validators=PCT)
    y = models.FloatField('top %', default=5, validators=PCT)
    w = models.FloatField('width %', default=80, validators=PCT)
    h = models.FloatField('height %', default=8, validators=PCT)
    font = models.CharField(max_length=20, choices=FONT_CHOICES, default='script')
    font_size = models.FloatField(
        default=1,
        validators=[MinValueValidator(.25), MaxValueValidator(5)],
        help_text='Relative to the frame text box (1 = default).',
    )
    bold = models.BooleanField(default=False)
    italic = models.BooleanField(default=False)
    underline = models.BooleanField(default=False)
    effect = models.CharField(max_length=8, choices=EFFECT_CHOICES, default='none')
    color = models.CharField(max_length=7, default='#b8893b', help_text='Hex colour, e.g. #b8893b')
    align = models.CharField(max_length=6, choices=ALIGN_CHOICES, default='center')
    uppercase = models.BooleanField(default=False)

    class Meta:
        ordering = ['order', 'id']
        verbose_name = 'editable text'

    def __str__(self):
        return f'{self.template} \u00b7 {self.label}'


class BusinessCampaign(models.Model):
    brand_name = models.CharField(max_length=120)
    slug = models.SlugField(max_length=90, unique=True, help_text='Used for the campaign subdomain.')
    logo = models.ImageField(upload_to='campaigns/logos/%Y/%m/')
    frame_template = models.ForeignKey(
        FrameTemplate, on_delete=models.PROTECT, related_name='campaigns',
        help_text='Use the finished, branded frame prepared for this campaign.')
    is_active = models.BooleanField(default=True)
    created = models.DateTimeField(auto_now_add=True)
    updated = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['brand_name']

    def __str__(self):
        return self.brand_name

    @property
    def public_url(self):
        """The branded capture link guests open (and the QR code points to)."""
        from django.conf import settings
        host = f'{self.slug}.{settings.CAMPAIGN_BASE_DOMAIN}'
        if settings.CAMPAIGN_BASE_PORT:
            host = f'{host}:{settings.CAMPAIGN_BASE_PORT}'
        return f'{"http" if settings.DEBUG else "https"}://{host}/'

    def clean(self):
        if self.frame_template_id:
            if not self.frame_template.is_active and self.is_active:
                raise ValidationError({'frame_template': 'Activate the frame before using it in an active campaign.'})
            if not self.frame_template.slots.exists():
                raise ValidationError({'frame_template': 'Select a frame with at least one photo window.'})


class FrameSlot(models.Model):
    """One photo window. Values are percentages of the frame image."""
    SHAPE_CHOICES = [('square', 'Square'), ('circle', 'Circle'), ('diamond', 'Diamond'), ('heart', 'Heart')]
    template = models.ForeignKey(FrameTemplate, on_delete=models.CASCADE, related_name='slots')
    order = models.PositiveIntegerField(default=0, help_text='Photo number (0 = first).')
    x = models.FloatField('left %', validators=PCT)
    y = models.FloatField('top %', validators=PCT)
    w = models.FloatField('width %', validators=PCT)
    h = models.FloatField('height %', validators=PCT)
    shape = models.CharField(max_length=12, choices=SHAPE_CHOICES, default='square')

    class Meta:
        ordering = ['order', 'id']
        verbose_name = 'photo window'

    def __str__(self):
        return f'{self.template} · photo {self.order + 1}'


class Creation(models.Model):
    """Finished pictures visitors chose to save to the gallery."""
    template = models.ForeignKey(FrameTemplate, null=True, blank=True, on_delete=models.SET_NULL,
                                 related_name='creations')
    image = models.ImageField(upload_to='creations/%Y/%m/')
    created = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created']

    def __str__(self):
        return f'Creation #{self.pk}'


class SiteMetric(models.Model):
    PHOTOS_CAPTURED = 'photos_captured'
    DOWNLOADS = 'downloads'
    METRIC_CHOICES = [
        (PHOTOS_CAPTURED, 'Photos captured'),
        (DOWNLOADS, 'Downloads'),
    ]

    key = models.CharField(max_length=32, choices=METRIC_CHOICES, unique=True)
    count = models.PositiveBigIntegerField(default=0)

    def __str__(self):
        return f'{self.get_key_display()}: {self.count}'


class SiteVisitor(models.Model):
    visitor_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    first_seen = models.DateTimeField(auto_now_add=True)
    last_seen = models.DateTimeField()

    class Meta:
        indexes = [models.Index(fields=['last_seen'])]


class GuestAccountProfile(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='booth_profile')
    organization_name = models.CharField(max_length=160, blank=True, default='')

    def __str__(self):
        return self.organization_name or self.user.get_username()


class Inquiry(models.Model):
    """A message sent through the contact form on the public site."""
    NEW, CONTACTED, CLOSED = 'new', 'contacted', 'closed'
    STATUS_CHOICES = [(NEW, 'New'), (CONTACTED, 'Contacted'), (CLOSED, 'Closed')]

    name = models.CharField(max_length=120)
    email = models.EmailField()
    phone = models.CharField(max_length=30, blank=True)
    interest = models.CharField(max_length=80, blank=True)
    event_date = models.DateField(null=True, blank=True)
    message = models.TextField()
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default=NEW)
    is_read = models.BooleanField(default=False)
    created = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created']
        verbose_name_plural = 'inquiries'

    def __str__(self):
        return f'{self.name} - {self.interest or "Inquiry"}'
