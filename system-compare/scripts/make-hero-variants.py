#!/usr/bin/env python3
"""Responsive sizes of the article hero images (run after adding or changing a hero; needs Pillow with WebP).

Guide and editorial-comparison heroes are 1536 or 1200 px wide but are shown 280-736 CSS px wide. For every hero
WebP in assets/articles/ this writes  assets/articles/sized/<name>-<width>.webp  at the widths below (never wider
than the original; the original width itself is a byte copy, so nothing is re-encoded twice). build.mjs gives the
sized files a content hash and the pages list them in srcset; the original files keep their URLs (the catalog,
JSON-LD and old links point at them) but no page loads them any more.

    python3 scripts/make-hero-variants.py
"""
import shutil
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src/assets/static/assets/articles"
OUT = SRC / "sized"
# 1x phones (480), 2x phones and 1x desktop at 736 CSS px (800), 3x phones (1200), 2x tablets and desktop (1536)
WIDTHS = (480, 800, 1200, 1536)
QUALITY = 80


def variants(path: Path):
    im = Image.open(path)
    im.load()
    widths = sorted({w for w in WIDTHS if w < im.width} | {im.width})
    for w in widths:
        out = OUT / f"{path.stem}-{w}.webp"
        if w == im.width:
            shutil.copyfile(path, out)
        else:
            h = round(im.height * w / im.width)
            im.convert("RGB").resize((w, h), Image.LANCZOS).save(out, "WEBP", quality=QUALITY, method=6)
        yield out


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.webp"):
        old.unlink()
    for src in sorted(SRC.glob("*.webp")):
        for out in variants(src):
            print(f"{out.relative_to(ROOT)}  {out.stat().st_size // 1024} KB")
