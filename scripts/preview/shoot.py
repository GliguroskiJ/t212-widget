import json, sys, os
from playwright.sync_api import sync_playwright
ROOT = '/home/claude/t212-widget'
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/claude-0/shots'
os.makedirs(OUT, exist_ok=True)
mock = open(ROOT + '/scripts/preview/mock.js').read()
DIM = {'small': (356, 360), 'medium': (676, 360), 'large': (676, 676), 'rail': (376, 760)}
WALL = "radial-gradient(120% 100% at 18% 0%,#282b48 0%,#191c2e 55%,#12141f 100%)"
cases = [
  ('small', {'settings': {'size': 'small'}}),
  ('medium', {'settings': {'size': 'medium'}}),
  ('large-chart', {'settings': {'size': 'large'}}),
  ('large-positions', {'settings': {'size': 'large', 'largeView': 'positions'}, 'click': 'text=NVIDIA Corp'}),
  ('large-alloc', {'settings': {'size': 'large', 'largeView': 'alloc'}}),
  ('rail', {'settings': {'size': 'rail'}}),
  ('loading-small', {'settings': {'size': 'small'}, 'state': {'status': 'loading'}, 'noData': True}),
  ('closed-small', {'settings': {'size': 'small'}, 'state': {'status': 'closed', 'market': {'open': False, 'names': 'Xetra, NYSE', 'opensIn': '14h 22m'}}}),
  ('error-medium', {'settings': {'size': 'medium'}, 'state': {'status': 'error'}}),
  ('firstrun', {'settings': {'size': 'small'}, 'state': {'status': 'first-run', 'connected': False}, 'noData': True}),
  ('medium-indigo', {'settings': {'size': 'medium', 'theme': 'indigo'}}),
  ('small-menu', {'settings': {'size': 'small'}, 'menu': True}),
  ('error-small', {'settings': {'size': 'small'}, 'state': {'status': 'error', 'error': {'kind': 'network', 'code': 0, 'message': 'x', 'retryAt': 0}}}),
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
        pg.add_style_tag(content='html{background:%s!important}' % WALL)
        pg.wait_for_timeout(700)
        if cfg.get('click'): pg.click(cfg['click']); pg.wait_for_timeout(400)
        if cfg.get('menu'):
            pg.hover('.wg'); pg.click('.corner'); pg.wait_for_timeout(300)
        pg.wait_for_timeout(1400)
        pg.screenshot(path=f'{OUT}/{name}.png')
        pg.close()
    # settings window
    for tab in (['account', 'widget', 'appearance', 'data', 'system'] if not only or 'settings' in only else []):
        pg = b.new_page(viewport={'width': 760, 'height': 680}, device_scale_factor=1.5)
        pg.add_init_script('window.__MOCK={};' + mock)
        pg.goto('file://' + ROOT + '/app/settings.html?tab=' + tab)
        pg.add_style_tag(content='html{background:%s!important}' % WALL)
        pg.wait_for_timeout(1300)
        pg.screenshot(path=f'{OUT}/settings-{tab}.png')
        pg.close()
    b.close()
print('ok')
