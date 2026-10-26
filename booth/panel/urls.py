from django.urls import path

from . import views

app_name = 'panel'

urlpatterns = [
    path('', views.dashboard, name='dashboard'),
    path('accounts/', views.accounts, name='accounts'),
    path('login/', views.login_view, name='login'),
    path('logout/', views.logout_view, name='logout'),

    path('campaigns/', views.campaigns, name='campaigns'),
    path('campaigns/new/', views.campaign_edit, name='campaign_new'),
    path('campaigns/<int:pk>/', views.campaign_edit, name='campaign_edit'),
    path('campaigns/<int:pk>/qr.png', views.campaign_qr, name='campaign_qr'),
    path('campaigns/<int:pk>/toggle/', views.campaign_toggle, name='campaign_toggle'),
    path('campaigns/<int:pk>/delete/', views.campaign_delete, name='campaign_delete'),

    path('frames/', views.frames, name='frames'),
    path('frames/designer/', views.frame_designer, name='frame_designer'),
    path('frames/designer/detect/', views.frame_designer_detect, name='frame_designer_detect'),
    path('frames/designer/save/', views.frame_designer_save, name='frame_designer_save'),
    path('frames/new/', views.frame_edit, name='frame_new'),
    path('frames/bulk/', views.frames_bulk, name='frames_bulk'),
    path('frames/action/', views.frames_action, name='frames_action'),
    path('frames/<int:pk>/', views.frame_edit, name='frame_edit'),
    path('frames/<int:pk>/delete/', views.frame_delete, name='frame_delete'),

    path('strips/', views.strip_templates, name='strip_templates'),
    path('strips/new/', views.strip_template_edit, name='strip_template_new'),
    path('strips/<int:pk>/', views.strip_template_edit, name='strip_template_edit'),
    path('strips/<int:pk>/delete/', views.strip_template_delete, name='strip_template_delete'),

    path('categories/', views.categories, name='categories'),
    path('categories/new/', views.category_edit, name='category_new'),
    path('categories/<int:pk>/', views.category_edit, name='category_edit'),
    path('categories/<int:pk>/delete/', views.category_delete, name='category_delete'),

    path('inquiries/', views.inquiries, name='inquiries'),
    path('inquiries/read-all/', views.inquiries_read_all, name='inquiries_read_all'),
    path('inquiries/<int:pk>/', views.inquiry_detail, name='inquiry_detail'),
    path('inquiries/<int:pk>/delete/', views.inquiry_delete, name='inquiry_delete'),
    path('api/notifications/', views.notifications_api, name='notifications'),
]
