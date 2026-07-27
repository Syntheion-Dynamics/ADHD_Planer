import { SimProject, SIM_SCHEMA_VERSION } from './SimProject.js';
import { SimCanvasRenderer } from './SimCanvasRenderer.js';
import { buildInitialState, simulationStep, initVarValue } from './SimulationEngine.js';
import { listArchetypes, applyArchetypeToNode } from './archetypes.js';

const STORAGE_KEY = 'sim-studio-project-v2';

const VAR_GROUP_LABELS = {
    stats: 'Statistiky (D&D)',
    narrative: 'Příběh',
    equipment: 'Vybavení a inventář',
    world: 'Lokace',
    data: 'Data',
};

class SimStudioApp {
    constructor() {
        this.project = null;
        this.simState = null;
        this.selectedNodeIds = new Set();
        this.selectedEdge = null;
        this.history = [];
        this.historyLimit = 200;
        this.snapToGrid = true;
        this.performanceMode = false;
        this.alignmentLines = { x: null, y: null };

        this.toast = {
            success: (msg) => this.showToast(msg, 'success'),
            info: (msg) => this.showToast(msg, 'info'),
            error: (msg) => this.showToast(msg, 'error'),
        };

        this.renderer = new SimCanvasRenderer('sim-canvas', this);
        this.fillArchetypeSelect();
        this.bindToolbar();
        this.bindEditorPanel();
        this.bindKeyboard();
        this.loadOrCreate();
        this.resetSimulation();
        this.syncEditorPanel();
    }

    getProject() {
        return this.project;
    }

    getSimState() {
        return this.simState;
    }

    showToast(msg, type = 'info') {
        const el = document.getElementById('toast');
        if (!el) return;
        el.textContent = msg;
        el.className = `toast toast-${type} visible`;
        clearTimeout(this._toastT);
        this._toastT = setTimeout(() => el.classList.remove('visible'), 2800);
    }

    loadOrCreate() {
        try {
            const raw =
                localStorage.getItem(STORAGE_KEY) || localStorage.getItem('sim-studio-project-v1');
            if (raw) {
                const data = JSON.parse(raw);
                if (data.schemaVersion >= 1 && Array.isArray(data.nodes)) {
                    this.project = SimProject.fromJSON(data);
                    this.pushHistory(true);
                    return;
                }
            }
        } catch (_) {
            /* ignore */
        }
        this.project = new SimProject(`proj_${Date.now()}`, 'Nový sim projekt');
        this.pushHistory(true);
    }

    persist() {
        if (!this.project) return;
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.project.toJSON()));
        } catch (_) {
            this.toast.error('Uložení do prohlížeče selhalo');
        }
    }

    pushHistory(initial = false) {
        if (!this.project) return;
        const snap = JSON.stringify(this.project.toJSON());
        if (!initial && this.history.length && this.history[this.history.length - 1] === snap) return;
        this.history.push(snap);
        if (this.history.length > this.historyLimit) this.history.shift();
        if (!initial) this.persist();
    }

    undo() {
        if (this.history.length < 2) return;
        this.history.pop();
        const prev = this.history[this.history.length - 1];
        this.project = SimProject.fromJSON(JSON.parse(prev));
        this.resetSimulation();
        this.syncEditorPanel();
        this.toast.info('Zpět');
    }

    selectNode(id, shiftKey = false) {
        this.selectedEdge = null;
        if (id == null) {
            this.selectedNodeIds.clear();
        } else if (shiftKey) {
            if (this.selectedNodeIds.has(id)) this.selectedNodeIds.delete(id);
            else this.selectedNodeIds.add(id);
        } else {
            this.selectedNodeIds.clear();
            this.selectedNodeIds.add(id);
        }
        this.syncEditorPanel();
    }

    selectEdge(edge) {
        this.selectedNodeIds.clear();
        this.selectedEdge = edge;
        this.syncEditorPanel();
    }

    getAlignmentLines(draggingNode) {
        if (!this.project || !draggingNode) return { x: null, y: null };
        const threshold = 5;
        let bestX = null;
        let bestY = null;
        for (const [id, node] of this.project.nodes) {
            if (id === draggingNode.id) continue;
            const dx_left = Math.abs(draggingNode.x - node.x);
            const dx_center = Math.abs(draggingNode.x + draggingNode.width / 2 - (node.x + node.width / 2));
            const dx_right = Math.abs(draggingNode.x + draggingNode.width - (node.x + node.width));
            if (dx_left < threshold) {
                draggingNode.x = node.x;
                bestX = node.x;
            } else if (dx_center < threshold) {
                draggingNode.x = node.x + node.width / 2 - draggingNode.width / 2;
                bestX = node.x + node.width / 2;
            } else if (dx_right < threshold) {
                draggingNode.x = node.x + node.width - draggingNode.width;
                bestX = node.x + node.width;
            }
            const dy_top = Math.abs(draggingNode.y - node.y);
            const dy_center = Math.abs(draggingNode.y + draggingNode.height / 2 - (node.y + node.height / 2));
            const dy_bottom = Math.abs(draggingNode.y + draggingNode.height - (node.y + node.height));
            if (dy_top < threshold) {
                draggingNode.y = node.y;
                bestY = node.y;
            } else if (dy_center < threshold) {
                draggingNode.y = node.y + node.height / 2 - draggingNode.height / 2;
                bestY = node.y + node.height / 2;
            } else if (dy_bottom < threshold) {
                draggingNode.y = node.y + node.height - draggingNode.height;
                bestY = node.y + node.height;
            }
        }
        return { x: bestX, y: bestY };
    }

    resetSimulation() {
        if (!this.project) return;
        this.simState = buildInitialState(this.project);
        const tickEl = document.getElementById('sim-tick');
        if (tickEl) tickEl.textContent = String(this.simState.tick);
    }

    stepSimulation() {
        if (!this.project || !this.simState) return;
        const { state, transfers } = simulationStep(this.project, this.simState);
        this.simState = state;
        this.renderer.queueTransferParticles(transfers);
        const tickEl = document.getElementById('sim-tick');
        if (tickEl) tickEl.textContent = String(this.simState.tick);
    }

    deleteSelection() {
        if (!this.project) return;
        if (this.selectedEdge) {
            const src = this.project.getNode(this.selectedEdge.sourceNodeId);
            if (src) {
                src.removeEdge(this.selectedEdge.targetId);
                this.pushHistory();
            }
            this.selectedEdge = null;
            this.syncEditorPanel();
            return;
        }
        const ids = Array.from(this.selectedNodeIds);
        for (const id of ids) {
            this.project.deleteNode(id);
        }
        this.selectedNodeIds.clear();
        this.pushHistory();
        this.resetSimulation();
        this.syncEditorPanel();
    }

    bindKeyboard() {
        window.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
                if (e.key === 'Escape') e.target.blur();
                return;
            }
            if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault();
                this.deleteSelection();
            }
            if (e.ctrlKey && e.key === 'z') {
                e.preventDefault();
                this.undo();
            }
            if (e.key === ' ' && !e.repeat) {
                e.preventDefault();
                this.stepSimulation();
            }
        });
    }

    bindToolbar() {
        document.getElementById('btn-add-node')?.addEventListener('click', () => {
            if (!this.project) return;
            const n = this.project.addNode('Uzel', 120, 120);
            this.selectNode(n.id, false);
            this.pushHistory();
            this.resetSimulation();
        });

        document.getElementById('btn-step')?.addEventListener('click', () => this.stepSimulation());
        document.getElementById('btn-reset-sim')?.addEventListener('click', () => {
            this.resetSimulation();
            const tickEl = document.getElementById('sim-tick');
            if (tickEl) tickEl.textContent = '0';
            this.toast.info('Simulace resetována');
        });

        document.getElementById('btn-save-file')?.addEventListener('click', () => this.downloadJSON(this.project.toJSON(), `${this.project.name || 'sim'}.json`));
        document.getElementById('btn-export-game')?.addEventListener('click', () => {
            const bundle = this.project.toGameBundle(this.simState);
            this.downloadJSON(bundle, `${this.project.name || 'sim'}-game.json`);
            this.toast.success('Export pro hru stažen');
        });

        document.getElementById('file-load')?.addEventListener('change', (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const reader = new FileReader();
            reader.onload = () => {
                try {
                    const data = JSON.parse(reader.result);
                    let projPayload = data;
                    let loadedState = null;
                    if (data.kind === 'sim-game-bundle') {
                        loadedState = data.initialState;
                        projPayload = {
                            schemaVersion: data.schemaVersion,
                            id: data.id || `proj_${Date.now()}`,
                            name: data.name,
                            lastNodeId: data.lastNodeId || 0,
                            nodes: data.nodes,
                        };
                    }
                    this.project = SimProject.fromJSON(projPayload);
                    this.history = [JSON.stringify(this.project.toJSON())];
                    this.selectedNodeIds.clear();
                    this.selectedEdge = null;
                    this.persist();
                    if (loadedState && loadedState.vars) {
                        this.simState = loadedState;
                        const tickEl = document.getElementById('sim-tick');
                        if (tickEl) tickEl.textContent = String(this.simState.tick ?? 0);
                    } else {
                        this.resetSimulation();
                    }
                    this.syncEditorPanel();
                    this.toast.success('Projekt načten');
                } catch (err) {
                    this.toast.error('Neplatný JSON');
                }
                e.target.value = '';
            };
            reader.readAsText(f);
        });

        document.getElementById('btn-theme')?.addEventListener('click', () => {
            document.body.classList.toggle('light-mode');
        });

        document.getElementById('proj-name')?.addEventListener('change', (e) => {
            if (this.project) {
                this.project.name = e.target.value || 'Sim projekt';
                this.persist();
            }
        });
    }

    fillArchetypeSelect() {
        const sel = document.getElementById('ed-archetype');
        if (!sel) return;
        sel.innerHTML = '<option value="">— vlastní / bez presetu —</option>';
        for (const { id, label } of listArchetypes()) {
            const o = document.createElement('option');
            o.value = id;
            o.textContent = label;
            sel.appendChild(o);
        }
    }

    downloadJSON(obj, filename) {
        const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
    }

    bindEditorPanel() {
        const panel = document.getElementById('editor-panel');
        if (!panel) return;

        panel.addEventListener('change', (e) => {
            const t = e.target;
            if (!this.project) return;

            if (t.id === 'ed-node-title' && this.selectedNodeIds.size === 1) {
                const node = this.project.getNode(Array.from(this.selectedNodeIds)[0]);
                if (node) {
                    node.title = t.value;
                    this.pushHistory();
                    this.syncEditorPanel();
                }
            }
            if (t.id === 'ed-node-kind' && this.selectedNodeIds.size === 1) {
                const node = this.project.getNode(Array.from(this.selectedNodeIds)[0]);
                if (node) {
                    node.setSimKind(t.value);
                    this.pushHistory();
                    this.resetSimulation();
                    this.syncEditorPanel();
                }
            }
            if (t.id === 'ed-node-role' && this.selectedNodeIds.size === 1) {
                const node = this.project.getNode(Array.from(this.selectedNodeIds)[0]);
                if (node?.simMeta) {
                    node.simMeta.role = t.value;
                    this.pushHistory();
                }
            }
            if (t.id === 'ed-archetype' && this.selectedNodeIds.size === 1) {
                const node = this.project.getNode(Array.from(this.selectedNodeIds)[0]);
                if (node && t.value && node.simKind === 'actor') {
                    applyArchetypeToNode(node, t.value);
                    this.pushHistory();
                    this.resetSimulation();
                    this.syncEditorPanel();
                }
            }
            if (t.id === 'ed-node-image' && this.selectedNodeIds.size === 1) {
                const node = this.project.getNode(Array.from(this.selectedNodeIds)[0]);
                if (node) {
                    node.nodeImage = t.value.trim() || null;
                    this.pushHistory();
                }
            }
            if (t.id === 'ed-node-shape' && this.selectedNodeIds.size === 1) {
                const node = this.project.getNode(Array.from(this.selectedNodeIds)[0]);
                if (node) {
                    node.shape = t.value;
                    this.pushHistory();
                }
            }
            if (t.id === 'ed-node-tags' && this.selectedNodeIds.size === 1) {
                const node = this.project.getNode(Array.from(this.selectedNodeIds)[0]);
                if (node?.simMeta) {
                    node.simMeta.tags = t.value
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean);
                    this.pushHistory();
                }
            }
            if (t.id === 'ed-edge-channel' && this.selectedEdge) {
                const src = this.project.getNode(this.selectedEdge.sourceNodeId);
                const edge = src?.edges.find((x) => x.targetId === this.selectedEdge.targetId);
                if (edge) {
                    edge.simChannel = t.value;
                    this.pushHistory();
                }
            }
            if (t.id === 'ed-edge-transform' && this.selectedEdge) {
                const src = this.project.getNode(this.selectedEdge.sourceNodeId);
                const edge = src?.edges.find((x) => x.targetId === this.selectedEdge.targetId);
                if (edge) {
                    edge.transform = t.value;
                    this.pushHistory();
                }
            }
            if (t.id === 'ed-edge-label' && this.selectedEdge) {
                const src = this.project.getNode(this.selectedEdge.sourceNodeId);
                const edge = src?.edges.find((x) => x.targetId === this.selectedEdge.targetId);
                if (edge) {
                    edge.label = t.value;
                    this.pushHistory();
                }
            }
            if (t.id === 'ed-edge-skey' && this.selectedEdge) {
                const src = this.project.getNode(this.selectedEdge.sourceNodeId);
                const edge = src?.edges.find((x) => x.targetId === this.selectedEdge.targetId);
                if (edge) {
                    edge.sourceKey = t.value;
                    this.pushHistory();
                }
            }
            if (t.id === 'ed-edge-tkey' && this.selectedEdge) {
                const src = this.project.getNode(this.selectedEdge.sourceNodeId);
                const edge = src?.edges.find((x) => x.targetId === this.selectedEdge.targetId);
                if (edge) {
                    edge.targetKey = t.value;
                    this.pushHistory();
                }
            }
            if (t.classList.contains('ed-var-value')) {
                const id = t.dataset.varId;
                const vtype = t.dataset.varType || 'number';
                if (!id || this.selectedNodeIds.size !== 1 || !this.project) return;
                const node = this.project.getNode(Array.from(this.selectedNodeIds)[0]);
                const sv = node?.simVars?.find((v) => v.id === id);
                if (sv) {
                    if (vtype === 'number') sv.default = parseFloat(t.value) || 0;
                    else if (vtype === 'string') sv.default = t.value;
                    if (this.simState?.vars?.[node.id]) {
                        this.simState.vars[node.id][id] = initVarValue(sv);
                    }
                    this.pushHistory();
                }
            }
        });
    }

    syncEditorPanel() {
        const nameInput = document.getElementById('proj-name');
        const nodeBlock = document.getElementById('editor-node');
        const edgeBlock = document.getElementById('editor-edge');
        const varsList = document.getElementById('ed-vars-list');
        const emptyHint = document.getElementById('editor-empty');

        if (nameInput && this.project) nameInput.value = this.project.name;

        if (!nodeBlock || !edgeBlock || !varsList) return;

        if (this.selectedEdge && this.project) {
            if (emptyHint) emptyHint.classList.add('hidden');
            nodeBlock.classList.add('hidden');
            edgeBlock.classList.remove('hidden');
            const src = this.project.getNode(this.selectedEdge.sourceNodeId);
            const edge = src?.edges.find((x) => x.targetId === this.selectedEdge.targetId);
            if (edge) {
                document.getElementById('ed-edge-channel').value = edge.simChannel || 'flow.number';
                document.getElementById('ed-edge-transform').value = edge.transform || '';
                document.getElementById('ed-edge-label').value = edge.label || '';
                document.getElementById('ed-edge-skey').value = edge.sourceKey || '';
                document.getElementById('ed-edge-tkey').value = edge.targetKey || '';
            }
            return;
        }

        edgeBlock.classList.add('hidden');
        if (this.selectedNodeIds.size === 1 && this.project) {
            if (emptyHint) emptyHint.classList.add('hidden');
            nodeBlock.classList.remove('hidden');
            const node = this.project.getNode(Array.from(this.selectedNodeIds)[0]);
            const actorMeta = document.getElementById('editor-actor-meta');
            if (node) {
                document.getElementById('ed-node-title').value = node.title;
                document.getElementById('ed-node-kind').value = node.simKind;
                if (actorMeta) {
                    if (node.simKind === 'actor') {
                        actorMeta.classList.remove('hidden');
                        document.getElementById('ed-node-role').value = node.simMeta?.role || 'npc';
                        document.getElementById('ed-node-image').value = node.nodeImage || '';
                        document.getElementById('ed-node-shape').value = node.shape || 'rect';
                        document.getElementById('ed-node-tags').value = (node.simMeta?.tags || []).join(', ');
                        const arch = document.getElementById('ed-archetype');
                        if (arch) arch.value = node.simMeta?.archetypeId || '';
                    } else {
                        actorMeta.classList.add('hidden');
                    }
                }
                varsList.innerHTML = '';
                const byGroup = {};
                for (const sv of node.simVars || []) {
                    const g = sv.group || 'data';
                    if (!byGroup[g]) byGroup[g] = [];
                    byGroup[g].push(sv);
                }
                const groupOrder = Object.keys(byGroup).sort();
                for (const g of groupOrder) {
                    const h = document.createElement('h4');
                    h.className = 'var-group-title';
                    h.textContent = VAR_GROUP_LABELS[g] || g;
                    varsList.appendChild(h);
                    for (const sv of byGroup[g]) {
                        const row = document.createElement('div');
                        row.className = 'var-row';
                        const label = document.createElement('label');
                        const idSpan = document.createElement('span');
                        idSpan.className = 'var-id';
                        idSpan.textContent = sv.id;
                        label.appendChild(idSpan);
                        if (sv.exposeOut || sv.exposeIn) {
                            const ph = document.createElement('span');
                            ph.className = 'muted tiny';
                            const p = [];
                            if (sv.exposeOut) p.push('out');
                            if (sv.exposeIn) p.push('in');
                            ph.textContent = ` [${p.join(', ')}]`;
                            label.appendChild(ph);
                        }
                        if (sv.type === 'inventory') {
                            const hint = document.createElement('span');
                            hint.className = 'muted tiny';
                            hint.textContent = ' (inventář JSON)';
                            label.appendChild(hint);
                            const ta = document.createElement('textarea');
                            ta.className = 'ed-var-inv';
                            ta.rows = 3;
                            ta.readOnly = true;
                            ta.value = JSON.stringify(sv.default || { slots: [], maxSlots: 20 });
                            label.appendChild(ta);
                        } else if (sv.type === 'string') {
                            const inp = document.createElement('input');
                            inp.type = 'text';
                            inp.className = 'ed-var-value';
                            inp.dataset.varId = sv.id;
                            inp.dataset.varType = 'string';
                            inp.value = String(sv.default ?? '');
                            label.appendChild(inp);
                        } else {
                            const inp = document.createElement('input');
                            inp.type = 'number';
                            inp.step = 'any';
                            inp.className = 'ed-var-value';
                            inp.dataset.varId = sv.id;
                            inp.dataset.varType = 'number';
                            inp.value = String(sv.default ?? 0);
                            label.appendChild(inp);
                        }
                        row.appendChild(label);
                        varsList.appendChild(row);
                    }
                }
            }
        } else {
            nodeBlock.classList.add('hidden');
            varsList.innerHTML = '';
            if (emptyHint) emptyHint.classList.remove('hidden');
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const app = new SimStudioApp();
    window.simStudio = app;
    const nameInput = document.getElementById('proj-name');
    if (nameInput && app.project) nameInput.value = app.project.name;
    const tickEl = document.getElementById('sim-tick');
    if (tickEl && app.simState) tickEl.textContent = String(app.simState.tick);
});
