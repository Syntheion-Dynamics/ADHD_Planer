import { defaultSimVarsForKind } from './SimNode.js';

function tweakActorStats(overrides) {
    const base = defaultSimVarsForKind('actor');
    const map = new Map(base.map((v) => [v.id, { ...v }]));
    for (const [k, val] of Object.entries(overrides)) {
        if (map.has(k)) {
            map.get(k).default = val;
        }
    }
    return Array.from(map.values());
}

/** Vestavěné presety — rozšiřitelné bez změny engine */
export const ARCHETYPES = {
    blank_actor: {
        label: 'Actor (výchozí šablona)',
        nodeImage: null,
        width: 200,
        height: 120,
        shape: 'rect',
        simMeta: { role: 'npc', archetypeId: 'blank_actor', tags: [] },
        buildVars: () => defaultSimVarsForKind('actor'),
    },
    player_dnd: {
        label: 'Hráč (D&D)',
        nodeImage: null,
        width: 200,
        height: 130,
        shape: 'image',
        simMeta: { role: 'player', archetypeId: 'player_dnd', tags: ['controllable', 'hasInventory'] },
        buildVars: () =>
            tweakActorStats({
                hp: 24,
                maxHp: 24,
                ac: 15,
                storyNotes: 'PC',
                currentWeapon: 'dlouhý meč',
            }),
    },
    npc_friendly: {
        label: 'NPC přátelský',
        nodeImage: null,
        width: 200,
        height: 120,
        shape: 'image',
        simMeta: { role: 'friendly', archetypeId: 'npc_friendly', tags: ['hasInventory', 'nonHostile'] },
        buildVars: () => tweakActorStats({ hp: 8, maxHp: 8, ac: 10, storyNotes: 'Měšťan' }),
    },
    enemy_grunt: {
        label: 'Nepřítel (grunt)',
        nodeImage: null,
        width: 200,
        height: 120,
        shape: 'image',
        simMeta: { role: 'enemy', archetypeId: 'enemy_grunt', tags: ['hasInventory', 'hostile'] },
        buildVars: () => tweakActorStats({ hp: 18, maxHp: 18, ac: 12, str: 14, dex: 12, con: 12, storyNotes: 'Grunt' }),
    },
};

export function listArchetypes() {
    return Object.entries(ARCHETYPES).map(([id, def]) => ({ id, label: def.label }));
}

/**
 * @param {import('./SimNode.js').SimNode} node
 * @param {string} archetypeId
 */
export function applyArchetypeToNode(node, archetypeId) {
    const def = ARCHETYPES[archetypeId];
    if (!def) return false;
    if (def.buildVars) node.simVars = def.buildVars();
    if (def.simMeta) {
        node.simMeta = { ...node.simMeta, ...JSON.parse(JSON.stringify(def.simMeta)), archetypeId };
    }
    if (def.nodeImage !== undefined) node.nodeImage = def.nodeImage;
    if (def.width) node.width = def.width;
    if (def.height) node.height = def.height;
    if (def.shape) node.shape = def.shape;
    return true;
}
