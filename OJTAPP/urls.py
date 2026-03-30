from pathlib import Path

from django.conf import settings
from django.contrib import admin
from django.http import HttpResponse, JsonResponse
from django.urls import path, include, re_path


def _chrome_devtools_appspecific(request):
    """
    Chrome/DevTools sometimes requests this path for app-specific metadata.
    Return a harmless payload so it doesn't generate 404 spam.
    """
    return JsonResponse({}, status=200)


def web_manifest(request):
    path = Path(settings.BASE_DIR) / "static" / "manifest.webmanifest"
    body = path.read_text(encoding="utf-8")
    return HttpResponse(body, content_type="application/manifest+json; charset=utf-8")


def service_worker(request):
    """
    Serve the service worker at /sw.js so its scope is the whole site (/),
    not only /static/ (required for a useful PWA).
    """
    path = Path(settings.BASE_DIR) / "static" / "sw.js"
    body = path.read_text(encoding="utf-8")
    resp = HttpResponse(body, content_type="application/javascript; charset=utf-8")
    resp["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return resp


urlpatterns = [
    re_path(
        r"^\.well-known/appspecific/com\.chrome\.devtools\.json$",
        _chrome_devtools_appspecific,
    ),
    path("manifest.webmanifest", web_manifest, name="pwa_manifest"),
    path("sw.js", service_worker),
    path('admin/', admin.site.urls),
    path('', include('CalculateHours.urls')),
]
