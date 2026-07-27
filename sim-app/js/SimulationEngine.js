import { SimNode, defaultSimVarsForKind } from './SimNode.js';

function primaryOutputKey(node) {
    switch (node.simKind) {
        case 'constant':
        case 'passthrough':
            return 'out';
        case 'combat':
            return 'hp';
        case 'stock':
            return 'count';
        case 'actor': {
            const outs = (node.simVars || []).filter((v) => v.exposeOut);
            return outs[0]?.id || 'hp';
        }
        default:
            return 'out';
    }
}

function readNumericFromRow(row, key) {
    const v = row?.[key];
    if (typeof v === 'number' && !Number.isNaN(v)) return v;
    if (typeof v === 'string') {
        const n = parseFloat(v);
        return Number.isNaN(n) ? 0 : n;
    }
    return 0;
}

function readOutputValue(node, vars, edge) {
    const key = edge.sourceKey || primaryOutputKey(node);
    return readNumericFromRow(vars[node.id], key);
}

export function initVarValue(sv) {
    if (sv.type === 'number') {
        const d = sv.default;
        return typeof d === 'number' ? d : parseFloat(d) || 0;
    }
    if (sv.type === 'string') return String(sv.default ?? '');
    if (sv.type === 'inventory') {
        const d = sv.default || { slots: [], maxSlots: 20 };
        return JSON.parse(JSON.stringify(d));
    }
    return sv.default;
}

/**
 * @param {import('./SimProject.js').SimProject} project
 */
export function buildInitialState(project) {
    const vars = {};
    for (const node of project.nodes.values()) {
        vars[node.id] = {};
        const list = node.simVars?.length ? node.simVars : defaultSimVarsForKind(node.simKind);
        for (const sv of list) {
            vars[node.id][sv.id] = initVarValue(sv);
        }
    }
    return { tick: 0, vars };
}

/**
 * mul:2, add:3, max:10, clamp:0:100, lerp:0.5:20 (t:b — interpolace value směrem k b)
 */
export function applyTransform(transform, value) {
    if (!transform || typeof transform !== 'string') return value;
    const parts = transform.split(':');
    const op = parts[0];
    if (op === 'mul') {
        const n = parseFloat(parts[1]);
        if (!Number.isNaN(n)) return value * n;
    }
    if (op === 'add') {
        const n = parseFloat(parts[1]);
        if (!Number.isNaN(n)) return value + n;
    }
    if (op === 'max') {
        const n = parseFloat(parts[1]);
        if (!Number.isNaN(n)) return Math.max(value, n);
    }
    if (op === 'clamp') {
        const lo = parseFloat(parts[1]);
        const hi = parseFloat(parts[2]);
        if (!Number.isNaN(lo) && !Number.isNaN(hi)) return Math.min(hi, Math.max(lo, value));
    }
    if (op === 'lerp') {
        const t = parseFloat(parts[1]);
        const b = parseFloat(parts[2]);
        if (!Number.isNaN(t) && !Number.isNaN(b)) return value + (b - value) * t;
    }
    return value;
}

function findVarDef(node, key) {
    return node.simVars?.find((s) => s.id === key);
}

function applyTargetKeyWrites(node, row, inc, { kind }) {
    for (const item of inc) {
        if (!item.targetKey) continue;
        if (kind === 'combat' && (item.targetKey === 'hp' || item.targetKey === 'armor')) continue;
        const def = findVarDef(node, item.targetKey);
        if (def?.type === 'number') {
            row[item.targetKey] = (Number(row[item.targetKey]) || 0) + item.value;
        }
    }
}

const behaviors = {
    constant(_node, _row, ctx) {
        void _node;
        void _row;
        void ctx;
    },
    passthrough(node, row, ctx) {
        applyTargetKeyWrites(node, row, ctx.inc, { kind: 'passthrough' });
        row.out = ctx.sumIn;
    },
    combat(node, row, ctx) {
        void node;
        const armor = typeof row.armor === 'number' ? row.armor : 0;
        const hp = typeof row.hp === 'number' ? row.hp : 0;
        const dmg = Math.max(0, ctx.sumIn - armor);
        row.hp = Math.max(0, hp - dmg);
    },
    stock(node, row, ctx) {
        applyTargetKeyWrites(node, row, ctx.inc, { kind: 'stock' });
        const c = typeof row.count === 'number' ? row.count : 0;
        row.count = c + ctx.sumIn;
    },
    actor(node, row, ctx) {
        applyTargetKeyWrites(node, row, ctx.inc, { kind: 'actor' });
        const unbound = ctx.inc.filter((i) => !i.targetKey);
        const unboundSum = unbound.reduce((a, b) => a + b.value, 0);
        if (unboundSum > 0) {
            const ac = typeof row.ac === 'number' ? row.ac : 0;
            const hp = typeof row.hp === 'number' ? row.hp : 0;
            const raw = Math.max(0, unboundSum - ac);
            row.hp = Math.max(0, hp - raw);
        }
    },
};

/**
 * @returns {{ state: object, transfers: Array<{ from: string, to: string, value: number, edgeKey: string }> }}
 */
export function simulationStep(project, state) {
    const transfers = [];
    const vars = JSON.parse(JSON.stringify(state.vars));
    const incoming = {};

    for (const node of project.nodes.values()) {
        incoming[node.id] = [];
    }

    for (const node of project.nodes.values()) {
        for (const edge of node.edges) {
            if ((edge.simChannel || 'flow.number') !== 'flow.number') continue;
            const child = project.getNode(edge.targetId);
            if (!child) continue;
            if (!vars[node.id]) continue;
            let val = readOutputValue(node, vars, edge);
            val = applyTransform(edge.transform, val);
            incoming[child.id].push({
                from: node.id,
                value: val,
                edge: `${node.id}-${edge.targetId}`,
                targetKey: edge.targetKey || '',
            });
        }
    }

    const orderedIds = Array.from(project.nodes.keys()).sort();

    for (const id of orderedIds) {
        const node = project.getNode(id);
        if (!node) continue;
        const inc = incoming[id];
        const sumIn = inc.reduce((a, b) => a + b.value, 0);

        for (const { from, value, edge } of inc) {
            transfers.push({ from, to: id, value, edgeKey: edge });
        }

        const row = vars[id];
        if (!row) continue;

        const fn = behaviors[node.simKind] || behaviors.constant;
        fn(node, row, { inc, sumIn });
    }

    return {
        state: { tick: (state.tick || 0) + 1, vars },
        transfers,
    };
}

export function formatStateOverlay(node, vars) {
    const row = vars[node.id];
    if (!row) return '';
    const parts = [];
    const keys = Object.keys(row).sort();
    for (const k of keys) {
        const v = row[k];
        if (k === 'inventory' && v && typeof v === 'object' && Array.isArray(v.slots)) {
            parts.push(`inv:${v.slots.length}`);
            continue;
        }
        if (typeof v === 'number') parts.push(`${k}: ${Number.isInteger(v) ? v : v.toFixed(2)}`);
        else if (typeof v === 'string' && v.length > 0) {
            const short = v.length > 12 ? `${v.slice(0, 10)}…` : v;
            parts.push(`${k}: ${short}`);
        }
    }
    return parts.join(' · ');
}
