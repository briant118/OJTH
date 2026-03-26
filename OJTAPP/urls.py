from django.contrib import admin
from django.http import JsonResponse
from django.urls import path, include, re_path


def _chrome_devtools_appspecific(request):
    """
    Chrome/DevTools sometimes requests this path for app-specific metadata.
    Return a harmless payload so it doesn't generate 404 spam.
    """
    return JsonResponse({}, status=200)


urlpatterns = [
    re_path(
        r"^\.well-known/appspecific/com\.chrome\.devtools\.json$",
        _chrome_devtools_appspecific,
    ),
    path('admin/', admin.site.urls),
    path('', include('CalculateHours.urls')),
]
