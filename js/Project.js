import { ProjectNode } from './ProjectNode.js';

export class Project {
    /** Aktuální verze schématu serializace (zpětná kompatibilita v fromJSON). */
    static SCHEMA_VERSION = 1;

    constructor(id, name) {
        this.id = id;
        this.name = name;
        this.schemaVersion = Project.SCHEMA_VERSION;
        this.mode = 'data'; // 'data' | 'simulation'
        this.nodes = new Map();
        this.lastNodeId = 0;
        this.brainDump = null; // V3.0: Brain Dump — zápisník myšlenek při odchodu
        this.notebook = {
            pages: [
                {
                    id: `nb_${Date.now()}`,
                    title: 'Hlavní stránka',
                    content: '',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    linkedNodeId: null
                }
            ]
        };

        // V4.1 — Timeline
        this.timeline = {
            enabled: false,
            startYear: 2000,
            endYear: 2050,
            granularity: 'years' // 'years' | 'decades' | 'centuries'
        };

        /** Metadata hlavního dokumentu (HTML v Projects/{id}.master.html) */
        this.masterDocument = {
            title: 'Hlavní dokument',
            sourceType: null,
            sourceFileName: null,
            pdfPreviewUrl: null,
            updatedAt: null,
        };
        
        this.addNode("Root (Main)", window.innerWidth / 2 - 90, 100);
    }

    generateId() {
        this.lastNodeId++;
        return `node_${Date.now()}_${this.lastNodeId}`;
    }

    addNode(title, x, y) {
        const id = this.generateId();
        const node = new ProjectNode(id, title, x, y);
        this.nodes.set(id, node);
        return node;
    }

    deleteNode(id) {
        this.nodes.delete(id);
        for (let [_, node] of this.nodes) {
            node.removeEdge(id);
            node.childrenIds = node.childrenIds.filter(cid => cid !== id);
        }
    }

    getNode(id) {
        return this.nodes.get(id);
    }

    toJSON() {
        return {
            id: this.id,
            name: this.name,
            schemaVersion: this.schemaVersion || Project.SCHEMA_VERSION,
            mode: this.mode,
            lastNodeId: this.lastNodeId,
            brainDump: this.brainDump || null,
            notebook: this.notebook || { pages: [] },
            timeline: this.timeline || { enabled: false, startYear: 2000, endYear: 2050, granularity: 'years' },
            masterDocument: this.masterDocument || null,
            nodes: Array.from(this.nodes.values())
        };
    }

    static fromJSON(data) {
        const proj = new Project(data.id, data.name);
        // Legacy soubory bez pole = 0; neznámá budoucí pole ignorujeme, při uložení zapíšeme aktuální verzi
        proj.schemaVersion = Project.SCHEMA_VERSION;
        proj.lastNodeId = data.lastNodeId || 0;
        proj.mode = data.mode || 'data';
        proj.brainDump = data.brainDump || null; // V3.0
        proj.notebook = data.notebook || { pages: [] };
        if (!Array.isArray(proj.notebook.pages)) proj.notebook.pages = [];
        if (proj.notebook.pages.length === 0) {
            proj.notebook.pages.push({
                id: `nb_${Date.now()}`,
                title: 'Hlavní stránka',
                content: '',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                linkedNodeId: null
            });
        }
        proj.timeline = data.timeline || { enabled: false, startYear: 2000, endYear: 2050, granularity: 'years' }; // V4.1
        const md = data.masterDocument;
        proj.masterDocument = md && typeof md === 'object'
            ? {
                title: md.title || 'Hlavní dokument',
                sourceType: md.sourceType || null,
                sourceFileName: md.sourceFileName || null,
                pdfPreviewUrl: md.pdfPreviewUrl || null,
                updatedAt: md.updatedAt || null,
            }
            : {
                title: 'Hlavní dokument',
                sourceType: null,
                sourceFileName: null,
                pdfPreviewUrl: null,
                updatedAt: null,
            };
        proj.nodes.clear();
        
        for (let nData of data.nodes) {
            const node = new ProjectNode(nData.id, nData.title, nData.x, nData.y);
            
            node.shape = nData.shape || 'rect';
            node.status = nData.status || 'none';
            node.isPinned = nData.isPinned || false;
            node.statValue = nData.statValue || 0.0;
            node.nodeImage = nData.nodeImage || null;
            node.color = nData.color || null; // V2.4
            node.labelFontSize = nData.labelFontSize || 14; // V4.1
            node.lastEditedAt = nData.lastEditedAt || Date.now(); // V3.0: zpětná kompatibilita
            node.timelineDate = nData.timelineDate || null; // V4.1: Timeline datum

            if (node.shape === 'sticky') {
                if ('stickyText' in nData) {
                    node.stickyText = nData.stickyText || '';
                } else if (nData.title) {
                    const esc = String(nData.title)
                        .replace(/&/g, '&amp;')
                        .replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;');
                    node.stickyText = `<p>${esc}</p>`;
                } else {
                    node.stickyText = '';
                }
                node.stickyCreatedAt = nData.stickyCreatedAt
                    || (nData.lastEditedAt ? new Date(nData.lastEditedAt).toISOString() : null);
                node.stickyBgColor = nData.stickyBgColor || null;
                node.stickyTextColor = nData.stickyTextColor || null;
            }
            
            // V2.1 Geometry persistence
            if (nData.width) node.width = nData.width;
            if (nData.height) node.height = nData.height;

            if (nData.notes && Array.isArray(nData.notes)) {
                nData.notes.forEach(note => {
                    if (!note.updatedAt) note.updatedAt = note.date;
                    if (!note.tags) note.tags = [];
                    if (!note.fontSize) note.fontSize = 'small';
                });
                node.notes = nData.notes;
            } else if (nData.content !== undefined) {
                const legacyDate = new Date().toISOString();
                node.notes = [{
                    id: "note_legacy",
                    title: "Původní poznámka",
                    content: nData.content,
                    date: legacyDate,
                    updatedAt: legacyDate,
                    tags: [],
                    fontSize: 'small'
                }];
            }
            
            // v1.3 Zpětná kompatibilita - migrace childrenIds na Edges
            if (nData.edges && Array.isArray(nData.edges)) {
                node.edges = nData.edges.map(e => ({
                    targetId: e.targetId,
                    direction: e.direction || '->',
                    color: e.color || 'neutral',
                    label: e.label || '',
                    thickness: e.thickness || 1,
                    customColor: e.customColor || null
                }));
            } else {
                node.edges = [];
            }
            
            if (nData.childrenIds && Array.isArray(nData.childrenIds)) {
                nData.childrenIds.forEach(targetId => {
                    if (!node.edges.find(e => e.targetId === targetId)) {
                        node.addEdge(targetId);
                    }
                });
            }
            
            node.childrenIds = []; 
            proj.nodes.set(nData.id, node);
        }
        return proj;
    }
}
