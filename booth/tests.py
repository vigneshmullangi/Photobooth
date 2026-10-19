from io import BytesIO

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.urls import reverse
from PIL import Image

from .models import BusinessCampaign, Category, FrameSlot, FrameTemplate, FrameTextField, Inquiry


def png_upload(name, color):
    image = Image.new('RGBA', (120, 160), color)
    output = BytesIO()
    image.save(output, format='PNG')
    return SimpleUploadedFile(name, output.getvalue(), content_type='image/png')


class BusinessCampaignTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        category = Category.objects.create(name='Campaigns')
        template = FrameTemplate(
            name='Branded campaign frame',
            category=category,
            image=png_upload('frame.png', (255, 255, 255, 255)),
        )
        template.save()
        FrameSlot.objects.create(template=template, order=0, x=10, y=10, w=80, h=80)
        cls.campaign = BusinessCampaign.objects.create(
            brand_name='Example Brand',
            slug='example-brand',
            logo=png_upload('logo.png', (228, 73, 43, 255)),
            frame_template=template,
        )

    def test_campaign_subdomain_opens_branded_capture_configuration(self):
        response = self.client.get('/', HTTP_HOST='example-brand.localhost:8000')

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'Example Brand')
        self.assertContains(response, 'campaign-mode')
        self.assertContains(response, 'brandName')
        self.assertContains(response, 'Branded campaign frame')

    def test_campaign_template_api_only_returns_assigned_frame(self):
        response = self.client.get('/api/templates/', HTTP_HOST='example-brand.localhost:8000')

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data['categories'], [])
        self.assertEqual(data['campaign']['name'], 'Branded campaign frame')

    def test_each_campaign_subdomain_serves_only_its_own_frame(self):
        other_template = FrameTemplate(
            name='Second Brand Frame',
            category=self.campaign.frame_template.category,
            image=png_upload('second-frame.png', (0, 0, 0, 255)),
        )
        other_template.save()
        FrameSlot.objects.create(template=other_template, order=0, x=5, y=5, w=90, h=90)
        BusinessCampaign.objects.create(
            brand_name='Second Brand',
            slug='second-brand',
            logo=png_upload('second-logo.png', (0, 120, 50, 255)),
            frame_template=other_template,
        )

        first = self.client.get('/api/templates/', HTTP_HOST='example-brand.localhost:8000').json()
        second = self.client.get('/api/templates/', HTTP_HOST='second-brand.localhost:8000').json()

        self.assertEqual(first['campaign']['name'], 'Branded campaign frame')
        self.assertEqual(second['campaign']['name'], 'Second Brand Frame')

    def test_unknown_campaign_subdomain_returns_not_found(self):
        response = self.client.get('/', HTTP_HOST='unknown.localhost:8000')

        self.assertEqual(response.status_code, 404)

    def test_admin_campaign_qr_code_is_a_png(self):
        user = get_user_model().objects.create_superuser(
            username='campaign-admin',
            email='admin@example.com',
            password='test-password',
        )
        self.client.force_login(user)

        response = self.client.get(
            reverse('admin:booth_businesscampaign_qr', args=[self.campaign.pk]),
            HTTP_HOST='localhost:8000',
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Content-Type'], 'image/png')
        with Image.open(BytesIO(response.content)) as image:
            self.assertEqual(image.format, 'PNG')


class PanelTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        category = Category.objects.create(name='Campaigns')
        cls.template = FrameTemplate(name='Panel frame', category=category,
                                     image=png_upload('panel.png', (255, 255, 255, 255)))
        cls.template.save()
        FrameSlot.objects.create(template=cls.template, order=0, x=10, y=10, w=80, h=80)
        cls.campaign = BusinessCampaign.objects.create(
            brand_name='Panel Brand', slug='panel-brand',
            logo=png_upload('panel-logo.png', (10, 10, 10, 255)), frame_template=cls.template)
        User = get_user_model()
        cls.staff = User.objects.create_user('staff', password='pw-12345', is_staff=True)
        cls.visitor = User.objects.create_user('visitor', password='pw-12345')

    def test_panel_requires_staff_login(self):
        response = self.client.get(reverse('panel:dashboard'))
        self.assertEqual(response.status_code, 302)
        self.assertIn(reverse('panel:login'), response['Location'])
        self.client.force_login(self.visitor)
        self.assertEqual(self.client.get(reverse('panel:campaigns')).status_code, 302)

    def test_non_staff_cannot_sign_in(self):
        response = self.client.post(reverse('panel:login'), {'username': 'visitor', 'password': 'pw-12345'})
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'does not have access')

    def test_staff_pages_render(self):
        self.client.force_login(self.staff)
        Inquiry.objects.create(name='Asha', email='asha@example.com', message='Hello there')
        for name, args in [('dashboard', []), ('campaigns', []), ('campaign_new', []),
                           ('campaign_edit', [self.campaign.pk]), ('frames', []), ('frame_new', []),
                           ('frames_bulk', []), ('frame_edit', [self.template.pk]), ('categories', []),
                           ('category_new', []), ('creations', []), ('inquiries', [])]:
            response = self.client.get(reverse(f'panel:{name}', args=args))
            self.assertEqual(response.status_code, 200, name)

    def test_bulk_upload_without_category_creates_campaign_only_frame(self):
        self.client.force_login(self.staff)
        response = self.client.post(reverse('panel:frames_bulk'), {
            'images': png_upload('campaign-only.png', (255, 255, 255, 255)),
        })

        self.assertRedirects(response, reverse('panel:frames'))
        frame = FrameTemplate.objects.get(name='Campaign Only')
        self.assertIsNone(frame.category)
        self.assertTrue(frame.is_active)
        FrameSlot.objects.create(template=frame, order=0, x=10, y=10, w=80, h=80)
        self.assertContains(self.client.get(reverse('panel:frames')), 'Campaign-only')
        self.assertContains(self.client.get(reverse('panel:campaign_new')), 'Campaign Only')
        self.assertNotContains(self.client.get('/api/templates/'), 'Campaign Only')
        BusinessCampaign.objects.create(
            brand_name='Campaign Only Brand',
            slug='campaign-only-brand',
            logo=png_upload('campaign-only-logo.png', (10, 10, 10, 255)),
            frame_template=frame,
        )
        campaign_templates = self.client.get(
            '/api/templates/', HTTP_HOST='campaign-only-brand.localhost:8000').json()
        self.assertEqual(campaign_templates['campaign']['name'], 'Campaign Only')

    def test_campaign_qr_downloads_as_png(self):
        self.client.force_login(self.staff)
        response = self.client.get(reverse('panel:campaign_qr', args=[self.campaign.pk]) + '?download=1')
        self.assertEqual(response['Content-Type'], 'image/png')
        self.assertIn('panel-brand-qr.png', response['Content-Disposition'])
        self.assertIn('attachment', response['Content-Disposition'])
        with Image.open(BytesIO(response.content)) as image:
            self.assertEqual(image.format, 'PNG')

    def test_campaign_slug_must_be_a_valid_hostname(self):
        self.client.force_login(self.staff)
        response = self.client.post(reverse('panel:campaign_new'), {
            'brand_name': 'Bad Slug', 'slug': 'bad_slug', 'frame_template': self.template.pk, 'is_active': 'on',
            'logo': png_upload('l.png', (1, 2, 3, 255))})
        self.assertEqual(response.status_code, 200)
        self.assertFalse(BusinessCampaign.objects.filter(brand_name='Bad Slug').exists())

    def test_campaign_can_be_created(self):
        self.client.force_login(self.staff)
        response = self.client.post(reverse('panel:campaign_new'), {
            'brand_name': 'Fresh Brand', 'slug': 'fresh-brand', 'frame_template': self.template.pk,
            'is_active': 'on', 'logo': png_upload('l.png', (1, 2, 3, 255))})
        self.assertEqual(response.status_code, 302)
        self.assertTrue(BusinessCampaign.objects.filter(slug='fresh-brand').exists())


class InquiryTests(TestCase):
    def setUp(self):
        from django.core.cache import cache
        cache.clear()
        self.staff = get_user_model().objects.create_user('staff', password='pw-12345', is_staff=True)
        self.payload = {'name': 'Ravi Kumar', 'email': 'ravi@example.com', 'phone': '+91 98765 43210',
                        'interest': 'Wedding or birthday', 'event_date': '2026-12-20', 'message': 'Need a booth.'}

    def test_public_form_saves_inquiry(self):
        response = self.client.post(reverse('api_inquiry'), self.payload)
        self.assertEqual(response.status_code, 200)
        inquiry = Inquiry.objects.get()
        self.assertEqual(inquiry.name, 'Ravi Kumar')
        self.assertFalse(inquiry.is_read)

    def test_public_form_validates(self):
        response = self.client.post(reverse('api_inquiry'), {**self.payload, 'email': 'nope', 'message': ''})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(Inquiry.objects.count(), 0)

    def test_honeypot_is_ignored_silently(self):
        response = self.client.post(reverse('api_inquiry'), {**self.payload, 'website': 'http://spam'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(Inquiry.objects.count(), 0)

    def test_rate_limit(self):
        for _ in range(5):
            self.client.post(reverse('api_inquiry'), self.payload)
        self.assertEqual(self.client.post(reverse('api_inquiry'), self.payload).status_code, 429)

    def test_notifications_and_read_state(self):
        Inquiry.objects.create(name='Asha', email='a@example.com', message='Hi')
        self.client.force_login(self.staff)
        data = self.client.get(reverse('panel:notifications')).json()
        self.assertEqual(data['unread'], 1)
        pk = data['items'][0]['id']
        self.assertEqual(self.client.get(reverse('panel:inquiry_detail', args=[pk])).status_code, 200)
        self.assertEqual(self.client.get(reverse('panel:notifications')).json()['unread'], 0)

    def test_notifications_need_login(self):
        self.assertEqual(self.client.get(reverse('panel:notifications')).status_code, 401)

    def test_legacy_admin_link_redirects_to_panel(self):
        response = self.client.get('/admin/booth/businesscampaign/')
        self.assertRedirects(response, reverse('panel:campaigns'), fetch_redirect_response=False)

class EditableTextTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        category = Category.objects.create(name='Wedding')
        cls.template = FrameTemplate(name='Floral wedding', category=category,
                                     image=png_upload('floral.png', (255, 255, 255, 255)))
        cls.template.save()
        FrameSlot.objects.create(template=cls.template, order=0, x=10, y=20, w=80, h=60)
        FrameTextField.objects.create(template=cls.template, order=0, label='Names', default_text='Jon weds Mary',
                                      x=10, y=4, w=80, h=10, font='script', color='#b8893b')
        FrameTextField.objects.create(template=cls.template, order=1, label='Date', default_text='22.05.24',
                                      x=20, y=90, w=60, h=5, font='serif', uppercase=True)
        cls.staff = get_user_model().objects.create_user('staff2', password='pw-12345', is_staff=True)

    def test_api_returns_editable_text_fields(self):
        data = self.client.get('/api/templates/').json()
        texts = data['categories'][0]['templates'][0]['texts']
        self.assertEqual([t['label'] for t in texts], ['Names', 'Date'])
        self.assertEqual(texts[0]['text'], 'Jon weds Mary')
        self.assertAlmostEqual(texts[0]['y'], 0.04)
        self.assertTrue(texts[1]['upper'])

    def test_frame_without_text_fields_still_works(self):
        FrameTextField.objects.all().delete()
        data = self.client.get('/api/templates/').json()
        self.assertEqual(data['categories'][0]['templates'][0]['texts'], [])

    def test_panel_frame_form_shows_text_editor(self):
        self.client.force_login(self.staff)
        response = self.client.get(reverse('panel:frame_edit', args=[self.template.pk]))
        self.assertContains(response, 'Editable text')
        self.assertContains(response, 'Jon weds Mary')

    def test_public_frame_customizer_is_available(self):
        response = self.client.get('/')
        self.assertContains(response, 'Editable frame text')
        self.assertContains(response, 'customizePreview')
        self.assertContains(response, 'customizeUseFrame')

    def test_duplicate_copies_text_fields(self):
        self.client.force_login(self.staff)
        self.client.post(reverse('panel:frames_action'), {'action': 'duplicate', 'ids': [self.template.pk]})
        copy = FrameTemplate.objects.exclude(pk=self.template.pk).get()
        self.assertEqual(copy.text_fields.count(), 2)
