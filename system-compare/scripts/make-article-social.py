#!/usr/bin/env python3
"""Social-share versions of the article hero images (run once per new image; needs Pillow).

The heroes are 3:2 WebP files. Facebook, LinkedIn, X and most chat apps want a 1200x630 JPEG or PNG and do
not reliably read WebP, so every hero gets  assets/articles/social/<name>.jpg : the whole picture fitted
on a 1200x630 canvas over a blurred copy of itself (nothing is cropped — the artwork has text at its edges).

    python3 scripts/make-article-social.py
    python3 scripts/make-hero-variants.py   # and the responsive sizes the pages load (assets/articles/sized/)
"""
from pathlib import Path
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src/assets/static/assets/articles"
OUT = SRC / "social"
W, H = 1200, 630


def social(path: Path) -> Path:
    im = Image.open(path).convert("RGB")
    # background: the picture scaled to cover the canvas, blurred and slightly lightened
    scale = max(W / im.width, H / im.height)
    bg = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
    left, top = (bg.width - W) // 2, (bg.height - H) // 2
    bg = bg.crop((left, top, left + W, top + H)).filter(ImageFilter.GaussianBlur(28))
    bg = Image.blend(bg, Image.new("RGB", (W, H), (255, 255, 255)), 0.25)
    # foreground: the whole picture, fitted to the canvas height
    fit = min(W / im.width, H / im.height)
    fg = im.resize((round(im.width * fit), round(im.height * fit)), Image.LANCZOS)
    bg.paste(fg, ((W - fg.width) // 2, (H - fg.height) // 2))
    OUT.mkdir(parents=True, exist_ok=True)
    out = OUT / f"{path.stem}.jpg"
    bg.save(out, "JPEG", quality=86, optimize=True, progressive=True)
    return out


if __name__ == "__main__":
    for src in sorted(SRC.glob("*.webp")):
        out = social(src)
        print(f"{out.relative_to(ROOT)}  {out.stat().st_size // 1024} KB")
