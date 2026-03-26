import base64
import mimetypes
from functools import lru_cache
from pathlib import Path

from django import template
from django.conf import settings
from django.utils.safestring import mark_safe

register = template.Library()


def _candidate_paths(rel_path: str) -> list[Path]:
    # Ensure relative paths like `css/ojt.css` (strip leading `/` if needed).
    rel_path = str(rel_path).lstrip("/")
    base_dir = Path(settings.BASE_DIR)
    return [
        base_dir / "static" / rel_path,
        Path(settings.STATIC_ROOT) / rel_path,
    ]


@lru_cache(maxsize=256)
def _read_text(rel_path: str) -> str:
    for p in _candidate_paths(rel_path):
        try:
            if p.exists() and p.is_file():
                # `ojt.css` contains Unicode characters in comments; keep it robust.
                return p.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
    return ""


@lru_cache(maxsize=64)
def _read_data_uri(rel_path: str) -> str:
    for p in _candidate_paths(rel_path):
        try:
            if p.exists() and p.is_file():
                mime, _ = mimetypes.guess_type(p.name)
                mime = mime or "application/octet-stream"
                b64 = base64.b64encode(p.read_bytes()).decode("ascii")
                return f"data:{mime};base64,{b64}"
        except Exception:
            continue
    return ""


@register.simple_tag
def inline_static_text(rel_path: str) -> str:
    """
    Inline the contents of a static text file (CSS/JS) as safe HTML.
    Used to avoid `/static/*` 404s on Vercel.
    """
    return mark_safe(_read_text(rel_path))


@register.simple_tag
def inline_static_data_uri(rel_path: str) -> str:
    """Inline an image as a `data:` URI (logo/background)."""
    return mark_safe(_read_data_uri(rel_path))

