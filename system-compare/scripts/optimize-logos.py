#!/usr/bin/env python3
"""Shrink oversized raster vendor logos in place (run after adding logos; needs Pillow).

The catalog points at assets/logos/<name>.<ext>, so names, formats and paths stay; only the pixels shrink. A logo is
never shown larger than its plate on the product profile: a wordmark (catalog logo.kind "wordmark", the wide plate)
paints at most 139 x 35 CSS px, any other logo at most 47 x 47. Files are scaled to fit twice that (278 x 70 or
94 x 94: sharp on 2x screens) and are never enlarged. Transparent edges are resized premultiplied (no dark fringes).
Each file gets the smallest encoding in its own format that still matches a full-colour resize of the original
(a palette PNG is used only when it is visually identical on the logo's own background).

    python3 scripts/optimize-logos.py           # rewrite oversized files
    python3 scripts/optimize-logos.py --dry-run # list what would change
"""
import io
import json
import sys
from pathlib import Path
from PIL import Image, ImageChops, ImageStat

ROOT = Path(__file__).resolve().parent.parent
LOGOS = ROOT / "src/assets/static/assets/logos"
BOX = {"wordmark": (278, 70), "icon": (94, 94)}  # 2x the largest painted size, CSS px
SURFACE = {"dark": (23, 26, 38), "brand-gradient": (23, 26, 38)}  # --logo-dark; everything else sits on white
MIN_SAVING = 0.2  # a file that needs no resizing is re-encoded only when that saves at least 20%


def catalog_logos():
    catalog = json.loads((ROOT / "data/catalog.json").read_text())
    return {Path(v["logo"]["path"]).name: v["logo"] for v in catalog["vendors"] if v.get("logo", {}).get("path")}


def resized(im, size):
    if im.mode in ("RGBA", "LA", "PA") or (im.mode == "P" and "transparency" in im.info) or "transparency" in im.info:
        if im.size == size:
            return im.convert("RGBA")
        return im.convert("RGBA").convert("RGBa").resize(size, Image.LANCZOS).convert("RGBA")  # premultiplied
    rgb = im.convert("RGB")
    return rgb if im.size == size else rgb.resize(size, Image.LANCZOS)


def on(bg, im):
    """The logo as painted on its plate."""
    im = im.convert("RGBA")
    canvas = Image.new("RGBA", im.size, bg + (255,))
    canvas.alpha_composite(im)
    return canvas.convert("RGB")


def faithful(candidate, ref, bg):
    diff = ImageChops.difference(on(bg, candidate), on(bg, ref)).convert("L")
    hist = diff.histogram()
    n = sum(hist)
    p995 = next(i for i in range(256) if sum(hist[: i + 1]) >= 0.995 * n)
    return ImageStat.Stat(diff).mean[0] <= 1.5 and p995 <= 24


def encode(ref, fmt, bg):
    """Smallest encoding in the original format that matches `ref` on its background."""
    out = []
    def save(im, **kw):
        b = io.BytesIO()
        im.save(b, fmt, **kw)
        return b.getvalue()
    if fmt == "PNG":
        out.append(save(ref, optimize=True))
        q = ref.quantize(colors=256, method=Image.Quantize.FASTOCTREE) if ref.mode == "RGBA" else ref.quantize(colors=256)
        if faithful(q, ref, bg):
            out.append(save(q, optimize=True))
    elif fmt == "JPEG":
        out.append(save(ref.convert("RGB"), quality=90, optimize=True, progressive=True))
    elif fmt == "WEBP":
        out.append(save(ref, lossless=True, method=6))
        lossy = save(ref, quality=90, method=6)
        if faithful(Image.open(io.BytesIO(lossy)), ref, bg):
            out.append(lossy)
    return min(out, key=len)


def main(dry):
    logos = catalog_logos()
    total_before = total_after = 0
    for path in sorted(LOGOS.iterdir()):
        if path.suffix.lower() not in (".png", ".jpg", ".jpeg", ".webp"):
            continue
        im = Image.open(path)
        im.load()
        meta = logos.get(path.name, {})
        bw, bh = BOX["wordmark" if meta.get("kind") == "wordmark" else "icon"]
        scale = min(bw / im.width, bh / im.height, 1)
        size = (max(1, round(im.width * scale)), max(1, round(im.height * scale)))
        data = encode(resized(im, size), im.format, SURFACE.get(meta.get("surface"), (255, 255, 255)))
        before = path.stat().st_size
        if len(data) >= before if size != im.size else len(data) > before * (1 - MIN_SAVING):
            continue
        total_before += before
        total_after += len(data)
        print(f"{path.name:40} {im.width}x{im.height} -> {size[0]}x{size[1]}  {before:>7,} -> {len(data):>7,} bytes")
        if not dry:
            path.write_bytes(data)
    print(f"total {total_before:,} -> {total_after:,} bytes" + ("  (dry run)" if dry else ""))


if __name__ == "__main__":
    main("--dry-run" in sys.argv)
