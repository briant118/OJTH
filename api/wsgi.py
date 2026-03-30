"""
Vercel serverless entry for Django.

Exposes ``app`` (the name the Vercel Python runtime expects for WSGI).
"""

import os

from django.core.wsgi import get_wsgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "OJTAPP.settings")

app = get_wsgi_application()
