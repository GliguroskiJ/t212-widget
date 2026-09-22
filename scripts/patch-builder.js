// electron-builder normally needs wine on Linux to extract the NSIS uninstaller.
// Its macOS path does it in pure JS (UninstallerReader) — enable that path everywhere.
const fs = require('fs');
const f = require.resolve('app-builder-lib/out/targets/nsis/NsisTarget.js');
let s = fs.readFileSync(f, 'utf8');
if (s.includes('(0, macosVersion_1.isMacOsCatalina)()) {\n            try {\n                await nsisUtil_1.UninstallerReader')) {
  s = s.replace('if ((0, macosVersion_1.isMacOsCatalina)()) {\n            try {\n                await nsisUtil_1.UninstallerReader', 'if (process.platform !== "win32") {\n            try {\n                await nsisUtil_1.UninstallerReader');
  fs.writeFileSync(f, s);
  console.log('patched', f);
} else console.log('already patched or layout changed');
