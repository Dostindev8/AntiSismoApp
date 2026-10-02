"""Genera los assets de marca desde docs/brand/logo-fullcolor.png (EXECUTION_PROMPT §2).

Salidas (apps/mobile/assets/brand/):
  logo-fullcolor.png      logo completo, fondo transparente, recortado a su contenido (sin recolorear:
                          en fondos oscuros se muestra sobre una placa clara, ADR 0005)
  symbol.png              solo escudo (transparente)
  symbol-mono.png         escudo monocromo blanco (Android 13+ themed icon / notificaciones)
  app_icon.png            1024x1024 opaco (iOS: sin transparencia), escudo sobre gradiente navy
  app_icon_fg.png         foreground adaptive icon Android (escudo dentro de la zona segura 66%)
  splash.png              escudo para splash nativo (1152x1152, transparente, margen ≥ 25 % por lado)
  icon_29.png             prueba de legibilidad a 29 px
Salidas web (apps/web/public/brand/): logo-fullcolor, symbol (escudo), icon-192/512, icon-maskable-512, apple-touch-icon, favicon.ico
Uso: python scripts/brand/generate_brand_assets.py
"""
from __future__ import annotations

import json
from collections import deque
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "docs" / "brand" / "logo-fullcolor.png"
OUT = ROOT / "apps" / "mobile" / "assets" / "brand"
WEB = ROOT / "apps" / "web" / "public" / "brand"

_COLORS = json.loads((ROOT / "packages" / "config" / "tokens.json").read_text(encoding="utf-8"))["colors"]


def _rgb(hex_color: str) -> tuple[int, int, int]:
    return tuple(int(hex_color[i : i + 2], 16) for i in (1, 3, 5))


NAVY = _rgb(_COLORS["brandNavy"])
DEEP = _rgb(_COLORS["bgDeep"])


def remove_outer_background(img: Image.Image, tol: int = 38) -> Image.Image:
    """Flood-fill desde los bordes: vuelve transparente SOLO el fondo claro exterior (el interior blanco
    del escudo queda intacto porque no está conectado al borde)."""
    img = img.convert("RGBA")
    w, h = img.size
    px = img.load()
    seen = bytearray(w * h)
    q: deque[tuple[int, int]] = deque()
    for x in range(w):
        q.extend(((x, 0), (x, h - 1)))
    for y in range(h):
        q.extend(((0, y), (w - 1, y)))

    def is_bg(p: tuple[int, int, int, int]) -> bool:
        r, g, b, a = p
        return a < 16 or (r > 255 - tol and g > 255 - tol and b > 255 - tol)

    while q:
        x, y = q.popleft()
        i = y * w + x
        if seen[i]:
            continue
        seen[i] = 1
        if not is_bg(px[x, y]):
            continue
        px[x, y] = (255, 255, 255, 0)
        if x > 0: q.append((x - 1, y))
        if x < w - 1: q.append((x + 1, y))
        if y > 0: q.append((x, y - 1))
        if y < h - 1: q.append((x, y + 1))
    # suaviza el halo blanco del antialiasing del borde
    alpha = img.getchannel("A").filter(ImageFilter.MinFilter(3))
    img.putalpha(alpha)
    return img


def crop_to_content(img: Image.Image, pad: int = 0) -> Image.Image:
    bbox = img.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox()
    if not bbox:
        raise SystemExit("logo vacío tras quitar el fondo")
    l, t, r, b = bbox
    return img.crop((max(0, l - pad), max(0, t - pad), min(img.width, r + pad), min(img.height, b + pad)))


def _component(mask: list[bool], w: int, h: int, seed: tuple[int, int]) -> list[bool]:
    comp = [False] * (w * h)
    q: deque[tuple[int, int]] = deque([seed])
    while q:
        x, y = q.popleft()
        i = y * w + x
        if comp[i] or not mask[i]:
            continue
        comp[i] = True
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                nx, ny = x + dx, y + dy
                if 0 <= nx < w and 0 <= ny < h and not comp[ny * w + nx] and mask[ny * w + nx]:
                    q.append((nx, ny))
    return comp


def _fill_holes(comp: list[bool], w: int, h: int) -> list[bool]:
    """Todo lo que no es alcanzable desde el borde sin cruzar el componente = interior del escudo."""
    outside = [False] * (w * h)
    q: deque[tuple[int, int]] = deque()
    for x in range(w):
        q.extend(((x, 0), (x, h - 1)))
    for y in range(h):
        q.extend(((0, y), (w - 1, y)))
    while q:
        x, y = q.popleft()
        i = y * w + x
        if outside[i] or comp[i]:
            continue
        outside[i] = True
        if x > 0: q.append((x - 1, y))
        if x < w - 1: q.append((x + 1, y))
        if y > 0: q.append((x, y - 1))
        if y < h - 1: q.append((x, y + 1))
    return [not o for o in outside]


def find_symbol(logo: Image.Image) -> tuple[Image.Image, tuple[int, int]]:
    """Escudo = componente conexo opaco que contiene el borde superior central. Su interior 'vidrio'
    (alpha ~10-15 %) se rellena de blanco sólido para que el símbolo sea legible sobre fondos oscuros."""
    w, h = logo.size
    a = logo.getchannel("A").tobytes()
    mask = [v > 90 for v in a]
    cx = w // 2
    seed_y = next(y for y in range(h) if mask[y * w + cx])
    comp = _component(mask, w, h, (cx, seed_y))
    ys = [i // w for i, v in enumerate(comp) if v]
    bottom = max(ys)
    if bottom > h * 0.8:  # el escudo tocó el wordmark: cortar en la fila más angosta de la banda media
        counts = [sum(comp[y * w:(y + 1) * w]) for y in range(h)]
        bottom = min(range(int(h * 0.55), int(h * 0.8)), key=lambda y: counts[y])
        comp = [v and (i // w) <= bottom for i, v in enumerate(comp)]
    inside = _fill_holes(comp, w, h)
    fill = Image.new("L", (w, h))
    fill.putdata([255 if v else 0 for v in inside])
    fill = fill.filter(ImageFilter.MinFilter(5)).filter(ImageFilter.GaussianBlur(1))
    white = Image.new("RGBA", (w, h), (255, 255, 255, 0))
    white.putalpha(fill)
    sym = logo.crop((0, 0, w, bottom + 1))
    base = white.crop((0, 0, w, bottom + 1))
    keep = Image.new("L", (w, h))
    keep.putdata([255 if v else 0 for v in inside])
    sym_masked = Image.new("RGBA", sym.size, (0, 0, 0, 0))
    sym_masked.paste(sym, (0, 0), keep.crop((0, 0, w, bottom + 1)))
    base.alpha_composite(sym_masked)
    bbox = base.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
    assert bbox
    return base.crop(bbox), (bbox[0], bbox[1])


def fit(img: Image.Image, box: int) -> Image.Image:
    """object-contain: escala sin distorsión dentro de un cuadrado box×box."""
    s = min(box / img.width, box / img.height)
    return img.resize((max(1, round(img.width * s)), max(1, round(img.height * s))), Image.LANCZOS)


def paste_center(canvas: Image.Image, img: Image.Image) -> Image.Image:
    canvas.alpha_composite(img, ((canvas.width - img.width) // 2, (canvas.height - img.height) // 2))
    return canvas


def gradient(size: int) -> Image.Image:
    g = Image.new("RGBA", (size, size))
    d = ImageDraw.Draw(g)
    for y in range(size):
        t = y / (size - 1)
        d.line([(0, y), (size, y)], fill=tuple(round(DEEP[i] + (NAVY[i] - DEEP[i]) * t) for i in range(3)) + (255,))
    return g


def mono(sym: Image.Image) -> Image.Image:
    rgb = Image.new("RGBA", sym.size, (255, 255, 255, 255))
    rgb.putalpha(sym.getchannel("A"))
    return rgb


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    logo = crop_to_content(remove_outer_background(Image.open(SRC)))
    sym, (sx, sy) = find_symbol(logo)
    sym.save(OUT / "symbol.png", optimize=True)

    # logo completo con el escudo "sólido" (interior blanco) para cualquier fondo
    solid = logo.copy()
    solid.alpha_composite(sym, (sx, sy))
    solid.save(OUT / "logo-fullcolor.png", optimize=True)
    mono(sym).save(OUT / "symbol-mono.png", optimize=True)

    # iOS: opaco, escudo ocupa ~72% (zona de seguridad ≥ 25% del alto del símbolo repartida en márgenes)
    icon = paste_center(gradient(1024), fit(sym, 736)).convert("RGB")
    icon.save(OUT / "app_icon.png", optimize=True)
    # Android adaptive: foreground 1024 con el símbolo dentro del 66% central (zona segura del círculo)
    paste_center(Image.new("RGBA", (1024, 1024), (0, 0, 0, 0)), fit(sym, 600)).save(OUT / "app_icon_fg.png", optimize=True)
    paste_center(Image.new("RGBA", (1024, 1024), (0, 0, 0, 0)), fit(mono(sym), 600)).save(OUT / "app_icon_mono.png", optimize=True)
    paste_center(Image.new("RGBA", (1152, 1152), (0, 0, 0, 0)), fit(sym, 576)).save(OUT / "splash.png", optimize=True)
    icon.resize((29, 29), Image.LANCZOS).save(OUT / "icon_29.png")

    # Web/PWA (apps/web/public/brand): mismos píxeles del escudo oficial, sin recolorear ni redibujar.
    WEB.mkdir(parents=True, exist_ok=True)
    web_logo = fit(solid, 480)
    web_logo.save(WEB / "logo-fullcolor.png", optimize=True)
    web_logo.save(WEB / "logo-fullcolor.webp", quality=90, method=6)
    fit(sym, 192).save(WEB / "symbol.webp", quality=92, method=6)
    for size in (192, 512):
        icon.resize((size, size), Image.LANCZOS).save(WEB / f"icon-{size}.png", optimize=True)
    # maskable: el símbolo dentro del círculo seguro (80 % central) de la especificación W3C
    paste_center(gradient(512), fit(sym, 300)).convert("RGB").save(WEB / "icon-maskable-512.png", optimize=True)
    icon.resize((180, 180), Image.LANCZOS).save(WEB / "apple-touch-icon.png", optimize=True)
    icon.save(WEB / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    print("brand assets ->", OUT, "+", WEB)
    for p in sorted(OUT.iterdir()):
        with Image.open(p) as im:
            print(f"  {p.name:22s} {im.size[0]}x{im.size[1]} {im.mode}")


if __name__ == "__main__":
    main()
