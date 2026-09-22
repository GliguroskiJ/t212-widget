from playwright.sync_api import sync_playwright
ROOT='/home/claude/t212-widget'
font=open(ROOT+'/node_modules/@fontsource/inter/files/inter-latin-600-normal.woff2','rb').read()
import base64
b64=base64.b64encode(font).decode()
html=f'''<html><head><style>@font-face{{font-family:I;src:url(data:font/woff2;base64,{b64})}}
html,body{{margin:0;background:transparent}}</style></head><body>
<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#342f52"/><stop offset="1" stop-color="#1c1a2c"/></linearGradient>
<linearGradient id="h" x1="0" x2="1"><stop offset="0" stop-color="#9184d9" stop-opacity="0"/><stop offset=".5" stop-color="#b5abfc" stop-opacity=".9"/><stop offset="1" stop-color="#9184d9" stop-opacity="0"/></linearGradient></defs>
<rect x="40" y="40" width="944" height="944" rx="210" fill="url(#g)" stroke="#5d5294" stroke-width="36"/>
<rect x="250" y="58" width="524" height="10" rx="5" fill="url(#h)"/>
<path d="M230 700 L380 600 L500 650 L640 470 L790 390" fill="none" stroke="#74c69a" stroke-width="44" stroke-linecap="round" stroke-linejoin="round" opacity=".95"/>
<circle cx="790" cy="390" r="34" fill="#74c69a"/>
<text x="512" y="365" text-anchor="middle" font-family="I" font-weight="600" font-size="250" fill="#d2cefd" letter-spacing="-6">212</text>
</svg></body></html>'''
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={'width':1024,'height':1024})
    pg.set_content(html); pg.wait_for_timeout(300)
    pg.screenshot(path=ROOT+'/build/icon-1024.png', omit_background=True)
    pg.set_viewport_size({'width':1024,'height':1024})
    b.close()
