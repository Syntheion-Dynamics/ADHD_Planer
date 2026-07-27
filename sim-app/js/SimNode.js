// Základ z PLANER ProjectNode — zjednodušený model + sim meta

export const EDGE_COLORS = {
    neutral: { hex: '#94a3b8' },
    positive: { hex: '#10b981' },
    negative: { hex: '#ef4444' },
    dependency: { hex: '#3b82f6' },
    dataflow: { hex: '#06b6d4' },
    custom1: { hex: '#ff6b9d' },
    custom2: { hex: '#c084fc' },
};

export const SIM_KINDS = ['constant', 'passthrough', 'combat', 'stock', 'actor'];

export const ACTOR_ROLES = ['player', 'npc', 'enemy', 'friendly'];

export function defaultSimMeta() {
    return { role: 'npc', archetypeId: '', tags: [] };
}

/** @returns {Array<{id:string,type:string,default:any,group?:string,exposeOut?:boolean,exposeIn?:boolean}>} */
export function defaultSimVarsForKind(kind) {
    switch (kind) {
        case 'constant':
            return [{ id: 'out', type: 'number', default: 10, group: 'data', exposeOut: true, exposeIn: false }];
        case 'passthrough':
            return [{ id: 'out', type: 'number', default: 0, group: 'data', exposeOut: true, exposeIn: true }];
        case 'combat':
            return [
                { id: 'hp', type: 'number', default: 100, group: 'stats', exposeOut: true, exposeIn: true },
                { id: 'armor', type: 'number', default: 5, group: 'stats', exposeOut: true, exposeIn: true },
            ];
        case 'stock':
            return [{ id: 'count', type: 'number', default: 0, group: 'data', exposeOut: true, exposeIn: true }];
        case 'actor':
            return [
                { id: 'str', type: 'number', default: 10, group: 'stats', exposeOut: true, exposeIn: true },
                { id: 'dex', type: 'number', default: 10, group: 'stats', exposeOut: true, exposeIn: true },
                { id: 'con', type: 'number', default: 10, group: 'stats', exposeOut: true, exposeIn: true },
                { id: 'int', type: 'number', default: 10, group: 'stats', exposeOut: true, exposeIn: true },
                { id: 'wis', type: 'number', default: 10, group: 'stats', exposeOut: true, exposeIn: true },
                { id: 'cha', type: 'number', default: 10, group: 'stats', exposeOut: true, exposeIn: true },
                { id: 'hp', type: 'number', default: 12, group: 'stats', exposeOut: true, exposeIn: true },
                { id: 'maxHp', type: 'number', default: 12, group: 'stats', exposeOut: true, exposeIn: true },
                { id: 'ac', type: 'number', default: 10, group: 'stats', exposeOut: true, exposeIn: true },
                { id: 'storyNotes', type: 'string', default: '', group: 'narrative', exposeOut: true, exposeIn: true },
                { id: 'currentWeapon', type: 'string', default: '', group: 'equipment', exposeOut: true, exposeIn: true },
                { id: 'mapId', type: 'string', default: 'main', group: 'world', exposeOut: true, exposeIn: true },
                { id: 'posX', type: 'number', default: 0, group: 'world', exposeOut: true, exposeIn: true },
                { id: 'posY', type: 'number', default: 0, group: 'world', exposeOut: true, exposeIn: true },
                {
                    id: 'inventory',
                    type: 'inventory',
                    default: { slots: [], maxSlots: 20 },
                    group: 'equipment',
                    exposeOut: false,
                    exposeIn: false,
                },
            ];
        default:
            return [{ id: 'out', type: 'number', default: 0, group: 'data', exposeOut: true, exposeIn: false }];
    }
}

export class SimNode {
    constructor(id, title = 'Uzel', x = 0, y = 0) {
        this.id = id;
        this.title = title;
        this.shape = 'rect';
        this.x = x;
        this.y = y;
        this.width = 180;
        this.height = 64;
        this.color = null;
        this.nodeImage = null;
        this.status = 'none';
        this.statValue = 0;

        this.edges = [];
        this.simKind = 'constant';
        this.simVars = defaultSimVarsForKind('constant');
        this.simMeta = defaultSimMeta();
    }

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

    getSidePoint(side = 'center') {
        const b = this.getBounds();
        switch (side) {
            case 'top':
                return { x: b.x + b.w / 2, y: b.y };
            case 'bottom':
                return { x: b.x + b.w / 2, y: b.y + b.h };
            case 'left':
                return { x: b.x, y: b.y + b.h / 2 };
            case 'right':
                return { x: b.x + b.w, y: b.y + b.h / 2 };
            default:
                return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
        }
    }

    getNearestSide(worldPoint) {
        const sides = ['top', 'bottom', 'left', 'right'];
        let best = 'top';
        let min = Infinity;
        for (const s of sides) {
            const p = this.getSidePoint(s);
            const d = Math.hypot(p.x - worldPoint.x, p.y - worldPoint.y);
            if (d < min) {
                min = d;
                best = s;
            }
        }
        return best;
    }

    addEdge(targetId, opts = {}) {
        const {
            direction = '->',
            color = 'neutral',
            label = '',
            thickness = 1,
            customColor = null,
            startSide = 'bottom',
            endSide = 'top',
            simChannel = 'flow.number',
            transform = '',
            sourceKey = '',
            targetKey = '',
        } = opts;
        const existing = this.edges.find((e) => e.targetId === targetId);
        if (existing) {
            Object.assign(existing, {
                direction,
                color,
                label,
                thickness,
                customColor,
                startSide,
                endSide,
                simChannel,
                transform,
                sourceKey,
                targetKey,
            });
        } else {
            this.edges.push({
                targetId,
                direction,
                color,
                label,
                thickness,
                customColor,
                startSide,
                endSide,
                simChannel,
                transform,
                sourceKey,
                targetKey,
            });
        }
    }

    removeEdge(targetId) {
        this.edges = this.edges.filter((e) => e.targetId !== targetId);
    }

    static resolveEdgeColor(edge, opacity = 1) {
        if ((edge.color === 'custom1' || edge.color === 'custom2') && edge.customColor) {
            return edge.customColor;
        }
        const def = EDGE_COLORS[edge.color] || EDGE_COLORS.neutral;
        return opacity < 1 ? def.hex : def.hex;
    }

    setSimKind(kind) {
        if (!SIM_KINDS.includes(kind)) return;
        this.simKind = kind;
        this.simVars = defaultSimVarsForKind(kind);
        if (kind === 'actor') {
            this.simMeta = this.simMeta || defaultSimMeta();
            if (!this.simMeta.role) this.simMeta.role = 'npc';
        }
    }
}
