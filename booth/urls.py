from django.urls import path

from . import views

urlpatterns = [
    path('', views.index, name='index'),
    path('account/', views.google_auth_prompt, name='account_access'),
    path('auth/google/', views.google_auth_prompt, name='google_auth_prompt'),
    path('auth/google/start/', views.google_auth_start, name='google_auth_start'),
    path('auth/google/callback/', views.google_auth_callback, name='google_auth_callback'),
    path('api/csrf-token/', views.api_csrf_token, name='api_csrf_token'),
    path('api/templates/', views.api_templates, name='api_templates'),
    path('api/shared-frames/', views.api_save_shared_frame, name='api_save_shared_frame'),
    path('api/shared-frames/<int:pk>/campaign/', views.api_ensure_shared_frame_campaign, name='api_ensure_shared_frame_campaign'),
    path('api/shared-frames/<int:pk>/qr.png', views.api_shared_frame_qr, name='api_shared_frame_qr'),
    path('api/detect-uploaded-template/', views.api_detect_uploaded_template, name='api_detect_uploaded_template'),
    path('api/creations/', views.api_creation, name='api_creation'),
    path('api/inquiries/', views.api_inquiry, name='api_inquiry'),
    path('api/site-stats/', views.api_site_stats, name='api_site_stats'),
    path('api/site-metrics/', views.api_site_metric, name='api_site_metric'),
]
