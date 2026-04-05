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
        
        // V2.0 - Edges s rozšířenou paletou
        // edge objekt: { targetId, direction, color, customColor, label, thickness }
        this.edges = []; 
        
        // Stará kompatibilita (necháme prázdné a plní se při nahrávání starých grafů)
        this.childrenIds = []; 
        
        this.width = 180;
        this.height = 60;
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

    addEdge(targetId, direction = "->", color = "neutral", label = "", thickness = 1, customColor = null) {
        const existing = this.edges.find(e => e.targetId === targetId);
        if (existing) {
            existing.direction = direction;
            existing.color = color;
            existing.label = label;
            existing.thickness = thickness;
            existing.customColor = customColor;
        } else {
            this.edges.push({ targetId, direction, color, label, thickness, customColor });
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
