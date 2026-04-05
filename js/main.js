import { Project } from './Project.js';
import { CanvasRenderer } from './CanvasRenderer.js';
import { SimulationRenderer } from './SimulationRenderer.js';
import { EditorController } from './EditorController.js';
import { ToastManager } from './ToastManager.js';

class AppManager {
    constructor() {
        this.projects = new Map();
        this.currentProject = null;
        this.selectedNodeId = null;
        this.isConnecting = false;

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
            
            // Cancel connection mode
            if (e.key === 'Escape' && this.isConnecting) {
                this.isConnecting = false;
                document.getElementById('connect-overlay').classList.add('hidden');
                return;
            }

            if (isInput) return;

            const selected = this.getSelectedNode();
            const renderer = this.getActiveRenderer();
            
            if (e.key === 'n' || e.key === 'N') {
                if (selected) {
                    const child = this.currentProject.addNode("Nový uzel", selected.x, selected.y + 120);
                    selected.addEdge(child.id);
                    this.selectNode(child.id);
                } else if (this.currentProject) {
                    const node = this.currentProject.addNode("Nový uzel", -renderer.camera.x + window.innerWidth/2, -renderer.camera.y + window.innerHeight/2);
                    this.selectNode(node.id);
                }
            }
            
            if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
                this.currentProject.deleteNode(selected.id);
                this.selectNode(null);
                renderer.draw();
            }

            if ((e.key === 'b' || e.key === 'B') && selected) {
                selected.isPinned = !selected.isPinned;
                this.editor.showNode(selected);
                renderer.draw();
            }

            // Arrow keys to move selected node
            if (selected && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
                e.preventDefault();
                const step = renderer.GRID_SIZE;
                if (e.key === 'ArrowUp') selected.y -= step;
                if (e.key === 'ArrowDown') selected.y += step;
                if (e.key === 'ArrowLeft') selected.x -= step;
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
        searchInput.addEventListener('input', (e) => {
            const q = e.target.value.toLowerCase();
            const renderer = this.getActiveRenderer();
            if (!this.currentProject || q.length === 0) {
                renderer.hoveredNodeId = null;
                return;
            }
            
            for (let [id, node] of this.currentProject.nodes) {
                let foundInNotes = node.notes.some(n => n.title.toLowerCase().includes(q) || (n.content && n.content.toLowerCase().includes(q)) || (n.tags && n.tags.some(t=>t.toLowerCase().includes(q))));
                
                if (node.title.toLowerCase().includes(q) || foundInNotes) {
                    renderer.hoveredNodeId = node.id;
                    renderer.camera.x = -node.x + renderer.canvas.width / 2;
                    renderer.camera.y = -node.y + renderer.canvas.height / 2;
                    return; 
                }
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
                    if (this.selectedNodeId && this.selectedNodeId !== clickedNode.id) {
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
            case 'new-rect': {
                const node = this.currentProject.addNode("Nový uzel", wp.x, wp.y);
                node.shape = 'rect';
                this.selectNode(node.id);
                break;
            }
            case 'new-diamond': {
                const node = this.currentProject.addNode("Nový uzel", wp.x, wp.y);
                node.shape = 'diamond';
                this.selectNode(node.id);
                break;
            }
            case 'connect-to-selected': {
                if (this.selectedNodeId && this.contextMenuNodeId) {
                    const selectedNode = this.currentProject.getNode(this.selectedNodeId);
                    if (selectedNode) {
                        selectedNode.addEdge(this.contextMenuNodeId);
                        this.editor.showNode(selectedNode);
                        this.toast.success('Spojení vytvořeno!');
                    }
                }
                break;
            }
            case 'toggle-shape': {
                if (this.contextMenuNodeId) {
                    const node = this.currentProject.getNode(this.contextMenuNodeId);
                    if (node) {
                        node.shape = node.shape === 'rect' ? 'diamond' : 'rect';
                        this.selectNode(node.id);
                    }
                }
                break;
            }
            case 'add-child': {
                if (this.contextMenuNodeId) {
                    const parent = this.currentProject.getNode(this.contextMenuNodeId);
                    if (parent) {
                        const child = this.currentProject.addNode("Nový uzel", parent.x, parent.y + 120);
                        parent.addEdge(child.id);
                        this.selectNode(child.id);
                    }
                }
                break;
            }
            case 'pin-node': {
                if (this.contextMenuNodeId) {
                    const node = this.currentProject.getNode(this.contextMenuNodeId);
                    if (node) {
                        node.isPinned = !node.isPinned;
                        this.selectNode(node.id);
                    }
                }
                break;
            }
            case 'delete-node': {
                if (this.contextMenuNodeId) {
                    this.currentProject.deleteNode(this.contextMenuNodeId);
                    if (this.selectedNodeId === this.contextMenuNodeId) {
                        this.selectNode(null);
                    }
                    renderer.draw();
                }
                break;
            }
        }
    }

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
        }
    }

    renderTabs() {
        const container = document.getElementById('tabs-container');
        container.innerHTML = '';
        
        for (let [id, proj] of this.projects) {
            const tab = document.createElement('div');
            tab.className = `tab ${this.currentProject && this.currentProject.id === id ? 'active' : ''}`;
            tab.innerHTML = `<span class="tab-mode-icon">${proj.mode==='simulation'?'🎲':'📁'}</span> ${proj.name}`;
            
            tab.addEventListener('dblclick', () => {
                const newName = prompt("Nové jméno projektu:", proj.name);
                if (newName) {
                    proj.name = newName;
                    this.renderTabs();
                    this.saveToAPI(); 
                }
            });

            tab.addEventListener('click', () => {
                this.switchProject(id);
            });
            container.appendChild(tab);
        }
    }

    selectNode(id) {
        if (id) {
            this.selectedNodeId = id;
            const node = this.currentProject.getNode(id);
            this.editor.showNode(node);
        } else {
            this.selectedNodeId = null;
            this.editor.showNode(null);
        }
        this.getActiveRenderer().draw();
    }

    getSelectedNode() {
        return this.selectedNodeId ? this.currentProject.getNode(this.selectedNodeId) : null;
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
