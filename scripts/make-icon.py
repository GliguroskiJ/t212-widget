# Generates every app icon from one vector mark: rising bars + trend line on a deep violet tile.
#   build/icon-1024.png  macOS (Apple grid: 824 px tile with shadow inside a 1024 canvas)
#   build/icon.png, build/icon.ico, static/icon.ico, static/icon-32.png  Windows / window icon (full tile)
#   static/trayTemplate(@2x).png  macOS menu-bar template (black silhouette)
# Run:  python3 scripts/make-icon.py   (needs playwright + Pillow)
import io
from playwright.sync_api import sync_playwright
from PIL import Image

ROOT = __file__.rsplit('/scripts/', 1)[0]

# mark geometry in a 24×24 box (same as the Tile in src/ui.jsx)
BARS = [(5, 12.5, 3, 5.5), (10.5, 9.5, 3, 8.5), (16, 6.5, 3, 11.5)]
LINE = 'M4.6 13.4 L9.4 10.6 L13.4 11.9 L19.4 5.6'
DOT = (19.4, 5.6)

def tile_svg(size, pad, small=False, shadow=False):
    """Coloured app icon. pad = empty margin around the tile (fraction of size)."""
    t = size * (1 - 2 * pad)            # tile edge
    o = size * pad
    k = t / 24 * (1.06 if small else 0.86)   # mark scale (bigger on tiny icons)
    mo = o + (t - 24 * k) / 2
    r = t * 0.225
    lw = (2.2 if small else 1.3) * k
    bars = ''.join(f'<rect x="{mo + x * k:.2f}" y="{mo + y * k:.2f}" width="{w * k:.2f}" height="{h * k:.2f}" rx="{0.9 * k:.2f}" fill="url(#bar)"/>' for x, y, w, h in BARS)
    def P(d):
        out = []
        for tok in d.split():
            c, xy = tok[0], tok[1:]
            out.append(c + xy) if not xy else None
        return d
    pts = [tuple(map(float, p[1:].split())) for p in LINE.replace('M', '|M').replace('L', '|L').split('|') if p]
    path = ' '.join(('M' if i == 0 else 'L') + f'{mo + x * k:.2f} {mo + y * k:.2f}' for i, (x, y) in enumerate(pts))
    dx, dy = mo + DOT[0] * k, mo + DOT[1] * k
    glow = '' if small else f'<path d="{path}" fill="none" stroke="#6ee7b0" stroke-opacity=".3" stroke-width="{lw * 2.6:.2f}" stroke-linecap="round" stroke-linejoin="round" filter="url(#blur)"/>'
    sh = f'<rect x="{o:.1f}" y="{o + size * .012:.1f}" width="{t:.1f}" height="{t:.1f}" rx="{r:.1f}" fill="#000" opacity=".35" filter="url(#sh)"/>' if shadow else ''
    rim = '' if small else f'<rect x="{o + 1.5:.1f}" y="{o + 1.5:.1f}" width="{t - 3:.1f}" height="{t - 3:.1f}" rx="{r - 1.5:.1f}" fill="none" stroke="url(#rim)" stroke-width="{max(1.5, size / 300):.1f}"/>'
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 {size} {size}">
<defs>
 <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3a3478"/><stop offset=".55" stop-color="#211d4a"/><stop offset="1" stop-color="#121029"/></linearGradient>
 <radialGradient id="glow" cx=".22" cy=".12" r=".75"><stop offset="0" stop-color="#9d8cff" stop-opacity=".55"/><stop offset="1" stop-color="#9d8cff" stop-opacity="0"/></radialGradient>
 <linearGradient id="bar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c9c0ff"/><stop offset="1" stop-color="#7a6be0" stop-opacity=".55"/></linearGradient>
 <linearGradient id="rim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset=".4" stop-color="#fff" stop-opacity=".06"/><stop offset="1" stop-color="#fff" stop-opacity=".02"/></linearGradient>
 <filter id="blur" filterUnits="userSpaceOnUse" x="0" y="0" width="{size}" height="{size}"><feGaussianBlur stdDeviation="{k * .9:.2f}"/></filter>
 <filter id="sh" filterUnits="userSpaceOnUse" x="0" y="0" width="{size}" height="{size}"><feGaussianBlur stdDeviation="{size * .02:.1f}"/></filter>
</defs>
{sh}
<rect x="{o:.1f}" y="{o:.1f}" width="{t:.1f}" height="{t:.1f}" rx="{r:.1f}" fill="url(#bg)"/>
<rect x="{o:.1f}" y="{o:.1f}" width="{t:.1f}" height="{t:.1f}" rx="{r:.1f}" fill="url(#glow)"/>
{rim}
{bars}
{glow}
<path d="{path}" fill="none" stroke="#6ee7b0" stroke-width="{lw:.2f}" stroke-linecap="round" stroke-linejoin="round"/>
<circle cx="{dx:.2f}" cy="{dy:.2f}" r="{lw * (0.95 if small else 0.85):.2f}" fill="#d9fff0"/>
</svg>'''

def tray_svg(size):
    k = size / 24 * 1.12
    mo = (size - 24 * k) / 2 + k * .4
    bars = ''.join(f'<rect x="{mo + x * k:.2f}" y="{mo + y * k:.2f}" width="{w * k:.2f}" height="{h * k:.2f}" rx="{0.7 * k:.2f}" fill="#000" fill-opacity=".55"/>' for x, y, w, h in BARS)
    pts = [tuple(map(float, p[1:].split())) for p in LINE.replace('M', '|M').replace('L', '|L').split('|') if p]
    path = ' '.join(('M' if i == 0 else 'L') + f'{mo + x * k:.2f} {mo + y * k:.2f}' for i, (x, y) in enumerate(pts))
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 {size} {size}">{bars}
<path d="{path}" fill="none" stroke="#000" stroke-width="{2.1 * k:.2f}" stroke-linecap="round" stroke-linejoin="round"/>
<circle cx="{mo + DOT[0] * k:.2f}" cy="{mo + DOT[1] * k:.2f}" r="{1.9 * k:.2f}" fill="#000"/></svg>'''

def render(pg, svg, size):
    pg.set_viewport_size({'width': size, 'height': size})
    pg.set_content(f'<html><body style="margin:0;background:transparent">{svg}</body></html>')
    pg.wait_for_timeout(60)
    return Image.open(io.BytesIO(pg.screenshot(omit_background=True, clip={'x': 0, 'y': 0, 'width': size, 'height': size}))).convert('RGBA')

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page()
    render(pg, tile_svg(1024, 100 / 1024, shadow=True), 1024).save(ROOT + '/build/icon-1024.png')
    ico = {}
    for s in [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]:
        ico[s] = render(pg, tile_svg(s, 0.02 if s >= 48 else 0, small=s <= 32), s)
    ico[256].save(ROOT + '/build/icon.png')
    ico[32].save(ROOT + '/static/icon-32.png')
    sizes = sorted(ico)
    ico[256].save(ROOT + '/build/icon.ico', sizes=[(s, s) for s in sizes], append_images=[ico[s] for s in sizes if s != 256])
    ico[256].save(ROOT + '/static/icon.ico', sizes=[(s, s) for s in sizes], append_images=[ico[s] for s in sizes if s != 256])
    render(pg, tray_svg(18), 18).save(ROOT + '/static/trayTemplate.png')
    render(pg, tray_svg(36), 36).save(ROOT + '/static/trayTemplate@2x.png')
    # preview sheet
    sheet = Image.new('RGBA', (1024 + 40 + 256 + 20 + 160, 1024), (30, 31, 40, 255))
    big = render(pg, tile_svg(1024, 100 / 1024, shadow=True), 1024)
    sheet.alpha_composite(big, (0, 0))
    sheet.alpha_composite(ico[256], (1064, 40))
    y = 330
    for s in [128, 64, 48, 32, 24, 16]:
        sheet.alpha_composite(ico[s], (1064, y)); y += s + 14
    for i, bg in enumerate([(245, 245, 247, 255), (30, 30, 30, 255)]):
        box = Image.new('RGBA', (60, 40), bg)
        tr = render(pg, tray_svg(36), 36)
        if i: tr = Image.merge('RGBA', (*[Image.new('L', tr.size, 255)] * 3, tr.split()[3]))
        box.alpha_composite(tr, (12, 2))
        sheet.alpha_composite(box, (1360, 40 + i * 50))
    sheet.save('/tmp/icon-sheet.png')
    b.close()
print('icons written')
