import json, sys, os
from playwright.sync_api import sync_playwright
ROOT = '/home/claude/t212-widget'
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/claude-0/shots'
os.makedirs(OUT, exist_ok=True)
mock = open(ROOT + '/scripts/preview/mock.js').read()
DIM = {'small': (356, 360), 'medium': (676, 360), 'large': (676, 676), 'rail': (376, 760)}
WALL = "radial-gradient(120% 100% at 18% 0%,#282b48 0%,#191c2e 55%,#12141f 100%)"
cases = [
  ('medium-cs', {'settings': {'size': 'medium'}}),
  ('medium-en', {'settings': {'size': 'medium', 'language': 'en'}}),
  ('porcelain-medium', {'settings': {'size': 'medium', 'theme': 'porcelain'}}),
  ('porcelain-menu', {'settings': {'size': 'small', 'theme': 'porcelain'}, 'menu': True}),
  ('aurora-large', {'settings': {'size': 'large', 'theme': 'aurora', 'accent': '#4fb3c8'}}),
  ('mesh-medium', {'settings': {'size': 'medium', 'theme': 'mesh', 'accent': '#e07a9b'}}),
  ('ember-small', {'settings': {'size': 'small', 'theme': 'ember', 'textColor': '#f2e8d8'}}),
  ('blueprint-rail', {'settings': {'size': 'rail', 'theme': 'blueprint', 'accent': '#6f8fe8'}}),
  ('carbon-large-pos', {'settings': {'size': 'large', 'theme': 'carbon', 'largeView': 'positions', 'accent': '#d9b45a'}}),
  ('frost-medium', {'settings': {'size': 'medium', 'theme': 'frost'}}),
  ('oled-small', {'settings': {'size': 'small', 'theme': 'oled', 'textColor': '#ffffff'}}),
  ('closed-small', {'settings': {'size': 'small', 'pauseWhenClosed': True}, 'state': {'status': 'closed', 'marketCodes': ['US', 'GB', 'FR']}}),
]
only = sys.argv[2].split(',') if len(sys.argv) > 2 else None
with sync_playwright() as p:
    b = p.chromium.launch()
    for name, cfg in cases:
        if only and name not in only: continue
        size = cfg['settings'].get('size', 'medium')
        if cfg.get('state', {}).get('status') == 'first-run': size = 'medium'
        w, h = DIM[size]
        pg = b.new_page(viewport={'width': w, 'height': h}, device_scale_factor=2)
        pg.add_init_script('window.__MOCK=' + json.dumps(cfg) + ';' + mock)
        pg.goto('file://' + ROOT + '/app/widget.html')
        pg.add_style_tag(content=':root:root{background:%s!important}' % WALL)
        pg.wait_for_timeout(700)
        if cfg.get('click'): pg.click(cfg['click']); pg.wait_for_timeout(400)
        if cfg.get('menu'):
            pg.hover('.wg'); pg.click('.corner'); pg.wait_for_timeout(300)
        pg.wait_for_timeout(1400)
        pg.screenshot(path=f'{OUT}/{name}.png')
        pg.close()
    # settings window
    for tab in (['appearance', 'data'] if not only or 'settings' in only else []):
        pg = b.new_page(viewport={'width': 760, 'height': 680}, device_scale_factor=1.5)
        pg.add_init_script('window.__MOCK=' + json.dumps({'settings': {'accent': '#6f8fe8', 'tint': 0.2, 'theme': 'aurora'}, 'state': {'marketCodes': ['US', 'GB', 'FR']}}) + ';' + mock)
        pg.goto('file://' + ROOT + '/app/settings.html?tab=' + tab)
        pg.add_style_tag(content=':root:root{background:%s!important}' % WALL)
        pg.wait_for_timeout(1300)
        pg.screenshot(path=f'{OUT}/settings-{tab}.png')
        pg.close()
    b.close()
print('ok')
