// V2.0 — Rozšířená paleta barev hran pro herní plánování
export const EDGE_COLORS = {
    neutral:     { hex: '#94a3b8', label: '⚪ Neutrální',    labelShort: 'Klidná' },
    positive:    { hex: '#10b981', label: '🟢 Posiluje (+)', labelShort: 'Hraje Roli (+)' },
    negative:    { hex: '#ef4444', label: '🔴 Blokuje (-)',  labelShort: 'Blokuje (-)' },
    dependency:  { hex: '#3b82f6', label: '🔵 Závisí na',    labelShort: 'Závisí na' },
    optional:    { hex: '#f59e0b', label: '🟡 Volitelný',    labelShort: 'Volitelný' },
    special:     { hex: '#8b5cf6', label: '🟣 Speciální',    labelShort: 'Speciální' },
    conditional: { hex: '#f97316', label: '🟠 Podmíněný',    labelShort: 'Podmíněný' },
    dataflow:    { hex: '#06b6d4', label: '🩵 Datový tok',   labelShort: 'Datový tok' },
    custom1:     { hex: '#ff6b9d', label: '🎨 Custom 1',     labelShort: 'Custom 1' },
    custom2:     { hex: '#c084fc', label: '🎨 Custom 2',     labelShort: 'Custom 2' },
};

export class ProjectNode {
    constructor(id, title = "Nový Uzel", x = 0, y = 0) {
        this.id = id;
        this.title = title;
        this.shape = 'rect';
        
        // V1.3 RPG & Status vlastnosti
        this.status = 'none'; // none, todo, progress, done, blocked
        this.isPinned = false; 
        this.statValue = 0.0;
        
        // V2.0 — Thumbnail obrázek na uzlu (URL pro zobrazení na canvasu v simulaci)
        this.nodeImage = null;
        this.color = null; // V2.4: Vlastní barva rámečku (hex)
        this.labelFontSize = 14; // V4.1: Velikost písma popisku uzlu (px, range 8-32)
        
        this.notes = [
            {
                id: "note_" + Date.now(),
                title: "Hlavní poznámka",
                content: "",
                date: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                tags: [],
                fontSize: 'small'
            }
        ];
        
        this.x = x;
        this.y = y;
        
        // V2.1 — Resizing a nové tvary
        // tvary: 'rect', 'diamond', 'circle', 'hexagon', 'pill', 'image', 'sticky'
        this.width = 180;
        this.height = 60;
        
        // V2.0 - Edges s rozšířenou paletou
        // edge objekt: { targetId, direction, color, customColor, label, thickness }
        this.edges = []; 
        
        // Stará kompatibilita (necháme prázdné a plní se při nahrávání starých grafů)
        this.childrenIds = [];

        // V3.0 — Heatmap: kdy byl napřídy editován
        this.lastEditedAt = Date.now();

        // V4.1 — Timeline: datum eventu (string YYYY nebo YYYY-MM nebo null)
        this.timelineDate = null;

        // Sticky note: rich HTML tělo + čas vytvoření (pečeť na plátně)
        this.stickyText = '';
        this.stickyCreatedAt = null;
        /** @type {string|null} hex — null = téma (světlý/tmavý) */
        this.stickyBgColor = null;
        /** @type {string|null} hex — null = výchozí kontrast k pozadí */
        this.stickyTextColor = null;
    }

    /** Plain text z HTML pro canvas wrap / vyhledávání (zachová Enter / odstavce jako \n) */
    static stickyPlainText(html) {
        if (!html) return '';
        if (typeof document !== 'undefined') {
            const el = document.createElement('div');
            el.innerHTML = html;
            let t = (el.innerText ?? el.textContent ?? '')
                .replace(/\r\n/g, '\n')
                .replace(/\u00a0/g, ' ');
            t = t.replace(/\n{3,}/g, '\n\n');
            return t;
        }
        const doc = new DOMParser().parseFromString(html, 'text/html');
        return (doc.body.textContent || '').replace(/\u00a0/g, ' ');
    }

    /** Word-wrap pro měření textu na canvasu (ctx.measureText) */
    static wrapStickyPlainLines(ctx, text, maxWidth) {
        const lines = [];
        const paragraphs = (text || '').split(/\n/);
        for (let pi = 0; pi < paragraphs.length; pi++) {
            const words = paragraphs[pi].split(/\s+/).filter(Boolean);
            let current = '';
            for (const word of words) {
                const test = current ? `${current} ${word}` : word;
                if (ctx.measureText(test).width > maxWidth && current) {
                    lines.push(current);
                    current = word;
                } else {
                    current = test;
                }
            }
            if (current) lines.push(current);
            if (words.length === 0 && pi < paragraphs.length - 1) lines.push('');
        }
        return lines;
    }

    // V2.2 — Pomocník pro hitboxy a kreslení (upraveno pro přesnější circle hitbox)
    getBounds() {
        let w = this.width;
        let h = this.height;
        let x = this.x;
        let y = this.y;

        if (this.shape === 'diamond') {
            w *= 1.5;
            h *= 1.5;
            x -= this.width * 0.25;
            y -= this.height * 0.25;
        } else if (this.shape === 'circle') {
            const r = Math.min(this.width, this.height) / 2;
            x = this.x + this.width / 2 - r;
            y = this.y + this.height / 2 - r;
            w = r * 2;
            h = r * 2;
        }
        return { x, y, w, h };
    }

    // V2.2 — vrací bod spojení na základě dané strany (top, bottom, left, right, center)
    getSidePoint(side = "center") {
        const b = this.getBounds();
        switch (side) {
            case "top":    return { x: b.x + b.w/2, y: b.y };
            case "bottom": return { x: b.x + b.w/2, y: b.y + b.h };
            case "left":   return { x: b.x, y: b.y + b.h/2 };
            case "right":  return { x: b.x + b.w, y: b.y + b.h/2 };
            default:       return { x: b.x + b.w/2, y: b.y + b.h/2 };
        }
    }

    // V2.2 — vrací ID strany, která je nejblíže danému světovému bodu
    getNearestSide(worldPoint) {
        const sides = ["top", "bottom", "left", "right"];
        let bestSide = "top";
        let minDist = Infinity;
        for (let s of sides) {
            const p = this.getSidePoint(s);
            const d = Math.sqrt((p.x - worldPoint.x)**2 + (p.y - worldPoint.y)**2);
            if (d < minDist) {
                minDist = d;
                bestSide = s;
            }
        }
        return bestSide;
    }


    addNote() {
        const d = new Date().toISOString();
        const newNote = {
            id: "note_" + Date.now() + "_" + Math.floor(Math.random()*1000),
            title: "Nová poznámka",
            content: "",
            date: d,
            updatedAt: d,
            tags: [],
            fontSize: 'small'
        };
        this.notes.push(newNote);
        return newNote;
    }

    deleteNote(noteId) {
        if (this.notes.length > 1) {
            this.notes = this.notes.filter(n => n.id !== noteId);
        }
    }

    // V2.2 — přidána podpora pro strany startSide a endSide
    addEdge(targetId, direction = "->", color = "neutral", label = "", thickness = 1, customColor = null, startSide = "bottom", endSide = "top") {
        const existing = this.edges.find(e => e.targetId === targetId);
        if (existing) {
            existing.direction = direction;
            existing.color = color;
            existing.label = label;
            existing.thickness = thickness;
            existing.customColor = customColor;
            existing.startSide = startSide;
            existing.endSide = endSide;
        } else {
            this.edges.push({ targetId, direction, color, label, thickness, customColor, startSide, endSide });
        }
    }

    removeEdge(targetId) {
        this.edges = this.edges.filter(e => e.targetId !== targetId);
    }
    
    // Staré kvůli kompatibilitě
    addChild(childId) {
        this.addEdge(childId);
    }

    removeChild(childId) {
        this.removeEdge(childId);
    }

    // V2.0 — Resolved barva hrany (vrátí hex string)
    static resolveEdgeColor(edge, opacity = 1.0) {
        if ((edge.color === 'custom1' || edge.color === 'custom2') && edge.customColor) {
            return edge.customColor;
        }
        const def = EDGE_COLORS[edge.color] || EDGE_COLORS.neutral;
        return def.hex;
    }
}
