import { ProjectNode } from './ProjectNode.js';

export class Project {
    constructor(id, name) {
        this.id = id;
        this.name = name;
        this.mode = 'data'; // 'data' | 'simulation'
        this.nodes = new Map();
        this.lastNodeId = 0;
        
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
            mode: this.mode,
            lastNodeId: this.lastNodeId,
            nodes: Array.from(this.nodes.values())
        };
    }

    static fromJSON(data) {
        const proj = new Project(data.id, data.name);
        proj.lastNodeId = data.lastNodeId || 0;
        proj.mode = data.mode || 'data';
        proj.nodes.clear();
        
        for (let nData of data.nodes) {
            const node = new ProjectNode(nData.id, nData.title, nData.x, nData.y);
            
            node.shape = nData.shape || 'rect';
            node.status = nData.status || 'none';
            node.isPinned = nData.isPinned || false;
            node.statValue = nData.statValue || 0.0;
            node.nodeImage = nData.nodeImage || null;

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
