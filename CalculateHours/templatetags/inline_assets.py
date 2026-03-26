from __future__ import annotations

import base64
from pathlib import Path
from functools import lru_cache

from django import template
from django.contrib.staticfiles import finders
from django.conf import settings as dj_settings
from django.utils.safestring import mark_safe


register = template.Library()


_MIME_BY_EXT = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
}


@lru_cache(maxsize=32)
def _read_text_from_static(static_path: str) -> str:
    """
    Read a static asset by its *static path* (e.g. `css/ojt.css`).
    Uses Django's staticfiles finders so it works in both dev and Vercel.
    """
    file_path = finders.find(static_path)
    if file_path:
        return Path(file_path).read_text(encoding="utf-8")

    # Fallback: read directly from repo `static/` folder.
    # This is useful when Django's staticfiles finders aren't configured
    # the same way across build/runtime environments.
    static_fs_path = Path(getattr(dj_settings, "BASE_DIR", Path.cwd())) / "static" / static_path
    try:
        return static_fs_path.read_text(encoding="utf-8")
    except Exception:
        # Fail-safe: avoid 500s if an asset can't be found.
        return f"/* Missing static asset: {static_path} */"


@lru_cache(maxsize=32)
def _read_bytes_from_static(static_path: str) -> bytes:
    file_path = finders.find(static_path)
    if file_path:
        return Path(file_path).read_bytes()

    static_fs_path = Path(getattr(dj_settings, "BASE_DIR", Path.cwd())) / "static" / static_path
    try:
        return static_fs_path.read_bytes()
    except Exception:
        # Fail-safe: return empty bytes so we can still render a valid data URL.
        return b""


@register.simple_tag
def inline_css(static_path: str) -> str:
    css_text = _read_text_from_static(static_path)
    # Inline as raw CSS (no escaping) because it will be wrapped in <style> tags.
    return mark_safe(css_text)


@register.simple_tag
def inline_js(static_path: str) -> str:
    js_text = _read_text_from_static(static_path)
    # Inline as raw JS (no escaping) because it will be wrapped in <script> tags.
    return mark_safe(js_text)


@register.simple_tag
def inline_image_data_url(static_path: str) -> str:
    data = _read_bytes_from_static(static_path)
    if not data:
        # Transparent 1x1 PNG (keeps CSS `url('...')` and <img> valid).
        return mark_safe(
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+XJ6kAAAAASUVORK5CYII="
        )
    ext = Path(static_path).suffix.lower()
    mime = _MIME_BY_EXT.get(ext, "application/octet-stream")
    b64 = base64.b64encode(data).decode("ascii")
    return mark_safe(f"data:{mime};base64,{b64}")

