"""
WSGI config for Vercel Serverless Function.

It exposes the WSGI callable as a module-level variable named ``app``.
"""

import os

from django.core.wsgi import get_wsgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "OJTAPP.settings")

app = get_wsgi_application()

