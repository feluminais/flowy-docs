"""Builds hero.png, the picture at the top of the README, from the desktop-*.png screenshots beside it.

    uv run --with pillow docs/images/hero.py

Retake the screenshots first when the app changes how it looks (CONTRIBUTING.md says how), then run this.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

HERE = Path(__file__).parent
W, H = 3000, 1760  # drawn at this size, saved at 2400 wide


def load(name):
    return Image.open(HERE / f"desktop-{name}.png").convert("RGBA")


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


def frame(img, scale, radius=26):
    """Scale a picture, round its corners and give it a hairline edge."""
    img = img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)
    img = rounded(img, radius)
    edge = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(edge).rounded_rectangle((0, 0, img.width - 1, img.height - 1), radius, outline=(0, 0, 0, 38), width=2)
    return Image.alpha_composite(img, edge)


def place(canvas, img, xy, blur=60, dy=40, strength=0.30):
    """Paste a picture with a soft shadow under it."""
    pad = blur * 3
    shadow = Image.new("RGBA", (img.width + pad * 2, img.height + pad * 2), (0, 0, 0, 0))
    shadow.paste((20, 24, 50, 255), (pad, pad), img.getchannel("A").point(lambda v: round(v * strength)))
    canvas.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(blur)), (xy[0] - pad, xy[1] - pad + dy))
    canvas.alpha_composite(img, xy)


canvas = gradient((W, H), (236, 240, 250), (250, 246, 252))

# Behind: the dark theme, with a shape's panel open.
dark = frame(load("dark"), 0.62)
place(canvas, dark, (W - dark.width - 90, 90))

# Main: Ordering zoomed in, with a store's data open.
main = frame(load("data"), 0.74)
place(canvas, main, (130, 210), blur=70, dy=50, strength=0.34)

# Right: the Performance panel at 900 orders a minute.
perf = frame(load("performance").crop((1715, 166, 2470, 1520)), 0.92, 24)
place(canvas, perf, (W - perf.width - 150, 330))

# Bottom left: a flow playing.
card = frame(load("flow").crop((817, 1112, 1585, 1474)), 1.04)
place(canvas, card, (70, H - card.height - 130))

# Bottom middle: the edit panel's type and shape pickers.
edit = frame(load("edit").crop((1554, 585, 2310, 1272)), 0.74, 24)
place(canvas, edit, (990, H - edit.height - 76))

# Top left: search.
search = frame(load("search").crop((780, 175, 1620, 515)), 0.92, 24)
place(canvas, search, (452, 70))

hero = canvas.convert("RGB").resize((2400, round(H * 2400 / W)), Image.LANCZOS)
hero.save(HERE / "hero.png", optimize=True)
print(HERE / "hero.png", hero.size)
