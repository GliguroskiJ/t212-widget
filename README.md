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

## macOS
Stejná aplikace běží i na Macu: ikona v horní liště (klik = panel s widgetem, pravý klik = menu),
volitelně i plovoucí widget na ploše. `npm run dist:mac` (na Linuxu vznikne .app, podepsat ad-hoc přes `rcodesign sign`).

## GitHub build
`.github/workflows/build.yml` — po pushnutí tagu `vX.Y.Z` GitHub sestaví Windows instalátor i macOS aplikace
(arm64 + x64, .zip a .dmg) a přiloží je k Release.
