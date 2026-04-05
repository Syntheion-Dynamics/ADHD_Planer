import { Project } from './Project.js';
import { CanvasRenderer } from './CanvasRenderer.js';
import { SimulationRenderer } from './SimulationRenderer.js';
import { EditorController } from './EditorController.js';
import { ToastManager } from './ToastManager.js';

class AppManager {
    constructor() {
        this.projects = new Map();
        this.currentProject = null;
        this.selectedNodeIds = new Set(); // V2.1 — Multi-select
        this.isConnecting = false;

        // Search state
        this.searchResults = [];
        this.searchIndex = -1;

        // V2.1 — History (Undo/Redo)
        this.history = [];
        this.redoStack = [];
        this.historyLimit = 50;

        // V2.0 — Toast systém
        this.toast = new ToastManager();

        // V2.0 — Oba renderery
        this.canvasRenderer = new CanvasRenderer('project-canvas', this);
        this.simRenderer = new SimulationRenderer('simulation-canvas', this);
        
        // Context menu state
        this.contextMenuWorldPos = null;
        this.contextMenuNodeId = null;
        
        this.editor = new EditorController(this);

        this.setupUI();
        this.setupShortcuts();
        this.setupContextMenu();
        this.initApp();
    }

    // V2.0 — Vrací aktivní renderer podle módu projektu
    getActiveRenderer() {
        if (this.currentProject && this.currentProject.mode === 'simulation') {
            return this.simRenderer;
        }
        return this.canvasRenderer;
    }

    // V2.0 — Přepne viditelnost canvas elementů podle módu
    updateCanvasVisibility() {
        const dataCanvas = document.getElementById('project-canvas');
        const simCanvas = document.getElementById('simulation-canvas');
        
        if (this.currentProject && this.currentProject.mode === 'simulation') {
            dataCanvas.style.display = 'none';
            simCanvas.style.display = 'block';
            this.simRenderer.resize();
        } else {
            dataCanvas.style.display = 'block';
            simCanvas.style.display = 'none';
            this.canvasRenderer.resize();
        }
    }

    async initApp() {
        const loaded = await this.loadFromAPI();
        if (!loaded) {
            this.createNewProject();
        }
        this.updateCanvasVisibility();
    }

    setupShortcuts() {
        window.addEventListener('keydown', (e) => {
            const activeTag = document.activeElement.tagName.toLowerCase();
            const isInput = activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select' || document.activeElement.isContentEditable;

            // Cancel connection mode (vždy, i v input)
            if (e.key === 'Escape' && this.isConnecting) {
                this.isConnecting = false;
                document.getElementById('connect-overlay').classList.add('hidden');
                return;
            }

            // Undo/Redo (vždy mimo input)
            if (!isInput && e.ctrlKey && e.key === 'z') {
                e.preventDefault();
                this.undo();
                return;
            }
            if (!isInput && e.ctrlKey && e.key === 'y') {
                e.preventDefault();
                this.redo();
                return;
            }

            if (isInput) return;

            const selected = this.getSelectedNode();
            const renderer = this.getActiveRenderer();

            // === VYTVOŘENÍ UZLU (N) ===
            if (e.key === 'n' || e.key === 'N') {
                if (!this.currentProject) return;
                this.pushHistory();
                if (selected) {
                    const child = this.currentProject.addNode("Nový uzel", selected.x, selected.y + 120);
                    selected.addEdge(child.id);
                    this.selectNode(child.id);
                } else {
                    const node = this.currentProject.addNode("Nový uzel", -renderer.camera.x + window.innerWidth / 2, -renderer.camera.y + window.innerHeight / 2);
                    this.selectNode(node.id);
                }
                return;
            }

            // === SMAZÁNÍ UZLŮ (Delete / Backspace) ===
            if (e.key === 'Delete' || e.key === 'Backspace') {
                if (this.selectedNodeIds.size > 0) {
                    this.pushHistory();
                    for (let id of this.selectedNodeIds) {
                        this.currentProject.deleteNode(id);
                    }
                    this.selectedNodeIds.clear();
                    this.selectNode(null);
                    renderer.draw();
                    this.toast.info("Smazáno");
                }
                return;
            }

            // === PIN (B) ===
            if ((e.key === 'b' || e.key === 'B') && selected) {
                selected.isPinned = !selected.isPinned;
                this.editor.showNode(selected);
                renderer.draw();
                return;
            }

            // === Ctrl+A — Vybrat vše ===
            if (e.ctrlKey && e.key === 'a') {
                e.preventDefault();
                if (!this.currentProject) return;
                this.selectedNodeIds.clear();
                for (let [id] of this.currentProject.nodes) {
                    this.selectedNodeIds.add(id);
                }
                renderer.draw();
                return;
            }

            // === Arrow keys — Pohyb vybraného uzlu ===
            if (selected && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
                e.preventDefault();
                this.pushHistory();
                const step = renderer.GRID_SIZE;
                if (e.key === 'ArrowUp')    selected.y -= step;
                if (e.key === 'ArrowDown')  selected.y += step;
                if (e.key === 'ArrowLeft')  selected.x -= step;
                if (e.key === 'ArrowRight') selected.x += step;
                renderer.draw();
            }
        });
    }

    setupUI() {
        const themeBtn = document.getElementById('theme-toggle-btn');
        themeBtn.addEventListener('click', () => {
            const isLight = document.body.classList.toggle('light-mode');
            localStorage.setItem('planer_theme', isLight ? 'light' : 'dark');
            this.getActiveRenderer().draw();
        });
        
        if (localStorage.getItem('planer_theme') === 'light') {
            document.body.classList.add('light-mode');
        }

        document.getElementById('add-tab-btn').addEventListener('click', () => {
            this.createNewProject();
        });

        document.getElementById('save-btn').addEventListener('click', () => {
            this.saveToAPI();
            this.toast.success("Synchro uloženo na server!");
        });

        const searchInput = document.getElementById('search-input');
        const searchCounter = document.getElementById('search-counter');

        const doSearch = (q) => {
            const renderer = this.getActiveRenderer();
            if (!this.currentProject || q.length === 0) {
                renderer.hoveredNodeId = null;
                this.searchResults = [];
                this.searchIndex = -1;
                if (searchCounter) searchCounter.style.display = 'none';
                renderer.draw();
                return;
            }

            this.searchResults = [];
            for (let [id, node] of this.currentProject.nodes) {
                const foundInNotes = node.notes.some(n =>
                    n.title.toLowerCase().includes(q) ||
                    (n.content && n.content.toLowerCase().includes(q)) ||
                    (n.tags && n.tags.some(t => t.toLowerCase().includes(q)))
                );
                if (node.title.toLowerCase().includes(q) || foundInNotes) {
                    this.searchResults.push(node);
                }
            }

            this.searchIndex = 0;
            this.jumpToSearchResult(renderer);
        };

        searchInput.addEventListener('input', (e) => {
            doSearch(e.target.value.toLowerCase());
        });

        // Enter = přesun na další výsledek
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && this.searchResults.length > 0) {
                e.preventDefault();
                this.searchIndex = (this.searchIndex + 1) % this.searchResults.length;
                this.jumpToSearchResult(this.getActiveRenderer());
            }
            if (e.key === 'Escape') {
                searchInput.value = '';
                doSearch('');
                searchInput.blur();
            }
        });

        const resizer = document.getElementById('panel-resizer');
        const editorPanel = document.getElementById('editor-panel');
        let isResizing = false;

        resizer.addEventListener('mousedown', (e) => {
            isResizing = true;
            resizer.classList.add('is-resizing');
            document.body.style.cursor = 'ew-resize';
        });

        window.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            let newWidth = window.innerWidth - e.clientX;
            if (newWidth < 300) newWidth = 300;
            if (newWidth > 1000) newWidth = 1000;
            
            editorPanel.style.width = newWidth + 'px';
            this.canvasRenderer.resize();
            this.simRenderer.resize();
        });

        window.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                resizer.classList.remove('is-resizing');
                document.body.style.cursor = 'default';
            }
        });

        // --- Modál Nastavení Projektu ---
        const settingsModal = document.getElementById('project-settings-modal');
        const pnameInput = document.getElementById('proj-name-input');
        const pmodeSelect = document.getElementById('proj-mode-select');
        
        document.getElementById('project-settings-btn').addEventListener('click', () => {
            if (this.currentProject) {
                pnameInput.value = this.currentProject.name;
                pmodeSelect.value = this.currentProject.mode;
                settingsModal.classList.remove('hidden');
            }
        });

        document.getElementById('proj-close-btn').addEventListener('click', () => {
            settingsModal.classList.add('hidden');
        });

        document.getElementById('proj-save-btn').addEventListener('click', () => {
            if (this.currentProject) {
                const oldMode = this.currentProject.mode;
                this.currentProject.name = pnameInput.value;
                this.currentProject.mode = pmodeSelect.value;
                
                // V2.0 — Sync camera when switching modes
                if (oldMode !== this.currentProject.mode) {
                    const from = oldMode === 'simulation' ? this.simRenderer : this.canvasRenderer;
                    const to = this.currentProject.mode === 'simulation' ? this.simRenderer : this.canvasRenderer;
                    to.camera = { ...from.camera };
                    this.updateCanvasVisibility();
                    this.toast.info(`Přepnuto na mód: ${this.currentProject.mode === 'simulation' ? 'Simulace 🎲' : 'Data 📁'}`);
                }
                
                this.renderTabs();
                this.editor.showNode(this.getSelectedNode());
                this.getActiveRenderer().draw();
                this.saveToAPI();
                settingsModal.classList.add('hidden');
            }
        });

        // V2.1 — Delete project
        document.getElementById('proj-delete-btn').addEventListener('click', async () => {
            if (!this.currentProject) return;
            if (!confirm(`Opravdu smazat projekt "${this.currentProject.name}"? Tato akce je nevratná!`)) return;
            
            try {
                await fetch('/api/delete-project', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: this.currentProject.id })
                });
            } catch (e) {
                console.error('Delete failed', e);
            }
            
            const deletedId = this.currentProject.id;
            this.projects.delete(deletedId);
            settingsModal.classList.add('hidden');
            
            if (this.projects.size > 0) {
                const firstKey = this.projects.keys().next().value;
                this.switchProject(firstKey);
            } else {
                this.createNewProject();
            }
            this.toast.success('Projekt smazán.');
        });

        setInterval(() => this.saveToAPI(), 15000);
    }

    // =============================================
    // CONTEXT MENU
    // =============================================
    setupContextMenu() {
        const menu = document.getElementById('canvas-context-menu');
        const canvasPanel = document.getElementById('canvas-panel');

        // Close on click anywhere outside
        document.addEventListener('click', () => this.hideContextMenu());
        document.addEventListener('contextmenu', (e) => {
            // Only handle within canvas panel
            if (!canvasPanel.contains(e.target) || e.target.closest('.context-menu')) return;
        });

        // Right-click on canvas
        const setupForCanvas = (canvas) => {
            canvas.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                const renderer = this.getActiveRenderer();
                const rect = canvas.getBoundingClientRect();
                const mouseX = e.clientX - rect.left;
                const mouseY = e.clientY - rect.top;
                const worldPos = renderer.toWorld(mouseX, mouseY);
                this.contextMenuWorldPos = worldPos;

                // Check if clicking on a node
                const project = this.currentProject;
                let clickedNode = null;
                if (project) {
                    const nodesArr = Array.from(project.nodes.values()).reverse();
                    for (let node of nodesArr) {
                        let ww = node.shape === 'diamond' ? node.width * 1.5 : node.width;
                        let hh = node.shape === 'diamond' ? node.height * 1.5 : node.height;
                        let cx = node.shape === 'diamond' ? node.x - node.width*0.25 : node.x;
                        let cy = node.shape === 'diamond' ? node.y - node.height*0.25 : node.y;
                        if (worldPos.x >= cx && worldPos.x <= cx + ww &&
                            worldPos.y >= cy && worldPos.y <= cy + hh) {
                            clickedNode = node;
                            break;
                        }
                    }
                }

                this.contextMenuNodeId = clickedNode ? clickedNode.id : null;

                // Show/hide sections
                const nodeActions = document.getElementById('ctx-node-actions');
                const connectSection = document.getElementById('ctx-connect-section');
                const dividerNode = document.getElementById('ctx-divider-node');
                const dividerConnect = document.getElementById('ctx-divider-connect');

                if (clickedNode) {
                    nodeActions.style.display = '';
                    dividerNode.style.display = '';
                    // "Connect to selected" only if there's a different selected node
                    if (this.selectedNodeIds.size > 0 && !this.selectedNodeIds.has(clickedNode.id)) {
                        connectSection.style.display = '';
                        dividerConnect.style.display = '';
                    } else {
                        connectSection.style.display = 'none';
                        dividerConnect.style.display = 'none';
                    }
                } else {
                    nodeActions.style.display = 'none';
                    dividerNode.style.display = 'none';
                    // "Connect to selected" not relevant on empty area
                    connectSection.style.display = 'none';
                    dividerConnect.style.display = 'none';
                }

                // Position and show
                const panelRect = canvasPanel.getBoundingClientRect();
                let menuX = e.clientX - panelRect.left;
                let menuY = e.clientY - panelRect.top;
                
                menu.classList.remove('hidden');
                // Clamp to panel bounds
                const menuW = menu.offsetWidth;
                const menuH = menu.offsetHeight;
                if (menuX + menuW > panelRect.width) menuX = panelRect.width - menuW - 4;
                if (menuY + menuH > panelRect.height) menuY = panelRect.height - menuH - 4;
                
                menu.style.left = menuX + 'px';
                menu.style.top = menuY + 'px';
            });
        };

        setupForCanvas(document.getElementById('project-canvas'));
        setupForCanvas(document.getElementById('simulation-canvas'));

        // Handle menu item clicks
        menu.addEventListener('click', (e) => {
            const item = e.target.closest('.context-menu-item');
            if (!item) return;
            const action = item.dataset.action;
            this.handleContextAction(action);
            this.hideContextMenu();
        });
    }

    hideContextMenu() {
        document.getElementById('canvas-context-menu').classList.add('hidden');
    }

    handleContextAction(action) {
        if (!this.currentProject) return;
        const renderer = this.getActiveRenderer();
        const wp = this.contextMenuWorldPos;

        switch (action) {
            case 'new-rect': 
            case 'new-diamond':
            case 'new-circle':
            case 'new-trapezoid':
            case 'new-cylinder': {
                this.pushHistory();
                const shape = action.split('-')[1];
                const node = this.currentProject.addNode("Nový uzel", wp.x, wp.y);
                node.shape = shape;
                this.selectNode(node.id);
                this.toast.success(`Vytvořen ${shape}`);
                break;
            }
            case 'new-image': {
                this.handleImageNodeCreation(wp);
                break;
            }
            case 'connect-to-selected': {
                if (this.selectedNodeIds.size > 0 && this.contextMenuNodeId) {
                    this.pushHistory();
                    for (let sid of this.selectedNodeIds) {
                        const snode = this.currentProject.getNode(sid);
                        if (snode) snode.addEdge(this.contextMenuNodeId);
                    }
                    this.toast.success('Spojení vytvořena!');
                }
                break;
            }
            case 'toggle-shape': {
                if (this.contextMenuNodeId) {
                    this.pushHistory();
                    const node = this.currentProject.getNode(this.contextMenuNodeId);
                    const shapes = ['rect', 'diamond', 'circle', 'trapezoid', 'cylinder'];
                    let nextIdx = (shapes.indexOf(node.shape) + 1) % shapes.length;
                    node.shape = shapes[nextIdx];
                    this.selectNode(node.id);
                }
                break;
            }
            case 'add-child': {
                if (this.contextMenuNodeId) {
                    this.pushHistory();
                    const parent = this.currentProject.getNode(this.contextMenuNodeId);
                    const child = this.currentProject.addNode("Nový uzel", parent.x, parent.y + 120);
                    parent.addEdge(child.id);
                    this.selectNode(child.id);
                }
                break;
            }
            case 'pin-node': {
                if (this.contextMenuNodeId) {
                    this.pushHistory();
                    const node = this.currentProject.getNode(this.contextMenuNodeId);
                    node.isPinned = !node.isPinned;
                    this.selectNode(node.id);
                }
                break;
            }
            case 'delete-node': {
                if (this.contextMenuNodeId) {
                    this.pushHistory();
                    this.currentProject.deleteNode(this.contextMenuNodeId);
                    this.selectedNodeIds.delete(this.contextMenuNodeId);
                    this.selectNode(null);
                    renderer.draw();
                }
                break;
            }
        }
    }

    async handleImageNodeCreation(worldPos) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            this.pushHistory();
            const reader = new FileReader();
            reader.onload = async (event) => {
                const base64 = event.target.result;
                try {
                    const res = await fetch('/api/upload-image', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ filename: file.name, base64: base64 })
                    });
                    const data = await res.json();
                    if (data.url) {
                        const node = this.currentProject.addNode(file.name, worldPos.x, worldPos.y);
                        node.shape = 'image';
                        node.nodeImage = data.url;
                        node.width = 150;
                        node.height = 100;
                        this.selectNode(node.id);
                        this.toast.success("Obrázkový uzel přidán!");
                    }
                } catch (err) {
                    this.toast.error("Upload selhal");
                }
            };
            reader.readAsDataURL(file);
        };
        input.click();
    }

    // setupShortcuts() je definována jednou výše — tato duplikace byla odstraněna

    createNewProject() {
        const id = `proj_${Date.now()}`;
        const name = `Projekt ${this.projects.size + 1}`;
        const proj = new Project(id, name);
        this.projects.set(id, proj);
        this.switchProject(id);
    }

    switchProject(id) {
        if (this.projects.has(id)) {
            this.currentProject = this.projects.get(id);
            let rootId = null;
            for (let [nid, node] of this.currentProject.nodes) {
                rootId = nid; 
                break; 
            }
            this.selectNode(rootId);
            
            this.renderTabs();
            
            // V2.0 — Reset cameras + switch canvas
            this.canvasRenderer.camera = { x: 0, y: 0, zoom: 1 };
            this.simRenderer.camera = { x: 0, y: 0, zoom: 1 };
            this.updateCanvasVisibility();
            this.pushHistory(); // V2.1 — First state
        }
    }

    renderTabs() {
        const container = document.getElementById('tabs-container');
        container.innerHTML = '';
        
        for (let [id, proj] of this.projects) {
            const tab = document.createElement('div');
            tab.className = `tab ${this.currentProject && this.currentProject.id === id ? 'active' : ''}`;
            tab.innerHTML = `<span class="tab-mode-icon">${proj.mode==='simulation'?'🎲':'📁'}</span> ${proj.name}`;
            
            tab.addEventListener('dblclick', (e) => {
                e.stopPropagation();

                // Inline rename — nahradí obsah tabu inputem
                const icon = proj.mode === 'simulation' ? '🎲' : '📁';
                tab.innerHTML = '';
                const input = document.createElement('input');
                input.type = 'text';
                input.className = 'tab-rename-input';
                input.value = proj.name;
                tab.appendChild(input);
                input.focus();
                input.select();

                const finish = (save) => {
                    const newName = input.value.trim();
                    if (save && newName) {
                        proj.name = newName;
                        this.saveToAPI();
                    }
                    this.renderTabs();
                };

                input.addEventListener('blur', () => finish(true));
                input.addEventListener('keydown', (ke) => {
                    if (ke.key === 'Enter') { ke.preventDefault(); input.blur(); }
                    if (ke.key === 'Escape') { ke.preventDefault(); input.removeEventListener('blur', () => finish(true)); this.renderTabs(); }
                });
            });

            tab.addEventListener('click', () => {
                this.switchProject(id);
            });
            container.appendChild(tab);
        }
    }

    selectNode(id, additive = false) {
        if (!additive) {
            this.selectedNodeIds.clear();
        }

        if (id) {
            if (additive && this.selectedNodeIds.has(id)) {
                this.selectedNodeIds.delete(id);
            } else {
                this.selectedNodeIds.add(id);
            }
            const node = this.currentProject.getNode(id);
            this.editor.showNode(node);
        } else {
            if (!additive) {
                this.selectedNodeIds.clear();
                this.editor.showNode(null);
            }
        }
        this.getActiveRenderer().draw();
    }

    getSelectedNode() {
        if (this.selectedNodeIds.size === 0) return null;
        const lastId = Array.from(this.selectedNodeIds).pop();
        return this.currentProject.getNode(lastId);
    }

    // =============================================
    // SEARCH
    // =============================================
    jumpToSearchResult(renderer) {
        const searchCounter = document.getElementById('search-counter');
        if (this.searchResults.length === 0) {
            if (searchCounter) {
                searchCounter.style.display = 'inline-flex';
                searchCounter.textContent = '0 výsledků';
                searchCounter.classList.add('no-results');
            }
            return;
        }

        const node = this.searchResults[this.searchIndex];
        renderer.hoveredNodeId = node.id;
        renderer.camera.x = -node.x + renderer.canvas.width / 2;
        renderer.camera.y = -node.y + renderer.canvas.height / 2;
        renderer.draw();

        if (searchCounter) {
            searchCounter.style.display = 'inline-flex';
            searchCounter.textContent = `${this.searchIndex + 1} / ${this.searchResults.length}`;
            searchCounter.classList.remove('no-results');
        }
    }

    // =============================================
    // HISTORY (UNDO/REDO)
    // =============================================
    pushHistory() {
        if (!this.currentProject) return;
        const snapshot = JSON.stringify(this.currentProject.toJSON());
        
        // Don't push if no change
        if (this.history.length > 0 && this.history[this.history.length - 1] === snapshot) return;
        
        this.history.push(snapshot);
        if (this.history.length > this.historyLimit) this.history.shift();
        this.redoStack = []; // Clear redo on new action
    }

    undo() {
        if (this.history.length < 2) return; // Need at least current + previous
        const current = this.history.pop();
        this.redoStack.push(current);
        
        const previous = this.history[this.history.length - 1];
        this.applySnapshot(previous);
        this.toast.info("Zpět (Undo)");
    }

    redo() {
        if (this.redoStack.length === 0) return;
        const snapshot = this.redoStack.pop();
        this.history.push(snapshot);
        this.applySnapshot(snapshot);
        this.toast.info("Vpřed (Redo)");
    }

    applySnapshot(jsonStr) {
        const data = JSON.parse(jsonStr);
        const project = Project.fromJSON(data);
        this.projects.set(project.id, project);
        this.currentProject = project;
        // Vyčistit selection — po undo/redo mohou být ID neplatná
        this.selectedNodeIds.clear();
        this.editor.showNode(null);
        this.renderTabs();
        this.getActiveRenderer().draw();
    }

    async saveToAPI() {
        if (!this.currentProject) return;
        try {
            await fetch('/api/save-project', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ project: this.currentProject.toJSON() })
            });
        } catch (err) {
            console.error("Auto-sync selhal", err);
        }
    }

    async loadFromAPI() {
        try {
            const res = await fetch('/api/load-projects');
            if (res.ok) {
                const data = await res.json();
                if (data.projects && data.projects.length > 0) {
                    this.projects.clear();
                    for (let pData of data.projects) {
                        const proj = Project.fromJSON(pData);
                        this.projects.set(proj.id, proj);
                    }
                    this.switchProject(data.projects[0].id);
                    this.pushHistory(); // V2.1 — First state
                    return true;
                }
            }
        } catch(e) {
            console.error("Load failed", e);
        }
        return false;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.appManager = new AppManager();
});
