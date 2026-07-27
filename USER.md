# ADHD Planer — uživatelský návod (v0.1.0)

## Co to je

Lokální aplikace pro vizuální plánování a worldbuilding: canvas s uzly, timeline, poznámky / notebook, obrázky a hlavní dokument vedle plátna.

## Spuštění (desktop balíček)

1. Stáhni ZIP / portable `.exe` z itch.io.
2. Rozbal (pokud ZIP) a spusť **ADHD Planer**.
3. Není potřeba instalovat Python ani spouštět `server.py` ručně.

## Spuštění (vývojáři)

```bash
python server.py
# prohlížeč: http://127.0.0.1:8080/

# nebo Electron:
npm install
npm start
```

## Kde jsou data

- **Desktop (Electron):** `%APPDATA%\adhd-planer\` (nebo ekvivalent `userData`)
  - `Projects/` — JSON projektů + `*.master.html`
  - `Images/` — nahrané obrázky
  - `Documents/` — importované PDF/ODT
- **Dev (`python server.py`):** složky vedle `server.py` v kořeni projektu

## Základní ovládání

| Akce | Jak |
|------|-----|
| Nový uzel | Pravý klik na plátno |
| Sticky | Klávesa `T` |
| Uložit | `Ctrl+S` nebo „Uložit synchro“ |
| Timeline | Nastavení projektu → zapnout timeline |
| Simulace | Experimental / beta — v nastavení projektu |

## Známá omezení v0.1

- Bez cloudu, syncu a účtů — vše lokálně.
- Simulační mód je experimental.
- `sim-app/` je samostatný experiment mimo hlavní release.

## Licence

MIT — viz `LICENSE`. Third-party: `THIRD_PARTY_NOTICES.md`.
