"""Django settings. Database defaults are set up for XAMPP MySQL/MariaDB."""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def env(name, default=''):
    return os.environ.get(name, default)


SECRET_KEY = env('DJANGO_SECRET_KEY', 'dev-only-change-this-before-going-live')
DEBUG = env('DJANGO_DEBUG', '1') == '1'
ALLOWED_HOSTS = [h.strip() for h in env('DJANGO_ALLOWED_HOSTS', 'localhost,127.0.0.1').split(',') if h.strip()]
CAMPAIGN_BASE_DOMAIN = env('CAMPAIGN_BASE_DOMAIN', 'localhost').strip('.').lower()
CAMPAIGN_BASE_PORT = env('CAMPAIGN_BASE_PORT', '8000' if DEBUG else '')
if CAMPAIGN_BASE_DOMAIN:
    ALLOWED_HOSTS.extend([CAMPAIGN_BASE_DOMAIN, f'.{CAMPAIGN_BASE_DOMAIN}'])

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'booth',
]

LOGIN_URL = 'panel:login'
LOGIN_REDIRECT_URL = 'panel:dashboard'

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'photobooth_project.urls'

TEMPLATES = [{
    'BACKEND': 'django.template.backends.django.DjangoTemplates',
    'DIRS': [],
    'APP_DIRS': True,
    'OPTIONS': {'context_processors': [
        'django.template.context_processors.debug',
        'django.template.context_processors.request',
        'django.contrib.auth.context_processors.auth',
        'django.contrib.messages.context_processors.messages',
        'booth.panel.context.notifications',
    ]},
}]

WSGI_APPLICATION = 'photobooth_project.wsgi.application'

# ---- Database: XAMPP MySQL / MariaDB (phpMyAdmin: create DB "photobooth") ----
if env('DB') == 'sqlite':  # only used for quick local testing
    DATABASES = {'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': BASE_DIR / 'db.sqlite3'}}
else:
    DATABASES = {'default': {
        'ENGINE': 'django.db.backends.mysql',
        'NAME': env('DB_NAME', 'photobooth'),
        'USER': env('DB_USER', 'root'),
        'PASSWORD': env('DB_PASSWORD', ''),       # XAMPP default: empty
        'HOST': env('DB_HOST', '127.0.0.1'),
        'PORT': env('DB_PORT', '3307'),
        'OPTIONS': {'charset': 'utf8mb4'},
    }}

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'Asia/Kolkata'
USE_I18N = True
USE_TZ = True

STATIC_URL = 'static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'

# Uploaded frame images live on disk here; MySQL stores only their paths.
MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'

DATA_UPLOAD_MAX_MEMORY_SIZE = 30 * 1024 * 1024
FILE_UPLOAD_MAX_MEMORY_SIZE = 10 * 1024 * 1024
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
