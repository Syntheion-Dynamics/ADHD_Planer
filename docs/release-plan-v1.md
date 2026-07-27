# Release Plán v1 — ADHD Planer

_Poslední aktualizace: 2026-07-27_

## Pevná rozhodnutí

| Otázka | Rozhodnutí |
|--------|-----------|
| Balení | Electron + Python sidecar (server.py) |
| Data | OS app-data (`userData`), ne repo složka |
| Backend API | Nezměněný `/api/*` kontrakt |
| Distribuce | itch.io, PWYW ~5 € |
| Jazyk UI | Čeština; anglický itch.io popis |
| Scope v1 | Canvas, timeline, notes, notebook, obrázky, master doc |
| Mimo v1 | sim-app (označit "experimental/beta"), cloud, auth |

## Definice hotového produktu (Definition of Done)

Před vydáním musí platit **všechna** kritéria:

### Spustitelnost
- [x] Uživatel stáhne ZIP z itch.io, rozbalí, dvakrát klikne → app běží bez ručního `python server.py` _(implementováno v kódu; ověřit po `npm run dist`)_
- [x] Python sidecar se spustí automaticky z Electronu a při zavření appky se sám ukončí
- [x] PORT je dynamický nebo fixní s fallbackem; žádný konflikt na standardním portu

### Data a persistence
- [x] Projekty se ukládají do OS `userData`, ne do repo adresáře
- [ ] Starý projekt (JSON z dev verze) se načte správně (zpětná kompatibilita) — ruční smoke
- [x] `schemaVersion` pole přidáno do serializace v `js/Project.js`

### Klíčové funkce (smoke test)
- [ ] Vytvořit / přejmenovat / smazat uzel
- [ ] Sticky note (klávesa T)
- [ ] Připnout uzel (📌)
- [ ] Notebook — vytvořit stránku, napsat text, přepnout stránku
- [ ] Nahrát obrázek do uzlu (přes context menu nebo drag)
- [ ] Timeline — zapnout, posunout se v čase, event na uzlu
- [ ] Master dokument — napsat text, importovat PDF, odkaz na uzel
- [ ] Uložit projekt (Ctrl+S / autosave) a znovu načíst → data identická

### UX & onboarding
- [x] Onboarding hláška při prvním startu: pravý klik = uzel, T = sticky, Ctrl+S = uložit
- [x] Simulation mode označen jako "experimental" nebo skrytý v tab baru

### Bezpečnost
- [x] HTML sanitizace v editor write i read path (`js/EditorController.js`, `js/MasterDocController.js`)
- [x] API payload limity fungují; UI zobrazí toast při 413/400

### Balíček
- [ ] Windows portable ZIP + embedded Python (uživatel nepotřebuje instalovat Python) — `npm run dist` po `prepare:python`
- [x] `LICENSE` přiložen
- [x] Third-party notices (pypdf)
- [x] `CHANGELOG.md` aktualizován na verzi `0.1.0`

### Itch materiály
- [ ] 3–5 screenshotů (canvas, timeline, notes, worldbuilding příklad)
- [x] Itch page: CZ/EN krátký popis, PWYW nastaven _(draft v `docs/itch-page-draft.md`)_

---

## Fáze implementace

### Fáze 1 — Zúžení a polish (1–2 večery)
**Soubory:** `index.html`, `js/main.js`, `style.css`, `CHANGELOG.md`

1. Označit simulation mode jako "experimental" v UI (badge nebo přesunout za beta toggle)
2. Onboarding hláška (localStorage flag `planer_onboarded`) při prvním startu
3. Smoke test podle checklistu výše
4. Verze `0.1.0` do `CHANGELOG.md`

### Fáze 2 — Electron shell + sidecar (2–3 večery)
**Nové soubory:** `package.json`, `electron/main.js`, `electron/preload.js`
**Upravit:** `server.py` (PORT z env, datové cesty z `PLANER_DATA_DIR`)

```
electron/
  main.js       ← spawn sidecar, load renderer, quit hook
  preload.js    ← contextIsolation: true, nodeIntegration: false
package.json    ← electron + electron-builder deps
```

Main process flow:
1. Najdi volný port
2. Spawn `python sidecar/server.py` s `env PORT=X, PLANER_DATA_DIR=userData`
3. Čekej na `/api/ping` (max 5s)
4. Načti `http://127.0.0.1:X/`
5. Na `before-quit` → kill sidecar

Dev workflow zachovat: `python server.py` v prohlížeči funguje beze změny.

### Fáze 3 — Portable Windows build (1–2 večery)

- `electron-builder` NSIS nebo **portable ZIP** (preferováno pro v1)
- Embeddable Python sidecar (python-embeddable Windows build)
- Ověřit že datové cesty fungují v `%APPDATA%` po rozbalení
- Testovat na čistém stroji / VM (bez VS Code, bez Python v PATH)

### Fáze 4 — Itch materiály (1 večer)

- README pro uživatele (co to je, jak spustit, kde jsou data)
- Screenshoty
- Itch page draft

---

## Nápady mimo v1 (backlog)

Tyto nápady jsou dobré ale patří do v1.1+:

| Nápad | Proč ne teď |
|-------|------------|
| Kalendář-canvas (každý den = node) | Velká feature, potřebuje nový typ uzlu + generátor |
| Floatable/detachable panely | UI refaktor, netriviální |
| IndexedDB přepis | Velká migrace, v1 funguje bez ní |
| Cloud sync | Post-validace trhu |
| Code signing + auto-update | Post-v1 |

---

## Odhad

| Fáze | Večery |
|------|--------|
| 1 — Scope + polish | 1–2 |
| 2 — Electron + sidecar | 2–3 |
| 3 — Portable build | 1–2 |
| 4 — Itch | 1 |
| **Celkem** | **~5–8** |
