"""
Regenerate PWA icons (192 + 512) to match static/images/logo.svg geometry.

Requires: pip install pillow
"""
from __future__ import annotations

from pathlib import Path


def _lerp_rgb(a: tuple[int, int, int], b: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    return (
        round(a[0] + (b[0] - a[0]) * t),
        round(a[1] + (b[1] - a[1]) * t),
        round(a[2] + (b[2] - a[2]) * t),
    )


def render_logo_png(size: int) -> "Image.Image":
    from PIL import Image, ImageDraw, ImageFilter

    s = size / 256.0
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))

    x, y = 20 * s, 20 * s
    w, h = 216 * s, 216 * s
    rx = 48 * s

    # --- Drop shadow (approx. feDropShadow dy=8, blur ~10) ---
    shadow_layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow_layer)
    sd.rounded_rectangle(
        [x, y + 8 * s, x + w, y + h + 8 * s],
        radius=rx,
        fill=(0, 0, 0, 160),
    )
    shadow_layer = shadow_layer.filter(ImageFilter.GaussianBlur(radius=max(6, 8 * s)))
    img = Image.alpha_composite(img, shadow_layer)

    # --- Vertical gradient rounded rectangle (#ff7a18 → #f97316) ---
    gw, gh = max(1, int(round(w))), max(1, int(round(h)))
    top = (255, 122, 24)
    bottom = (249, 115, 22)
    grad_rgb = Image.new("RGB", (gw, gh))
    gdraw = ImageDraw.Draw(grad_rgb)
    for irow in range(gh):
        t = irow / max(gh - 1, 1)
        gdraw.line([(0, irow), (gw, irow)], fill=_lerp_rgb(top, bottom, t))

    mask = Image.new("L", (gw, gh), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle([0, 0, gw - 1, gh - 1], radius=max(1, int(round(rx))), fill=255)

    grad = Image.new("RGBA", (gw, gh))
    grad.paste(grad_rgb, (0, 0))
    grad.putalpha(mask)

    ix, iy = int(round(x)), int(round(y))
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(grad, (ix, iy), grad)
    img = Image.alpha_composite(img, canvas)

    draw = ImageDraw.Draw(img)
    cx, cy = 128 * s, 128 * s

    # --- Inner circle rgba(11,11,13,0.92) ---
    r_fill = 62 * s
    bbox = [cx - r_fill, cy - r_fill, cx + r_fill, cy + r_fill]
    draw.ellipse(bbox, fill=(11, 11, 13, round(255 * 0.92)))

    # --- Ring stroke rgba(255,255,255,0.25), stroke-width 6 ---
    r_ring = 56 * s
    sw = max(1, int(round(6 * s)))
    ring = (255, 255, 255, round(255 * 0.25))
    bbox_o = [cx - r_ring - sw / 2, cy - r_ring - sw / 2, cx + r_ring + sw / 2, cy + r_ring + sw / 2]
    draw.ellipse(bbox_o, outline=ring, width=sw)

    # --- Clock hands path: M 128 92 v 40 l 28 18 ---
    lw = max(2, int(round(12 * s)))
    p1 = (128 * s, 92 * s)
    p2 = (128 * s, 132 * s)
    p3 = (156 * s, 150 * s)
    draw.line([p1, p2, p3], fill=(255, 255, 255, 255), width=lw, joint="curve")

    # --- Center dot r=7 ---
    r_dot = 7 * s
    db = [cx - r_dot, cy - r_dot, cx + r_dot, cy + r_dot]
    draw.ellipse(db, fill=(255, 255, 255, 255))

    return img


def main() -> None:
    try:
        from PIL import Image  # noqa: F401
    except ImportError as e:
        raise SystemExit("Install Pillow first: pip install pillow") from e

    root = Path(__file__).resolve().parent.parent
    out_dir = root / "static" / "icons"
    out_dir.mkdir(parents=True, exist_ok=True)

    for dim in (192, 512):
        im = render_logo_png(dim)
        dest = out_dir / f"icon-{dim}.png"
        im.save(dest, format="PNG", optimize=True)
        print("Wrote", dest)


if __name__ == "__main__":
    main()
