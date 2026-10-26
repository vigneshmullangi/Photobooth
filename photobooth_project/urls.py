from django.conf import settings
from django.contrib import admin
from django.urls import include, path, re_path
from django.views.generic.base import RedirectView
from django.views.static import serve

admin.site.site_header = 'Photobooth (technical admin)'
admin.site.site_title = 'Photobooth'
admin.site.index_title = 'Technical administration'

# Old Django-admin links (for example /admin/booth/businesscampaign/) now open the new panel.
LEGACY = {
    'booth/businesscampaign': 'panel:campaigns',
    'booth/frametemplate': 'panel:frames',
    'booth/category': 'panel:categories',
    'booth/creation': 'panel:creations',
}
legacy_redirects = [
    path(f'admin/{old}/', RedirectView.as_view(pattern_name=new, query_string=False))
    for old, new in LEGACY.items()
]

urlpatterns = [
    path('favicon.ico', RedirectView.as_view(url='/static/booth/favicon.svg', permanent=True)),
    *legacy_redirects,
    re_path(r'^admin/?$', RedirectView.as_view(pattern_name='panel:dashboard')),
    path('panel/', include('booth.panel.urls')),
    path('django-admin/', admin.site.urls),
    # Serve media in both local and production
    re_path(r'^media/(?P<path>.*)$', serve, {'document_root': settings.MEDIA_ROOT}),
    path('', include('booth.urls')),
]