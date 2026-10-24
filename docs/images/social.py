"""Builds social.png, the card GitHub shows when the repository's link is shared (Settings > Social preview, 1280 by 640).

    uv run --with pillow docs/images/social.py

Needs desktop-data.png beside it (docs/maintaining.md says how to retake it) and Segoe UI, which ships with Windows.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).parent
W, H = 2560, 1280  # drawn at twice the size, saved at 1280 by 640
FONTS = Path("C:/Windows/Fonts")


def gradient(size, top, bottom):
    w, h = size
    column = Image.new("RGB", (1, h))
    for y in range(h):
        t = y / (h - 1)
        column.putpixel((0, y), tuple(round(a + (b - a) * t) for a, b in zip(top, bottom)))
    return column.resize((w, h)).convert("RGBA")


def rounded(img, radius):
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, img.width - 1, img.height - 1), radius, fill=255)
    out = img.copy()
    out.putalpha(mask)
    return out


def wrap(draw, text, font, width):
    lines, line = [], ""
    for word in text.split():
        trial = f"{line} {word}".strip()
        if draw.textlength(trial, font=font) > width and line:
            lines.append(line)
            line = word
        else:
            line = trial
    return lines + [line]


canvas = gradient((W, H), (236, 240, 250), (250, 246, 252))

shot = Image.open(HERE / "desktop-data.png").convert("RGBA")
shot = rounded(shot.resize((round(shot.width * 0.86), round(shot.height * 0.86)), Image.LANCZOS), 36)
xy = (1240, 250)
shadow = Image.new("RGBA", (shot.width + 400, shot.height + 400), (0, 0, 0, 0))
shadow.paste((20, 24, 50, 255), (200, 200), shot.getchannel("A").point(lambda v: round(v * 0.32)))
canvas.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(60)), (xy[0] - 200, xy[1] - 200 + 40))
canvas.alpha_composite(shot, xy)

draw = ImageDraw.Draw(canvas)
title = ImageFont.truetype(str(FONTS / "segoeuib.ttf"), 190)
tagline = ImageFont.truetype(str(FONTS / "segoeui.ttf"), 78)
draw.text((140, 330), "Flowy Docs", font=title, fill=(24, 28, 48))
for i, line in enumerate(wrap(draw, "Architecture docs you zoom into, kept in your repo.", tagline, 980)):
    draw.text((148, 590 + i * 100), line, font=tagline, fill=(86, 92, 120))

out = canvas.convert("RGB").resize((1280, 640), Image.LANCZOS)
out.save(HERE / "social.png", optimize=True)
print(HERE / "social.png", out.size)
