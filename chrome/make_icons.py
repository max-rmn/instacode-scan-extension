#!/usr/bin/env python3
"""Génère les icônes PNG de l'extension (aucune dépendance externe)."""
import struct, zlib, os, math

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "icons")
os.makedirs(OUT, exist_ok=True)

BG = (0x00, 0x95, 0xF6, 255)      # bleu Instagram
BG_DARK = (0x00, 0x6D, 0xB8, 255) # dégradé bas
WHITE = (255, 255, 255, 255)


def write_png(path, w, h, pixels):
    def chunk(t, data):
        c = struct.pack(">I", len(data)) + t + data
        c += struct.pack(">I", zlib.crc32(t + data) & 0xFFFFFFFF)
        return c
    raw = b""
    for row in pixels:
        raw += b"\x00" + b"".join(struct.pack("BBBB", *px) for px in row)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    with open(path, "wb") as f:
        f.write(png)


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(4))


def in_circle(x, y, cx, cy, r):
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def make_icon(size):
    s = size
    cx, cy = s / 2, s / 2
    # Loupe : centre du cercle et rayon, poignée en bas-droite.
    ring_r = s * 0.30
    ring_cx, ring_cy = s * 0.44, s * 0.44
    ring_t = s * 0.10  # épaisseur de l'anneau
    handle_w = s * 0.11
    # Segment de poignée : de (hx0,hy0) vers (hx1,hy1)
    hx0, hy0 = ring_cx + ring_r * 0.72, ring_cy + ring_r * 0.72
    hx1, hy1 = s * 0.85, s * 0.85

    px = []
    for y in range(s):
        row = []
        for x in range(s):
            # Fond dégradé vertical.
            t = y / (s - 1)
            base = lerp(BG, BG_DARK, t)
            col = base
            # Anneau de la loupe.
            d = math.hypot(x - ring_cx, y - ring_cy)
            if abs(d - ring_r) <= ring_t / 2:
                col = WHITE
            else:
                # Poignée : distance au segment.
                lx, ly = hx1 - hx0, hy1 - hy0
                seg = math.hypot(lx, ly) or 1.0
                proj = ((x - hx0) * lx + (y - hy0) * ly) / (seg * seg)
                proj = max(0.0, min(1.0, proj))
                pxp, pyp = hx0 + proj * lx, hy0 + proj * ly
                if math.hypot(x - pxp, y - pyp) <= handle_w / 2:
                    col = WHITE
            row.append(col)
        px.append(row)
    return px


for size in (16, 48, 128):
    write_png(os.path.join(OUT, f"icon{size}.png"), size, size, make_icon(size))
    print("généré", f"icon{size}.png")
