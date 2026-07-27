import { Project } from './Project.js';
import { ProjectNode } from './ProjectNode.js';
import { CanvasRenderer } from './CanvasRenderer.js';
import { SimulationRenderer } from './SimulationRenderer.js';
import { EditorController } from './EditorController.js';
import { ToastManager } from './ToastManager.js';
import { TimelineRenderer } from './TimelineRenderer.js';
import { MasterDocController } from './MasterDocController.js';

const PLANER_APP_SETTINGS_KEY = 'planer_app_settings';

class AppManager {
    static defaultAppSettings() {
        return {
            remindOnTabLeave: true,
            remindOnTabReturn: false,
            snapToGrid: true,
            uiStyle: 'neon',
            uiFont: 'inter',
        };
    }

    /** CSS font stack pro UI (--app-font-sans / --app-font-display) */
    static fontCssStack(key) {
        const map = {
            inter: "'Inter', system-ui, sans-serif",
            system: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif",
            serif: "Georgia, 'Times New Roman', serif",
            mono: "'Consolas', 'Courier New', monospace",
        };
        return map[key] || map.inter;
    }

    /** Jedno jméno písma pro canvas measureText / fillText */
    static fontForCanvas(key) {
        const map = { inter: 'Inter', system: 'system-ui', serif: 'Georgia', mono: 'Consolas' };
        return map[key] || 'Inter';
    }

    static readAppSettingsFromStorage() {
        try {
            const raw = localStorage.getItem(PLANER_APP_SETTINGS_KEY);
            if (!raw) return { ...AppManager.defaultAppSettings() };
            const parsed = JSON.parse(raw);
            if (typeof parsed !== 'object' || !parsed) return { ...AppManager.defaultAppSettings() };
            return { ...AppManager.defaultAppSettings(), ...parsed };
        } catch {
            return { ...AppManager.defaultAppSettings() };
        }
    }

    static writeAppSettingsToStorage(settings) {
        try {
            const merged = { ...AppManager.defaultAppSettings(), ...settings };
            localStorage.setItem(PLANER_APP_SETTINGS_KEY, JSON.stringify(merged));
        } catch (e) {
            console.warn('planer: nelze uložit nastavení aplikace', e);
        }
    }

    constructor() {
        this.projects = new Map();
        this.currentProject = null;
        this.selectedNodeIds = new Set(); // V2.1 — Multi-select
        this.isConnecting = false;
        this.appSettings = AppManager.readAppSettingsFromStorage();
        this.snapToGrid = !!this.appSettings.snapToGrid; // V2.4
        this.applyAppearanceSettings();

        // Search state
        this.searchResults = [];
        this.searchIndex = -1;

        // V2.1 — History (Undo/Redo)
        this.history = [];
        this.redoStack = [];
        this.historyLimit = 300;

        // V2.0 — Toast systém
        this.toast = new ToastManager();

        // V2.0 — Oba renderery
        this.canvasRenderer = new CanvasRenderer('project-canvas', this);
        this.simRenderer = new SimulationRenderer('simulation-canvas', this);
        
        // Context menu state
        this.contextMenuWorldPos = null;
        this.contextMenuNodeId = null;
        this.contextMenuEdge = null; // V2.3: { sourceNodeId, targetId }
        
        this.editor = new EditorController(this);
        this.masterDoc = new MasterDocController(this);
        
        // V2.2 — Performance & Alignment
        this.performanceMode = false;
        this.alignmentLines = { x: null, y: null };

        // Focus Mode & Heatmap (V3.0)
        this.focusMode = false;
        this.focusConnectedIds = new Set();
        this.heatmapMode = false;


        this.setupUI();
        this.setupAppSettings();
        this.setupShortcuts();
        this.setupContextMenu();
        this.setupShortcutsHelp();
        this.setupTimeline();
        this.setupOnboarding();
        this.initApp();
    }

    setupOnboarding() {
        const KEY = 'planer_onboarded';
        const modal = document.getElementById('onboarding-modal');
        const okBtn = document.getElementById('onboarding-ok-btn');
        if (!modal || !okBtn) return;

        const dismiss = () => {
            modal.classList.add('hidden');
            try { localStorage.setItem(KEY, '1'); } catch (_) { /* ignore */ }
        };
        okBtn.addEventListener('click', dismiss);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) dismiss();
        });

        try {
            if (localStorage.getItem(KEY) === '1') return;
        } catch (_) { /* show anyway */ }
        // Po načtení UI — krátký delay ať nepřekryje toast z loadu
        setTimeout(() => modal.classList.remove('hidden'), 400);
    }

    applyAppearanceSettings() {
        const stack = AppManager.fontCssStack(this.appSettings.uiFont);
        document.documentElement.style.setProperty('--app-font-sans', stack);
        document.documentElement.style.setProperty('--app-font-display', stack);
        document.body.classList.toggle('ui-gray', this.appSettings.uiStyle === 'gray');
    }

    // V4.0 — Klávesové zkratky nápověda (? tlačítko)
    setupShortcutsHelp() {
        const btn = document.getElementById('shortcuts-help-btn');
        const panel = document.getElementById('shortcuts-panel');
        const closeBtn = document.getElementById('shortcuts-panel-close');

        if (!btn || !panel) return;

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = !panel.classList.contains('hidden');
            if (isOpen) {
                panel.classList.add('hidden');
                btn.classList.remove('active');
            } else {
                panel.classList.remove('hidden');
                btn.classList.add('active');
            }
        });

        closeBtn?.addEventListener('click', () => {
            panel.classList.add('hidden');
            btn.classList.remove('active');
        });

        // Zavřít klikem mimo panel
        document.addEventListener('click', (e) => {
            if (!panel.contains(e.target) && e.target !== btn) {
                panel.classList.add('hidden');
                btn.classList.remove('active');
            }
        });

        // Zavřít klávesou Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !panel.classList.contains('hidden')) {
                panel.classList.add('hidden');
                btn.classList.remove('active');
            }
        });
    }

    /** Modal „Aplikace“, localStorage, připomínky při přepnutí záložky, export JSON */
    setupAppSettings() {
        const modal = document.getElementById('app-settings-modal');
        const openBtn = document.getElementById('app-settings-btn');
        const saveBtn = document.getElementById('app-settings-save-btn');
        const closeBtn = document.getElementById('app-settings-close-btn');
        const exportBtn = document.getElementById('app-export-btn');
        const leaveCb = document.getElementById('app-set-tab-leave');
        const returnCb = document.getElementById('app-set-tab-return');
        const snapCb = document.getElementById('app-set-snap-grid');
        const uiStyleSel = document.getElementById('app-set-ui-style');
        const uiFontSel = document.getElementById('app-set-font');
        const fontKeys = new Set(['inter', 'system', 'serif', 'mono']);

        const fillModal = () => {
            if (leaveCb) leaveCb.checked = !!this.appSettings.remindOnTabLeave;
            if (returnCb) returnCb.checked = !!this.appSettings.remindOnTabReturn;
            if (snapCb) snapCb.checked = !!this.appSettings.snapToGrid;
            if (uiStyleSel) uiStyleSel.value = this.appSettings.uiStyle === 'gray' ? 'gray' : 'neon';
            if (uiFontSel) {
                uiFontSel.value = fontKeys.has(this.appSettings.uiFont) ? this.appSettings.uiFont : 'inter';
            }
        };

        openBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            fillModal();
            modal?.classList.remove('hidden');
        });

        closeBtn?.addEventListener('click', () => modal?.classList.add('hidden'));

        modal?.addEventListener('click', (e) => {
            if (e.target === modal) modal.classList.add('hidden');
        });

        saveBtn?.addEventListener('click', () => {
            this.appSettings.remindOnTabLeave = !!(leaveCb?.checked);
            this.appSettings.remindOnTabReturn = !!(returnCb?.checked);
            this.appSettings.snapToGrid = !!(snapCb?.checked);
            this.appSettings.uiStyle = uiStyleSel?.value === 'gray' ? 'gray' : 'neon';
            this.appSettings.uiFont = fontKeys.has(uiFontSel?.value) ? uiFontSel.value : 'inter';
            this.snapToGrid = this.appSettings.snapToGrid;
            this.applyAppearanceSettings();
            AppManager.writeAppSettingsToStorage(this.appSettings);
            this.getActiveRenderer()?.draw();
            this.timelineRenderer?.draw?.();
            this.toast.success('Nastavení aplikace uloženo.');
            modal?.classList.add('hidden');
        });

        exportBtn?.addEventListener('click', () => this.downloadProjectsExportJson());

        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape' || !modal || modal.classList.contains('hidden')) return;
            modal.classList.add('hidden');
        });

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                if (this.appSettings.remindOnTabLeave) {
                    this.toast.info('Planer běží na pozadí — nezapomeň uložit (Uložit synchro).', 4500);
                }
            } else if (document.visibilityState === 'visible') {
                if (this.appSettings.remindOnTabReturn) {
                    this.toast.success('Vítej zpět u Planeru.', 2500);
                }
            }
        });
    }

    downloadProjectsExportJson() {
        const d = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const fname = `planer-export-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
        const payload = {
            exportVersion: 1,
            exportedAt: d.toISOString(),
            appSettings: { ...this.appSettings },
            projects: Array.from(this.projects.values()).map((p) => p.toJSON()),
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fname;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        this.toast.success('Export JSON stažen.');
    }

    // V4.1 — Timeline inicializace
    setupTimeline() {
        this.timelineRenderer = new TimelineRenderer('timeline-canvas', this);

        const panel = document.getElementById('timeline-panel');
        const toggleBtn = document.getElementById('timeline-toggle-btn');
        const settingsBtn = document.getElementById('timeline-settings-btn');
        const addEventBtn = document.getElementById('timeline-add-event-btn');
        const settingsModal = document.getElementById('timeline-settings-modal');
        const eventModal = document.getElementById('timeline-event-modal');

        // Toggle collapse/expand
        toggleBtn?.addEventListener('click', () => {
            panel.classList.toggle('collapsed');
            toggleBtn.textContent = panel.classList.contains('collapsed') ? '▲' : '▼';
            if (!panel.classList.contains('collapsed')) {
                this.timelineRenderer.resize();
                this.timelineRenderer.draw();
            }
        });

        // Settings modal
        settingsBtn?.addEventListener('click', () => {
            const tl = this.currentProject?.timeline;
            if (!tl) return;
            document.getElementById('tl-granularity').value = tl.granularity || 'years';
            document.getElementById('tl-start-year').value = tl.startYear || 2000;
            document.getElementById('tl-end-year').value = tl.endYear || 2050;
            settingsModal.classList.remove('hidden');
        });

        document.getElementById('tl-settings-close-btn')?.addEventListener('click', () => {
            settingsModal.classList.add('hidden');
        });

        document.getElementById('tl-settings-save-btn')?.addEventListener('click', () => {
            const tl = this.currentProject?.timeline;
            if (!tl) return;
            tl.granularity = document.getElementById('tl-granularity').value;
            tl.startYear = parseInt(document.getElementById('tl-start-year').value) || 2000;
            tl.endYear = parseInt(document.getElementById('tl-end-year').value) || 2050;
            if (tl.startYear >= tl.endYear) { this.toast.error('Rok "Od" musí být menší než "Do"!'); return; }
            this.timelineRenderer.draw();
            this.saveToAPI();
            settingsModal.classList.add('hidden');
            this.toast.success('Nastavení timeline uloženo!');
        });

        // Add event modal
        addEventBtn?.addEventListener('click', () => {
            document.getElementById('tl-event-name').value = '';
            document.getElementById('tl-event-year').value = new Date().getFullYear();
            eventModal.classList.remove('hidden');
            setTimeout(() => document.getElementById('tl-event-name')?.focus(), 50);
        });

        document.getElementById('tl-event-close-btn')?.addEventListener('click', () => {
            eventModal.classList.add('hidden');
        });

        document.getElementById('tl-event-add-btn')?.addEventListener('click', () => {
            this._addTimelineEvent(
                document.getElementById('tl-event-name').value,
                document.getElementById('tl-event-year').value
            );
            eventModal.classList.add('hidden');
        });

        // Resize logic (V4.2)
        const resizer = document.getElementById('timeline-resizer');
        let isResizing = false;

        resizer?.addEventListener('mousedown', (e) => {
            if (panel.classList.contains('collapsed')) return;
            isResizing = true;
            panel.style.transition = 'none'; // Disable transition for smooth resizing
            document.body.style.cursor = 'ns-resize';
            panel.classList.add('is-resizing');
            e.preventDefault();
        });

        window.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            // e.clientY is mouse position from top
            // panel is pinned to bottom: 0;
            // height = window.innerHeight - e.clientY;
            let newHeight = window.innerHeight - e.clientY;
            
            // Constraints
            const minH = 100;
            const maxH = window.innerHeight * 0.4;
            if (newHeight < minH) newHeight = minH;
            if (newHeight > maxH) newHeight = maxH;

            panel.style.height = newHeight + 'px';
            this.timelineRenderer?.resize();
            this.timelineRenderer?.draw();
        });

        window.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                panel.style.transition = ''; // Restore transition
                document.body.style.cursor = 'default';
                panel.classList.remove('is-resizing');
                // Save to current project if needed (V4.2)
                if (this.currentProject?.timeline) {
                    this.currentProject.timeline.height = parseInt(panel.style.height);
                    this.saveToAPI();
                }
            }
        });
    }

    _addTimelineEvent(name, year) {
        if (!name || !year || !this.currentProject) return;
        const tl = this.currentProject.timeline;
        if (!tl) return;
        this.pushHistory();
        const node = this.currentProject.addNode(name || 'Event', 100, 100);
        node.timelineDate = String(parseInt(year));
        tl.enabled = true;
        const panel = document.getElementById('timeline-panel');
        panel?.classList.remove('hidden');
        this.timelineRenderer?.resize();
        this.timelineRenderer?.draw();
        this.canvasRenderer.draw();
        this.toast.success(`Event "${name}" přidán na timeline!`);
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
        const timelinePanel = document.getElementById('timeline-panel');
        
        this.updatePerformanceMode(); // V2.2 check

        if (this.currentProject && this.currentProject.mode === 'simulation') {
            this.canvasRenderer.endStickyInlineEdit(true);
            dataCanvas.style.display = 'none';
            simCanvas.style.display = 'block';
            this.simRenderer.resize();
            // Timeline jen v Data módu
            if (timelinePanel) timelinePanel.classList.add('hidden');
        } else {
            dataCanvas.style.display = 'block';
            simCanvas.style.display = 'none';
            this.canvasRenderer.resize();
            // Zobrazit timeline jen pokud je povolena
            if (timelinePanel && this.currentProject?.timeline?.enabled) {
                timelinePanel.classList.remove('hidden');
                // Apply saved height (V4.2)
                if (this.currentProject.timeline.height) {
                    timelinePanel.style.height = this.currentProject.timeline.height + 'px';
                }
                this.timelineRenderer?.resize();
                this.timelineRenderer?.draw();
            } else if (timelinePanel) {
                timelinePanel.classList.add('hidden');
            }
        }
    }

    // V2.2 — Auto-switch performance mode based on node count
    updatePerformanceMode() {
        if (!this.currentProject) return;
        const count = this.currentProject.nodes.size;
        const oldMode = this.performanceMode;
        this.performanceMode = count > 100;
        
        if (oldMode !== this.performanceMode) {
            this.toast.info(this.performanceMode ? "🚀 Performance mode AKTIVNÍ (>100 uzlů)" : "✨ Standardní grafika AKTIVNÍ");
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
            // Uložit (Ctrl+S) — i z editoru
            if (e.ctrlKey && (e.key === 's' || e.key === 'S')) {
                e.preventDefault();
                void (async () => {
                    const ok = await this.saveToAPI();
                    if (ok) this.toast.success('Uloženo (Ctrl+S)');
                })();
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

            // === VYTVOŘENÍ STICKY NOTE (T) ===
            if (e.key === 't' || e.key === 'T') {
                if (!this.currentProject) return;
                this.pushHistory();
                const sticky = this.currentProject.addNode(
                    "Sticky poznámka",
                    -renderer.camera.x + window.innerWidth / 2 - 100,
                    -renderer.camera.y + window.innerHeight / 2 - 60
                );
                sticky.shape = 'sticky';
                sticky.stickyText = '';
                sticky.stickyCreatedAt = new Date().toISOString();
                sticky.width = 220;
                sticky.height = 120;
                this.selectNode(sticky.id);
                this.toast.success('Sticky poznámka přidána');
                return;
            }

            // === NOTEBOOK MODE TOGGLE (J) ===
            if (e.key === 'j' || e.key === 'J') {
                if (this.editor?.toggleNotebookMode) {
                    this.editor.toggleNotebookMode();
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

            // === PŘEJMENOVÁNÍ / STICKY INLINE (F2) ===
            if (e.key === 'F2') {
                e.preventDefault();
                const selectedId = Array.from(this.selectedNodeIds)[0];
                if (selectedId) {
                    const node = this.currentProject.getNode(selectedId);
                    if (node.shape === 'sticky' && this.currentProject.mode === 'data') {
                        this.canvasRenderer.beginStickyInlineEdit(node);
                    } else {
                        const newTitle = prompt("Přejmenovat uzel:", node.title);
                        if (newTitle !== null) {
                            this.pushHistory();
                            node.title = newTitle;
                            this.editor.renderCurrentNode();
                            renderer.draw();
                        }
                    }
                }
                return;
            }

            // === PŘEPNUTÍ PŘICHYTÁVÁNÍ (G) (V2.4) ===
            if (e.key === 'g' || e.key === 'G') {
                this.snapToGrid = !this.snapToGrid;
                this.appSettings.snapToGrid = this.snapToGrid;
                AppManager.writeAppSettingsToStorage(this.appSettings);
                this.toast.info(this.snapToGrid ? '🧲 Snapping ZAPNUT' : '✨ Snapping VYPNUT');
                return;
            }

            // === FOCUS MODE (F) === 
            if (e.key === 'f' || e.key === 'F') {
                if (this.focusMode) {
                    // Vypnout
                    this.focusMode = false;
                    this.focusConnectedIds.clear();
                    this.toast.info('👁️ Focus Mode VYPNUT');
                } else if (selected) {
                    // Zapnout pro vybraný uzel
                    this.focusMode = true;
                    this.buildFocusSet(selected.id);
                    this.toast.info('🔦 Focus Mode: ' + selected.title);
                } else {
                    this.toast.info('⚠️ Nejdříve vyber uzel.');
                }
                renderer.draw();
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

        // === HEATMAP MODE (H hold) ===
        window.addEventListener('keydown', (e) => {
            if ((e.key === 'h' || e.key === 'H') && !e.ctrlKey && !e.repeat) {
                const activeTag = document.activeElement.tagName.toLowerCase();
                const isInput = activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select' || document.activeElement.isContentEditable;
                if (!isInput) {
                    this.heatmapMode = true;
                    this.getActiveRenderer().draw();
                }
            }
        });
        window.addEventListener('keyup', (e) => {
            if (e.key === 'h' || e.key === 'H') {
                this.heatmapMode = false;
                this.getActiveRenderer().draw();
            }
        });
    }

    setupUI() {
        const themeBtn = document.getElementById('theme-toggle-btn');
        themeBtn.addEventListener('click', () => {
            const isLight = document.body.classList.toggle('light-mode');
            localStorage.setItem('planer_theme', isLight ? 'light' : 'dark');
            this.getActiveRenderer().draw();
            this.editor?.renderCurrentNode?.();
            this.timelineRenderer?.draw?.();
        });
        
        if (localStorage.getItem('planer_theme') === 'light') {
            document.body.classList.add('light-mode');
        }

        document.getElementById('add-tab-btn').addEventListener('click', () => {
            this.createNewProject();
        });

        // Brain Dump banner — zavřít tlačítko
        const brainDumpClose = document.getElementById('brain-dump-banner-close');
        if (brainDumpClose) {
            brainDumpClose.addEventListener('click', () => {
                document.getElementById('brain-dump-banner').classList.add('hidden');
            });
        }

        document.getElementById('save-btn').addEventListener('click', async () => {
            const ok = await this.saveToAPI();
            if (ok) this.toast.success('Synchro uloženo!');
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
                const stickyPlain = (node.shape === 'sticky' && node.stickyText)
                    ? ProjectNode.stickyPlainText(node.stickyText).toLowerCase()
                    : '';
                const inSticky = stickyPlain.includes(q);
                if (node.title.toLowerCase().includes(q) || foundInNotes || inSticky) {
                    this.searchResults.push(node);
                }
            }

            // Notebook fulltext (Fáze 2)
            const pages = this.currentProject.notebook?.pages || [];
            const notebookHit = pages.some(page =>
                (page.title || '').toLowerCase().includes(q) ||
                (page.content || '').toLowerCase().includes(q)
            );
            if (notebookHit && searchCounter) {
                searchCounter.title = 'Část výsledků je v Notebook režimu';
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
                // Naplnit timeline checkbox
                const tlCheck = document.getElementById('proj-timeline-enabled');
                if (tlCheck) tlCheck.checked = !!this.currentProject.timeline?.enabled;
                // Skrýt timeline volbu v Simulaci (jen pro Data mód)
                const tlGroup = document.getElementById('proj-timeline-group');
                if (tlGroup) tlGroup.style.display = this.currentProject.mode === 'simulation' ? 'none' : '';
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

                // Uložit timeline enabled
                const tlCheck = document.getElementById('proj-timeline-enabled');
                if (tlCheck && this.currentProject.timeline) {
                    this.currentProject.timeline.enabled = tlCheck.checked;
                }

                // V2.0 — Sync camera when switching modes
                if (oldMode !== this.currentProject.mode) {
                    const from = oldMode === 'simulation' ? this.simRenderer : this.canvasRenderer;
                    const to = this.currentProject.mode === 'simulation' ? this.simRenderer : this.canvasRenderer;
                    to.camera = { ...from.camera };
                    if (this.currentProject.mode === 'simulation') {
                        this.toast.warning('Simulace je experimental / beta', 4000);
                    } else {
                        this.toast.info('Přepnuto na mód: Data 📁');
                    }
                }

                this.updateCanvasVisibility(); // Přepne i viditelnost timeline
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
                void this.switchProject(firstKey);
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
                const edgeActions = document.getElementById('ctx-edge-actions');
                const dividerNode = document.getElementById('ctx-divider-node');
                const dividerConnect = document.getElementById('ctx-divider-connect');
                const dividerEdge = document.getElementById('ctx-divider-edge');

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
                    // Hide edge actions when node is clicked
                    edgeActions.style.display = 'none';
                    dividerEdge.style.display = 'none';
                } else {
                    nodeActions.style.display = 'none';
                    dividerNode.style.display = 'none';
                    connectSection.style.display = 'none';
                    dividerConnect.style.display = 'none';

                    // Check for edges if no node clicked (V2.3)
                    const clickedEdge = renderer.getEdgeAt ? renderer.getEdgeAt(worldPos) : null;
                    this.contextMenuEdge = clickedEdge;

                    if (clickedEdge) {
                        edgeActions.style.display = '';
                        dividerEdge.style.display = '';
                    } else {
                        edgeActions.style.display = 'none';
                        dividerEdge.style.display = 'none';
                    }
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

        // V2.4 — Color pickers for context menu
        const edgeColorsDiv = document.getElementById('ctx-edge-colors');
        const nodeColorsDiv = document.getElementById('ctx-node-colors');
        
        // Import check: we need EDGE_COLORS (it's accessible via ProjectNode since it's exported)
        import('./ProjectNode.js').then(module => {
            const colors = module.EDGE_COLORS;
            const renderDots = (container, callback) => {
                container.innerHTML = '';
                for (let [cid, info] of Object.entries(colors)) {
                    const dot = document.createElement('div');
                    dot.className = 'color-dot';
                    dot.style.backgroundColor = info.hex;
                    dot.title = info.label;
                    dot.onclick = (e) => {
                        e.stopPropagation();
                        callback(cid, info.hex);
                    };
                    container.appendChild(dot);
                }
            };

            renderDots(edgeColorsDiv, (colorId, hex) => {
                if (this.contextMenuEdge) {
                    this.pushHistory();
                    const node = this.currentProject.getNode(this.contextMenuEdge.sourceNodeId);
                    const edge = node.edges.find(e => e.targetId === this.contextMenuEdge.targetId);
                    if (edge) {
                        edge.color = colorId;
                        this.getActiveRenderer().draw();
                    }
                    this.hideContextMenu();
                }
            });

            renderDots(nodeColorsDiv, (colorId, hex) => {
                if (this.contextMenuNodeId) {
                    this.pushHistory();
                    const node = this.currentProject.getNode(this.contextMenuNodeId);
                    node.color = hex;
                    this.getActiveRenderer().draw();
                    this.hideContextMenu();
                }
            });
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
            case 'new-hexagon':
            case 'new-pill': {
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
            case 'new-sticky': {
                this.pushHistory();
                const sticky = this.currentProject.addNode("Sticky poznámka", wp.x, wp.y);
                sticky.shape = 'sticky';
                sticky.stickyText = '';
                sticky.stickyCreatedAt = new Date().toISOString();
                sticky.width = 220;
                sticky.height = 120;
                this.selectNode(sticky.id);
                this.toast.success('Sticky poznámka vytvořena');
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
                    const shapes = ['rect', 'diamond', 'circle', 'hexagon', 'pill'];
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
            case 'add-to-timeline': {
                if (this.contextMenuNodeId) {
                    const node = this.currentProject.getNode(this.contextMenuNodeId);
                    const year = prompt(`Přidej "${node.title}" do timeline. Zadej rok:`, String(new Date().getFullYear()));
                    if (year !== null) {
                        const parsedYear = parseInt(year);
                        if (!isNaN(parsedYear)) {
                            this.pushHistory();
                            node.timelineDate = String(parsedYear);
                            const tl = this.currentProject.timeline;
                            tl.enabled = true;
                            // Rozšíř rozsah timeline pokud je rok mimo
                            if (parsedYear < tl.startYear) tl.startYear = parsedYear - 5;
                            if (parsedYear > tl.endYear) tl.endYear = parsedYear + 5;
                            const panel = document.getElementById('timeline-panel');
                            panel?.classList.remove('hidden');
                            this.timelineRenderer?.resize();
                            this.timelineRenderer?.draw();
                            this.toast.success(`📅 "${node.title}" přidán na timeline (${parsedYear})`);
                        } else {
                            this.toast.error('Neplatný rok!');
                        }
                    }
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
                    this.timelineRenderer?.draw();
                }
                break;
            }
            case 'delete-edge': {
                if (this.contextMenuEdge) {
                    this.pushHistory();
                    const sourceNode = this.currentProject.getNode(this.contextMenuEdge.sourceNodeId);
                    if (sourceNode) {
                        sourceNode.removeEdge(this.contextMenuEdge.targetId);
                        this.editor.renderEdgesList();
                        renderer.draw();
                        this.toast.success("Spojení smazáno");
                    }
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
                    let data = {};
                    try { data = await res.json(); } catch (_) { /* ignore */ }
                    if (res.ok && data.url) {
                        // Načteme obrázek pro zjištění přirozeného rozměru
                        const tempImg = new Image();
                        tempImg.onload = () => {
                            const MAX_W = 320;
                            const ratio = tempImg.naturalHeight / tempImg.naturalWidth;
                            const nodeW = Math.min(tempImg.naturalWidth, MAX_W);
                            const nodeH = Math.round(nodeW * ratio);

                            const node = this.currentProject.addNode(file.name, worldPos.x, worldPos.y);
                            node.shape = 'image';
                            node.nodeImage = data.url;
                            node.width = nodeW;
                            node.height = nodeH;
                            this.selectNode(node.id);
                            this.editor.showNode(node); // Aktualizovat W/H vstupy
                            this.toast.success("Obrázkový uzel přidán!");
                        };
                        tempImg.onerror = () => {
                            // Fallback pro případě chyby
                            const node = this.currentProject.addNode(file.name, worldPos.x, worldPos.y);
                            node.shape = 'image';
                            node.nodeImage = data.url;
                            node.width = 240;
                            node.height = 160;
                            this.selectNode(node.id);
                            this.toast.success("Obrázkový uzel přidán!");
                        };
                        tempImg.src = data.url;
                    } else {
                        const msg = res.status === 413
                            ? 'Obrázek je příliš velký — zmenši soubor nebo rozlišení.'
                            : 'Nahrávání obrázku selhalo.';
                        this.toast.error(msg);
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
        void this.switchProject(id);
    }

    async switchProject(id, skipBrainDump = false) {
        if (!this.projects.has(id)) return;

        // Brain Dump při odchodu z existujícího projektu
        if (this.currentProject && this.currentProject.id !== id && !skipBrainDump) {
            const leavingProject = this.currentProject;
            this.showBrainDumpModal(leavingProject, () => {
                void this.switchProject(id, true);
            });
            return;
        }

        await this.masterDoc?.prepareProjectSwitch();

        this.canvasRenderer.endStickyInlineEdit(true);
        this.currentProject = this.projects.get(id);
        let rootId = null;
        let centerPos = null;
        let firstId = null;

        // Najít Pinned uzel, nebo vzít první
        for (let [nid, node] of this.currentProject.nodes) {
            if (!firstId) firstId = nid;
            if (node.isPinned) {
                rootId = nid;
                centerPos = { x: node.x + node.width / 2, y: node.y + node.height / 2 };
                break;
            }
        }

        if (!rootId && firstId) {
            rootId = firstId;
            const rngNode = this.currentProject.getNode(rootId);
            centerPos = { x: rngNode.x + rngNode.width / 2, y: rngNode.y + rngNode.height / 2 };
        }

        this.selectNode(rootId);
        this.renderTabs();

        const zoom = this.canvasRenderer.camera ? this.canvasRenderer.camera.zoom : 1;
        const cx = centerPos ? -centerPos.x + (window.innerWidth / 2) / zoom : 0;
        const cy = centerPos ? -centerPos.y + (window.innerHeight / 2) / zoom : 0;

        this.canvasRenderer.camera = { ...this.canvasRenderer.camera, x: cx, y: cy };
        this.simRenderer.camera = { ...this.simRenderer.camera, x: cx, y: cy };

        this.updateCanvasVisibility();
        this.pushHistory();

        // Zobrazit Brain Dump banner pokud projekt má uložený zápisník
        this.showBrainDumpBanner(this.currentProject.brainDump);

        await this.masterDoc?.loadForProject(this.currentProject);
    }

    showBrainDumpModal(project, onDone) {
        const modal = document.getElementById('brain-dump-modal');
        const input = document.getElementById('brain-dump-input');
        const saveBtn = document.getElementById('brain-dump-save-btn');
        const skipBtn = document.getElementById('brain-dump-skip-btn');

        // Předvyplnit předchozí zápisník pokud existuje
        input.value = project.brainDump || '';
        modal.classList.remove('hidden');
        setTimeout(() => input.focus(), 100);

        const finish = (save) => {
            if (save) {
                const text = input.value.trim();
                project.brainDump = text || null;
                this.saveToAPI();
            }
            modal.classList.add('hidden');
            input.value = '';
            saveBtn.removeEventListener('click', onSave);
            skipBtn.removeEventListener('click', onSkip);
            onDone();
        };

        const onSave = () => finish(true);
        const onSkip = () => finish(false);

        saveBtn.addEventListener('click', onSave, { once: true });
        skipBtn.addEventListener('click', onSkip, { once: true });
    }

    showBrainDumpBanner(text) {
        const banner = document.getElementById('brain-dump-banner');
        const bannerText = document.getElementById('brain-dump-banner-text');

        if (text && text.trim()) {
            bannerText.textContent = text;
            banner.classList.remove('hidden');
        } else {
            banner.classList.add('hidden');
        }
    }


    renderTabs() {
        const container = document.getElementById('tabs-container');
        container.innerHTML = '';
        
        for (let [id, proj] of this.projects) {
            const tab = document.createElement('div');
            tab.className = `tab ${this.currentProject && this.currentProject.id === id ? 'active' : ''}`;
            tab.innerHTML = `<span class="tab-mode-icon">${proj.mode==='simulation'?'🎲':'📁'}</span> ${proj.name}${proj.mode==='simulation'?' <span class="tab-beta-badge" title="Experimental">β</span>':''}`;
            
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
                void this.switchProject(id);
            });
            container.appendChild(tab);
        }
    }

    selectNode(id, additive = false) {
        const editingSticky = this.canvasRenderer?.getStickyEditingNodeId?.();
        if (editingSticky) {
            const keep = id === editingSticky && !additive;
            if (!keep) {
                this.canvasRenderer.endStickyInlineEdit(true);
            }
        }

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

    // Focus Mode BFS — rekurzivně přes obousměrné hrany
    buildFocusSet(startId) {
        if (!this.currentProject) return;
        const visited = new Set();
        const queue = [startId];

        // Vybuduj mapu zpětných hran (kdo ukazuje NA daný uzel)
        const incomingEdges = new Map();
        for (let [id, node] of this.currentProject.nodes) {
            for (let edge of node.edges) {
                if (!incomingEdges.has(edge.targetId)) incomingEdges.set(edge.targetId, []);
                incomingEdges.get(edge.targetId).push(id);
            }
        }

        while (queue.length > 0) {
            const current = queue.shift();
            if (visited.has(current)) continue;
            visited.add(current);

            const node = this.currentProject.getNode(current);
            if (!node) continue;

            // Odchozí hrany
            for (let edge of node.edges) {
                if (!visited.has(edge.targetId)) queue.push(edge.targetId);
            }
            // Příchozí hrany
            const incoming = incomingEdges.get(current) || [];
            for (let srcId of incoming) {
                if (!visited.has(srcId)) queue.push(srcId);
            }
        }

        this.focusConnectedIds = visited;
    }

    // V2.2 — Smart Alignment Guides logic
    getAlignmentLines(draggingNode) {
        if (!this.currentProject || !draggingNode) return { x: null, y: null };
        const threshold = 5;
        let bestX = null;
        let bestY = null;

        for (let [id, node] of this.currentProject.nodes) {
            if (id === draggingNode.id) continue;
            
            // Align X (Left, Center, Right)
            const dx_left = Math.abs(draggingNode.x - node.x);
            const dx_center = Math.abs((draggingNode.x + draggingNode.width/2) - (node.x + node.width/2));
            const dx_right = Math.abs((draggingNode.x + draggingNode.width) - (node.x + node.width));
            
            if (dx_left < threshold) { draggingNode.x = node.x; bestX = node.x; }
            else if (dx_center < threshold) { draggingNode.x = node.x + node.width/2 - draggingNode.width/2; bestX = node.x + node.width/2; }
            else if (dx_right < threshold) { draggingNode.x = node.x + node.width - draggingNode.width; bestX = node.x + node.width; }

            // Align Y (Top, Center, Bottom)
            const dy_top = Math.abs(draggingNode.y - node.y);
            const dy_center = Math.abs((draggingNode.y + draggingNode.height/2) - (node.y + node.height/2));
            const dy_bottom = Math.abs((draggingNode.y + draggingNode.height) - (node.y + node.height));

            if (dy_top < threshold) { draggingNode.y = node.y; bestY = node.y; }
            else if (dy_center < threshold) { draggingNode.y = node.y + node.height/2 - draggingNode.height/2; bestY = node.y + node.height/2; }
            else if (dy_bottom < threshold) { draggingNode.y = node.y + node.height - draggingNode.height; bestY = node.y + node.height; }
        }
        return { x: bestX, y: bestY };
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
        void this.masterDoc?.loadForProject(this.currentProject);
    }

    /** Mapuje HTTP status z API na uživatelskou hlášku */
    apiErrorMessage(status, fallback = 'Požadavek selhal') {
        if (status === 413) return 'Soubor nebo data jsou příliš velká (limit serveru).';
        if (status === 400) return 'Neplatná data — zkus to znovu.';
        if (status === 403) return 'Přístup odepřen.';
        if (status === 404) return 'Endpoint nenalezen.';
        if (status >= 500) return 'Chyba serveru při ukládání.';
        return fallback;
    }

    async saveToAPI() {
        if (!this.currentProject) return false;
        try {
            const res = await fetch('/api/save-project', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ project: this.currentProject.toJSON() })
            });
            if (!res.ok) {
                this.toast.error(this.apiErrorMessage(res.status, 'Uložení selhalo'));
                return false;
            }
            return true;
        } catch (err) {
            console.error('Auto-sync selhal', err);
            this.toast.error('Nelze spojit se serverem — je sidecar / server.py spuštěný?');
            return false;
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
                    void this.switchProject(data.projects[0].id);
                    this.pushHistory(); // V2.1 — First state
                    return true;
                }
            } else if (res.status >= 400) {
                this.toast.error(this.apiErrorMessage(res.status, 'Načtení projektů selhalo'));
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
