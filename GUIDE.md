# 🚀 ADHD Planer 2.0 — Kompletní Průvodce

Vítej v upgradované verzi tvého ADHD Planeru. Aplikace nyní funguje jako výkonný engine pro vizuální prototypování her, algoritmů a projektů.

---

## 🌓 1. Dual-Mode Systém
Aplikace má dva nezávislé renderery, mezi kterými můžeš přepínat v **Nastavení projektu**:

- **📁 DATA MÓD:** Čistý, přehledný styl pro strukturování poznámek a myšlenkových map. Gradientní uzly, status bar a badge pro počet poznámek.
- **🎲 SIMULAČNÍ MÓD:** Neonový "herní" styl. Obsahuje hex-grid (square-grid), **animovaný tok částic (Particle Flow)** na spojnicích, neonový glow a influence chain highlight.

---

## 🖱️ 2. Navigace a Ovládání
- **Posun (Pan):** Táhni levou myší na prázdném místě.
- **Zoom:** Kolečko myši. Přibližuje/oddaluje se tam, kde máš kurzor.
- **Minimapa:** V pravém dolním rohu vidíš náhled celého projektu. Modrý rámeček ukazuje tvůj aktuální výhled.
- **Výběr (Select):** Kliknutím na uzel ho vybereš. 
- **Vícenásobný výběr (Multi-select):** 
    - Držením **SHIFT + Klik** přidáváš/odebíráš uzly z výběru.
    - Držením **SHIFT + Táhnutí** na prázdném místě vytvoříš výběrový obdélník.

---

## 🔶 3. Uzly a Tvary
Pravým kliknutím na plochu nebo uzel otevřeš **Kontextové menu**:

- **Nové tvary:**
    - **Obdélník (Rectangle):** Standardní uzel.
    - **Kosočtverec (Diamond):** Rozhodovací bloky.
    - **Kruh (Circle):** Startovní/koncové body.
    - **Lichoběžník (Trapezoid):** Ruční vstupy / Operace.
    - **Válec (Cylinder):** Databáze / Inventář.
- **Obrázkové karty (🖼️):** Vloží obrázek jako samostatný uzel. Název uzlu se zobrazí jako elegantní štítek (badge) nad ním.

---

## 📏 4. Resizing a Grid Snapping
Každý vybraný uzel má v rozích manipulační body (čtverečky):

- **Změna velikosti:** Táhni za roh pro změnu šířky/výšky.
- **Grid Snapping:** Všechny objekty se automaticky přichytávají k mřížce již **během pohybu**, což zajišťuje dokonalé zarovnání.
- **Zámek poměru stran:**
    - **Obrázky:** Drží poměr stran automaticky.
    - **Ostatní tvary:** Drž **SHIFT** během resize pro rovnoměrné zvětšování.
    - *Tip: Držením Shiftu u obrázku zámek dočasně vypneš.*

---

## 🔗 5. Spojování (Edges)
- **Rychlé spojení:** 
    1. Klikni na uzel.
    2. Pravým klikni na jiný uzel.
    3. Vyber **"Spojit s vybraným"**.
- **Barvy a Logika:** V pravém panelu můžeš spojům měnit barvu (8 základních + 2 vlastní), tloušťku a směr. V simulaci barva určuje barvu letících částic.

---

## ⌨️ 6. Klávesové zkratky (Power User)
| Zkratka | Akce |
| :--- | :--- |
| **CTRL + Z** | **Zpět (Undo)** — až 50 kroků historie. |
| **CTRL + Y** | **Vpřed (Redo)**. |
| **CTRL + A** | Vybrat všechny uzly v projektu. |
| **DEL / BACKSPACE** | Smazat všechny vybrané uzly. |
| **SHIFT + Drag** | Výběr oblasti (Rubber-band selection). |

---

## 💾 7. Správa Projektů
- **Auto-save:** Projekt se automaticky ukládá každých 15 sekund na server.
- **Mazání projektů:** V Nastavení projektu (ikona ozubeného kola) najdeš tlačítko **Smazat projekt**, které ho trvale odstraní z disku.
- **Synchronizace:** Tlačítko **"Uložit synchro"** vpravo nahoře pro okamžité uložení.

---

> [!TIP]
> **Prototypování her:** Používej simulační mód pro vizualizaci vztahů mezi proměnnými (např. Inventář -> Vybavení -> Damage). Particle flow ti ukáže směr toku logiky.
