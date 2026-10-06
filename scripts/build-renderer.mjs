import * as esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
// fileURLToPath, not URL.pathname: on Windows the pathname is "/D:/…" and resolves to an invalid "\D:\…"
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'app');
fs.mkdirSync(path.join(out, 'fonts'), { recursive: true });
fs.mkdirSync(path.join(out, 'phosphor'), { recursive: true });
for (const f of fs.readdirSync(path.join(root, 'static'))) fs.copyFileSync(path.join(root, 'static', f), path.join(out, f));
const fontDir = path.join(root, 'node_modules/@fontsource/inter/files');
for (const w of [300, 400, 500, 600]) for (const s of ['latin', 'latin-ext'])
  fs.copyFileSync(path.join(fontDir, `inter-${s}-${w}-normal.woff2`), path.join(out, 'fonts', `inter-${s}-${w}-normal.woff2`));
const ph = path.join(root, 'node_modules/@phosphor-icons/web/src/regular');
for (const f of ['style.css', 'Phosphor.woff2', 'Phosphor.woff', 'Phosphor.ttf']) fs.copyFileSync(path.join(ph, f), path.join(out, 'phosphor', f));
await esbuild.build({
  entryPoints: { widget: path.join(root, 'src/widget.jsx'), settings: path.join(root, 'src/settings.jsx'), update: path.join(root, 'src/update.jsx') },
  bundle: true, minify: true, outdir: out, format: 'iife', target: 'chrome120',
  jsx: 'automatic', jsxImportSource: 'preact', logLevel: 'info'
});
