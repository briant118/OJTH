from __future__ import annotations

import base64
from pathlib import Path
from functools import lru_cache

from django import template
from django.contrib.staticfiles import finders
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
    if not file_path:
        raise FileNotFoundError(f"Static asset not found: {static_path}")
    return Path(file_path).read_text(encoding="utf-8")


@lru_cache(maxsize=32)
def _read_bytes_from_static(static_path: str) -> bytes:
    file_path = finders.find(static_path)
    if not file_path:
        raise FileNotFoundError(f"Static asset not found: {static_path}")
    return Path(file_path).read_bytes()


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
    ext = Path(static_path).suffix.lower()
    mime = _MIME_BY_EXT.get(ext, "application/octet-stream")
    b64 = base64.b64encode(data).decode("ascii")
    return mark_safe(f"data:{mime};base64,{b64}")

