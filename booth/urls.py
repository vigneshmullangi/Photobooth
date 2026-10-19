from django.urls import path

from . import views

urlpatterns = [
    path('', views.index, name='index'),
    path('api/templates/', views.api_templates, name='api_templates'),
    path('api/creations/', views.api_creation, name='api_creation'),
    path('api/inquiries/', views.api_inquiry, name='api_inquiry'),
]
