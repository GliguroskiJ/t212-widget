# T212 Widget

Desktopový widget pro Windows 10/11, který čte účet Trading 212 přes veřejné API (klíč + secret, jen čtení).
Design: Nocturne, směr **1a · Glass slate** (small, medium, large, rail + stavy loading / closed / error / first run).

## Build
```bash
npm install
npm run dist        # → dist/T212-Widget-Setup-<verze>.exe (NSIS, bez wine i na Linuxu)
npm start           # vývojové spuštění (Electron)
npm test            # test API klienta proti falešnému T212 serveru
```

## Struktura
- `main/` – Electron main process: okna, tray, autostart, nastavení, šifrované klíče (DPAPI), API poller, historie grafu
- `src/` – UI (Preact): `widget.jsx`, `settings.jsx`, `shared.js` (tokeny, motivy, grafy)
- `static/` – HTML, Nocturne CSS, lokální fonty/ikony se kopírují do `app/` při buildu
- `scripts/` – build UI, ikona, afterPack (ikona exe přes resedit), testy, náhledy

## Data
- `/api/v0/equity/account/summary` (hodnota, cash, P/L), `/api/v0/equity/positions`, `/api/v0/equity/history/dividends`
- Nastavení, historie grafu a šifrované klíče: `%APPDATA%\T212 Widget\`
- API nemá historii hodnoty portfolia → graf se nahrává lokálně od první synchronizace; denní P/L se počítá od poslední hodnoty před půlnocí.
- Změna u hodnoty se řídí zvoleným obdobím grafu (1D/1W/1M/1Y/ALL) a počítá se z rozdílu P/L, takže vklady a výběry ji nezkreslí. Když historie ještě nesahá tak daleko, ukazuje se „od <datum>“. ALL = celkový P/L.
- Najetím myší na graf se ukáže hodnota portfolia v danou chvíli a změna od začátku období (body doplněné z tržních cen jsou označené „odhad“).

## Bezpečnost
- **API klíč nikdy neopouští počítač.** Ukládá se jen do `credentials.bin` v datové složce aplikace (mimo projekt),
  šifrovaně přes Windows DPAPI / macOS Keychain. Když šifrování není k dispozici, klíč se neuloží vůbec — nikdy ne jako čistý text.
  Do okna (rendereru) se nevrací, neloguje se a posílá se jen na `live/demo.trading212.com` přes HTTPS.
- V repu ani v CI žádné klíče nejsou (testy používají smyšlené `KEY`/`SECRET`); `.gitignore` navíc blokuje soubory s daty aplikace.
- Testovací přepínače adres (`T212_BASE`, `T212_UPDATE_API`) fungují jen v testech, v nainstalované aplikaci se ignorují.
- Okna: sandbox, contextIsolation, přísná CSP, žádná navigace ani nová okna; externí odkazy jen na trading212.com a github.com.
- Aktualizace: instaluje se jen po potvrzení a jen soubor, jehož SHA-256 sedí s vydáním. Žádné přihlašovací údaje ke GitHubu aplikace nemá.

## Aktualizace
Aplikace sama hlídá GitHub Releases: při spuštění (tedy i po zapnutí počítače), po probuzení ze spánku,
každý den ve 12:00 a na tlačítko *Zkontrolovat aktualizace* (Nastavení → Systém, nebo menu v tray).
Když najde novější verzi, zeptá se — **Stáhnout a nainstalovat / Teď ne / Přeskočit tuto verzi**.
Stažený soubor se ověří proti velikosti a SHA-256 z vydání, pak:
- **Windows** — spustí se instalátor potichu (`/S --updated --force-run`), přepíše aplikaci a znovu ji spustí.
- **macOS** — rozbalí se `.zip`, po ukončení aplikace ji skript vymění (stará verze zůstane, dokud není nová na místě) a otevře.
  Aplikace musí běžet ze složky, kam může zapisovat (typicky `Aplikace`), ne přímo ze Stažených.

Aktualizace čtou veřejné GitHub Releases — **repozitář musí být veřejný** (žádný token se v aplikaci nezadává).
Dotaz i stahování probíhají v okně ve stylu aplikace (pozadí, barva, text podle nastavení).
`main/updater.js` + `src/update.jsx`, test: `node scripts/test-updater.js`, smoke v Electronu: `xvfb-run electron --no-sandbox scripts/smoke-update.js`.

## macOS
Stejná aplikace běží i na Macu: ikona v horní liště (klik = panel s widgetem, pravý klik = menu),
volitelně i plovoucí widget na ploše. `npm run dist:mac` (na Linuxu vznikne .app, podepsat ad-hoc přes `rcodesign sign`).

## GitHub build
`.github/workflows/build.yml` — po pushnutí tagu `vX.Y.Z` GitHub sestaví Windows instalátor i macOS aplikace
(arm64 + x64, .zip a .dmg) a přiloží je k Release.
