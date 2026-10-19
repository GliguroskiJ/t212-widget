# T212 Widget

Desktopový widget a aplikace pro Windows 10/11 a macOS, které čtou účet Trading 212 přes veřejné API (klíč + secret, **jen čtení**).
Design: Nocturne, směr **1a · Glass slate** — widget i aplikace sdílí stejné komponenty, motiv, barvu i text.

## Aplikace (od 1.8.0)
Otevře se z tray (*Otevřít aplikaci*, dvojklik), z menu widgetu nebo druhým spuštěním programu. Nic neobjednává ani neruší.
- **Přehled** — hodnota portfolia s grafem (vlastní období 1D–ALL, hover), hotovost, investováno, nerealizovaný/realizovaný zisk,
  dividendy letos, čisté vklady, top pozice, alokace (pozice / měna / trh), dnešní pohyby, poslední aktivita.
- **Pozice** — řaditelná tabulka (počet, průměrná cena, cena, dnes, hodnota, zisk, váha), filtr. Klik → **detail instrumentu**:
  cenový graf z Yahoo Finance (1D–MAX) s čarou průměrné nákupní ceny, burza a obchodní hodiny, vaše obchody, dividendy, čekající příkazy.
- **Aktivita** — obchody (poplatky, realizovaný zisk), dividendy (po měsících, největší plátci, výnos z nákladů), vklady a výběry.
- **Příkazy** — čekající příkazy (jen zobrazení). **Koláče** — výsledek, cíl, složení aktuální vs. cílové. **Reporty** — CSV export z Trading 212 se stažením.
- **Nastavení** celé aplikace (Účet, Vzhled, Data, Systém) + záložka **Widget** jen pro widget. Hledání instrumentů: Ctrl/⌘ K.

Potřebná oprávnění klíče: Account data, Portfolio; volitelně History – Orders / Dividends / Transactions, Orders – Read, Pies – Read, Metadata.
Co klíč nemá, to se ukáže jen jako zamčená sekce. *Orders – Execute* a *Pies – Write* nezaškrtávejte.

## Build
```bash
npm install
npm run dist        # → dist/T212-Widget-Setup-<verze>.exe (NSIS, bez wine i na Linuxu)
npm start           # vývojové spuštění (Electron)
npm test            # test API klienta proti falešnému T212 serveru
```

## Struktura
- `main/` – Electron main process: okna, tray, autostart, nastavení, šifrované klíče (DPAPI), API poller, historie grafu
- `main/library.js` – historie (inkrementální sync do `activity.json`), příkazy, koláče, metadata, reporty, ceny z Yahoo; `main/limiter.js` – limity API po endpointech
- `src/` – UI (Preact): `widget.jsx`, `app.jsx` (okno aplikace), `ui.jsx` (sdílené komponenty), `settings-tabs.jsx`, `shared.js` (tokeny, motivy, grafy)
- `static/` – HTML, Nocturne CSS, lokální fonty/ikony se kopírují do `app/` při buildu
- `scripts/` – build UI, ikona, afterPack (ikona exe přes resedit), testy, náhledy

## Data
- `/api/v0/equity/account/summary` (hodnota, cash, P/L), `/api/v0/equity/positions`, `/api/v0/equity/history/dividends`
- Aplikace navíc: `/equity/history/orders|transactions|exports`, `/equity/orders`, `/equity/pies`, `/equity/metadata/instruments|exchanges`
  — každý endpoint má vlastní frontu podle limitu Trading 212, 429 se počká a zopakuje. Historie se stahuje jednou, pak jen nové položky.
- Nastavení, historie grafu, stažená historie účtu (`activity.json`, `metadata.json`) a šifrované klíče: `%APPDATA%\T212 Widget\`
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
- Aplikace volá jen čtecí endpointy (test to hlídá); jediný POST je žádost o CSV report. Data z API smí číst jen okno aplikace, metody jsou na whitelistu.
  CSV se stahuje z předpodepsaného odkazu bez API klíče a ukládá jen tam, kam ho uložíte.
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
