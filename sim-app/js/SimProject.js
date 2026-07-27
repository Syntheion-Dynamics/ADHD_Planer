import { SimNode, defaultSimVarsForKind, defaultSimMeta } from './SimNode.js';

export const SIM_SCHEMA_VERSION = 2;

export class SimProject {
    constructor(id, name = 'Sim projekt') {
        this.id = id;
        this.name = name;
        this.lastNodeId = 0;
        this.nodes = new Map();
    }

    generateId() {
        this.lastNodeId++;
        return `node_${Date.now()}_${this.lastNodeId}`;
    }

    addNode(title, x, y) {
        const id = this.generateId();
        const node = new SimNode(id, title, x, y);
        this.nodes.set(id, node);
        return node;
    }

    deleteNode(id) {
        this.nodes.delete(id);
        for (const node of this.nodes.values()) {
            node.removeEdge(id);
        }
    }

    getNode(id) {
        return this.nodes.get(id);
    }

    toJSON() {
        return {
            schemaVersion: SIM_SCHEMA_VERSION,
            kind: 'sim-studio-project',
            id: this.id,
            name: this.name,
            lastNodeId: this.lastNodeId,
            nodes: Array.from(this.nodes.values()).map((n) => this.serializeNode(n)),
        };
    }

    serializeNode(n) {
        return {
            id: n.id,
            title: n.title,
            shape: n.shape,
            x: n.x,
            y: n.y,
            width: n.width,
            height: n.height,
            color: n.color,
            nodeImage: n.nodeImage,
            status: n.status,
            statValue: n.statValue,
            simKind: n.simKind,
            simMeta: n.simMeta ? JSON.parse(JSON.stringify(n.simMeta)) : defaultSimMeta(),
            simVars: JSON.parse(JSON.stringify(n.simVars)),
            edges: n.edges.map((e) => ({ ...e })),
        };
    }

    static fromJSON(data) {
        const ver = data.schemaVersion || 1;
        const proj = new SimProject(data.id || `proj_${Date.now()}`, data.name || 'Sim projekt');
        proj.lastNodeId = data.lastNodeId || 0;
        proj.nodes.clear();
        const nodesArr = data.nodes || [];
        for (const raw of nodesArr) {
            const n = new SimNode(raw.id, raw.title, raw.x, raw.y);
            n.shape = raw.shape || 'rect';
            n.width = raw.width ?? 180;
            n.height = raw.height ?? 64;
            n.color = raw.color ?? null;
            n.nodeImage = raw.nodeImage ?? null;
            n.status = raw.status || 'none';
            n.statValue = raw.statValue ?? 0;
            n.simKind = raw.simKind || 'constant';
            n.simMeta = raw.simMeta && typeof raw.simMeta === 'object'
                ? { ...defaultSimMeta(), ...raw.simMeta }
                : defaultSimMeta();
            if (ver < 2) {
                n.simMeta = defaultSimMeta();
                if (n.simKind === 'actor') n.simMeta.role = 'npc';
            }
            n.simVars = Array.isArray(raw.simVars) && raw.simVars.length
                ? migrateSimVars(ver, raw.simVars, n.simKind)
                : defaultSimVarsForKind(n.simKind);
            n.edges = Array.isArray(raw.edges) ? raw.edges.map((e) => ({
                targetId: e.targetId,
                direction: e.direction || '->',
                color: e.color || 'neutral',
                label: e.label || '',
                thickness: e.thickness ?? 1,
                customColor: e.customColor ?? null,
                startSide: e.startSide || 'bottom',
                endSide: e.endSide || 'top',
                simChannel: e.simChannel || 'flow.number',
                transform: e.transform || '',
                sourceKey: e.sourceKey || '',
                targetKey: e.targetKey || '',
            })) : [];
            proj.nodes.set(n.id, n);
        }
        return proj;
    }

    /**
     * Export bez editor metadat — vhodné pro hru / import do PLANERu později
     */
    toGameBundle(initialState = null) {
        const graph = {
            schemaVersion: SIM_SCHEMA_VERSION,
            kind: 'sim-game-bundle',
            name: this.name,
            nodes: this.toJSON().nodes,
        };
        return {
            ...graph,
            initialState: initialState || null,
        };
    }
}

function migrateSimVars(ver, rawVars, kind) {
    if (ver >= 2) return rawVars;
    return rawVars.map((v) => ({
        ...v,
        type: v.type || 'number',
        group: v.group || 'data',
        exposeOut: v.exposeOut !== undefined ? v.exposeOut : true,
        exposeIn: v.exposeIn !== undefined ? v.exposeIn : kind === 'passthrough' || kind === 'stock',
    }));
}
