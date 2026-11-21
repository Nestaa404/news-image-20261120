#!/usr/bin/env python3
"""Render DejaVu Sans glyphs into a bitmap font JSON for the news page.

Reads /usr/share/fonts/truetype/dejavu/DejaVuSans.ttf and
DejaVuSans-Bold.ttf with PIL and writes font.json next to this script's
parent directory (the repo root). Every glyph is stored as a small
grayscale bitmap (0 = transparent, 255 = full ink) plus metrics, so the
TypeScript renderer needs no font engine at runtime.
"""
import base64
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
FONT_DIR = "/usr/share/fonts/truetype/dejavu"

# Sizes actually used by the page layout (px), both weights.
SIZES = [13, 15, 17, 20, 24, 30, 38, 52, 72]
WEIGHTS = {
    "regular": os.path.join(FONT_DIR, "DejaVuSans.ttf"),
    "bold": os.path.join(FONT_DIR, "DejaVuSans-Bold.ttf"),
}

# Printable ASCII plus the few extra glyphs the page text uses.
CHARS = "".join(chr(c) for c in range(32, 127))
CHARS += "\u2014\u2013\u2019\u2018\u201c\u201d\u2022\u2192\u2193\u00d7\u20ac\u00b7"


def render_glyph(font, ch):
    """Return (advance, xoff, yoff, width, height, base64 pixels) or None.

    PIL's default text anchor is the top of the ascender, so we pass
    anchor="ls" (left-baseline) everywhere: the returned box is then
    relative to the baseline, which is what the renderer assumes.
    """
    # Bounding box of the ink, relative to the baseline origin.
    left, top, right, bottom = font.getbbox(ch, anchor="ls")
    w = right - left
    h = bottom - top
    adv = int(round(font.getlength(ch)))
    if w <= 0 or h <= 0:
        return {"adv": adv, "x": 0, "y": 0, "w": 0, "h": 0, "d": ""}
    pad = 2
    img = Image.new("L", (w + 2 * pad, h + 2 * pad), 0)
    draw = ImageDraw.Draw(img)
    draw.text((pad - left, pad - top), ch, font=font, fill=255, anchor="ls")
    px = img.tobytes()
    return {
        "adv": adv,
        "x": left - pad,
        "y": top - pad,
        "w": w + 2 * pad,
        "h": h + 2 * pad,
        "d": base64.b64encode(px).decode("ascii"),
    }


def main():
    out = {"sizes": {}, "chars": sorted(set(CHARS))}
    total = 0
    for weight, path in WEIGHTS.items():
        for size in SIZES:
            font = ImageFont.truetype(path, size)
            key = "%s-%d" % (weight, size)
            glyphs = {}
            for ch in CHARS:
                g = render_glyph(font, ch)
                glyphs[ch] = g
                total += 1
            out["sizes"][key] = {
                "ascent": int(font.getmetrics()[0]),
                "descent": int(font.getmetrics()[1]),
                "glyphs": glyphs,
            }
    dest = os.path.join(ROOT, "font.json")
    with open(dest, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))
    print("wrote %s (%d bytes, %d glyphs)" % (dest, os.path.getsize(dest), total))


if __name__ == "__main__":
    main()
