# ADHD Planer — dokumentace aplikace

## Co to je

**ADHD Planer** je lokální webová aplikace pro plánování herních (nebo obecných) projektů s důrazem na vizuální myšlenkovou mapu, poznámky a režim simulace. Běží v prohlížeči a ukládá data přes malý **Python server** na `localhost` (výchozí port **8080**).

---

## Spuštění

1. **Python** (stdlib stačí pro základ; pro import PDF hlavního dokumentu: `pip install -r requirements.txt`, hlavně **pypdf**).
2. V kořeni projektu spustit **`server.py`** — slouží jako statický server + API.
3. Otevřít aplikaci v prohlížeči (typicky `http://127.0.0.1:8080/`).

Server přijímá požadavky **jen z localhostu** (bezpečnostní omezení).

---

## Hlavní funkce (hlavní aplikace)

| Oblast | Popis |
|--------|--------|
| **Projekty (záložky)** | Více projektů vedle sebe; nový projekt, přepínání, mazání přes API. |
| **Canvas (režim „data“)** | Uzly různých tvarů (obdélník, kosočtverec, kruh, šestiúhelník, pilulka, sticky), hrany mezi uzly, barvy, kontextové menu, připínání uzlů, pod-uzly, vkládání obrázků. |
| **Režim simulace** | Přepnutí projektu do `simulation` módu; vykreslení přes `SimulationRenderer.js`. |
| **Timeline** | Volitelná časová osa (roky / desetiletí / století), události, nastavení rozsahu. |
| **Zápisník / notebook** | Více stránek, propojení s uzly; úpravy v `EditorController.js`. |
| **Brain dump** | Krátký „zápisník myšlenek“ při odchodu od projektu; při návratu banner s obsahem minulé relace. |
| **Hlavní dokument** | Rich text panel vedle canvasu; import **PDF** nebo **ODT** (PDF přes server + pypdf na text/HTML); uložení jako `Projects/{id}.master.html`; volitelný náhled PDF v iframe. |
| **Vyhledávání** | Hledání uzlů v horní liště. |
| **Témata** | Přepínání světlý / tmavý režim. |
| **Uložení** | Automatická synchronizace + tlačítko „Uložit synchro“; export/nastavení v sekci aplikace. |

---

## Datový model (zjednodušeně)

- **`Project`** (`js/Project.js`): id, název, `mode` (`data` \| `simulation`), uzly, `brainDump`, `notebook`, `timeline`, metadata `masterDocument`, serializace do JSON.
- **`ProjectNode`** (`js/ProjectNode.js`): jednotlivý uzel — geometrie, hrany, poznámky, děti, pomocné metody.

---

## Architektura souborů (hlavní app)

| Soubor | Role |
|--------|------|
| `index.html` | UI, panely, modály, canvas elementy. |
| `style.css` | Vzhled. |
| `js/main.js` | Orchestrace, záložky, zkratky, persistence, timeline setup, kontextové akce. |
| `js/CanvasRenderer.js` | Kreslení a interakce v datovém módu, minimapa. |
| `js/SimulationRenderer.js` | Simulační mód na canvasu. |
| `js/TimelineRenderer.js` | Vykreslení timeline panelu. |
| `js/EditorController.js` | Pravý panel — poznámky uzlů, notebook. |
| `js/MasterDocController.js` | Hlavní dokument (toolbar, import, odkaz na uzel). |
| `server.py` | HTTP server, API, složky `Projects/`, `Images/`, `Documents/`. |

---

## Backend API (`server.py`)

- **`GET /api/load-projects`** — načtení seznamu / projektů.
- **`GET /api/master-doc?id=…`** — načtení uloženého hlavního dokumentu.
- **`POST /api/save-project`** — uložení projektu (JSON, limity velikosti).
- **`POST /api/delete-project`** — smazání projektu.
- **`POST /api/upload-image`** — nahrání obrázku (base64), ukládání do `Images/`.
- **`POST /api/save-master`** — uložení HTML hlavního dokumentu.
- **`POST /api/import-master`** — import PDF/ODT → HTML (ODT přes stdlib zip + XML; PDF přes **pypdf**).

Statické soubory (HTML, JS, CSS) obsluhuje stejný handler; hlavičky zakazují agresivní cacheování v dev režimu.

---

## Složky na disku

- **`Projects/`** — uložené projekty a soubory `*.master.html` pro hlavní dokument.
- **`Images/`** — nahrané obrázky z canvasu.
- **`Documents/`** — související dokumenty (dle použití / importu).

---

## `sim-app/` (Sim Studio)

Samostatná malá aplikace (`sim-app/index.html` + vlastní JS) pro **simulační studio**: archetypy uzlů, proměnné (skupiny jako stats, narrative, equipment…), krok simulace (`SimulationEngine.js`), ukládání do **localStorage** (`sim-studio-project-v2`). Je to spíš experimentální / oddělený nástroj vedle hlavního Planeru, ne centralizované uložení přes `server.py`.

---

## Tipy pro úpravy kódu

- Chování canvasu → `CanvasRenderer.js` + akce v `main.js`.
- Editor / notebook → `EditorController.js` + id v `index.html`.
- Persistence / API → `main.js` + `Project.js` + `server.py`.
- Timeline → `TimelineRenderer.js` + `main.js`.

Detailnější mapa pro AI / vývojáře: `docs/ai-map/architecture.md`, `docs/ai-map/entrypoints.md`.
