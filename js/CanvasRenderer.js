import { ProjectNode } from './ProjectNode.js';

function hexToRgbaSticky(hex, alpha) {
    if (!hex || typeof hex !== 'string') return null;
    let h = hex.trim().replace(/^#/, '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    if (!/^[0-9a-f]{6}$/i.test(h)) return null;
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
}

export class CanvasRenderer {
    constructor(canvasId, appManager) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.appManager = appManager;

        this.stickyEditNode = null;
        this.stickyOverlay = null;
        this._stickyEscHandler = null;
        this._stickyInputHandler = () => {
            if (!this.stickyEditNode || !this.stickyOverlay) return;
            this.stickyEditNode.stickyText = this.appManager.editor?.sanitizeHtml(this.stickyOverlay.innerHTML) || '';
            this.stickyEditNode.lastEditedAt = Date.now();
            this.appManager.editor?.renderCurrentNode?.();
        };
        this._stickyBlurHandler = () => {
            requestAnimationFrame(() => {
                if (this.stickyEditNode && document.activeElement !== this.stickyOverlay) {
                    this.endStickyInlineEdit(true);
                }
            });
        };
        
        this.camera = { x: 0, y: 0, zoom: 1 };
        this.GRID_SIZE = 35;
        
        this.isDragging = false;
        this.isPanning = false;
        this.isResizing = false;
        this.isSelecting = false;
        this.isConnectingDrag = false; // V2.2
        this.panStartMouse = null; // Pro rozlišení pan vs. klik na prázdno
        
        this.dragNode = null;
        this.connectStartSide = null; // V2.2
        this.connectCurrentPos = { x: 0, y: 0 }; // V2.2
        this.resizeDir = null; // 'nw', 'ne', 'sw', 'se'
        this.initialBounds = null; // V2.1
        this.aspectRatio = 1; // V2.1
        this.selectionStart = { x: 0, y: 0 };
        this.lastMouse = { x: 0, y: 0 };
        this.hoveredNodeId = null;
        this.hoveredEdge = null; // V2.3: { sourceNodeId, targetId }
        
        // V2.0 animation state
        this.animTime = 0;
        this.lastFrameTime = performance.now();

        // Image cache
        this.imageCache = new Map();

        this.setupEventListeners();
        this.resize();
        window.addEventListener('resize', () => this.resize());
        
        this.animate();
    }

    resize() {
        const parent = this.canvas.parentElement;
        this.canvas.width = parent.clientWidth;
        this.canvas.height = parent.clientHeight;
    }

    getProject() { return this.appManager.currentProject; }
    uiFontFamily() {
        const Ctor = this.appManager.constructor;
        return typeof Ctor.fontForCanvas === 'function'
            ? Ctor.fontForCanvas(this.appManager.appSettings?.uiFont)
            : 'Inter';
    }
    toScreen(x, y) { return { x: (x + this.camera.x) * this.camera.zoom, y: (y + this.camera.y) * this.camera.zoom }; }
    toWorld(x, y) { return { x: (x / this.camera.zoom) - this.camera.x, y: (y / this.camera.zoom) - this.camera.y }; }

    // V2.3: Bezier hit-detection helpers
    bezierPoint(p0, p1, p2, p3, t) {
        const mt = 1 - t;
        return mt*mt*mt*p0 + 3*mt*mt*t*p1 + 3*mt*t*t*p2 + t*t*t*p3;
    }

    getEdgeAt(worldPos) {
        const project = this.getProject();
        if (!project) return null;

        const threshold = 12 / this.camera.zoom; // Hit distance in world units (responsive to zoom)

        for (const node of project.nodes.values()) {
            for (const edge of node.edges) {
                const child = project.getNode(edge.targetId);
                if (!child) continue;

                // Start/End points in world space
                const p1w = node.getSidePoint(edge.startSide || "bottom");
                const p2w = child.getSidePoint(edge.endSide || "top");
                
                let cp1w, cp2w;
                const dist = Math.abs(p1w.y - p2w.y) / 2;
                
                if (edge.startSide === 'left' || edge.startSide === 'right') {
                    const dx = (p2w.x - p1w.x) / 2;
                    cp1w = { x: p1w.x + dx, y: p1w.y };
                    cp2w = { x: p2w.x - dx, y: p2w.y };
                } else {
                    cp1w = { x: p1w.x, y: p1w.y + (p2w.y > p1w.y ? dist : -dist) };
                    cp2w = { x: p2w.x, y: p2w.y + (p2w.y > p1w.y ? -dist : dist) };
                }

                // Sample the curve to find distance
                const steps = 20;
                for (let i = 0; i <= steps; i++) {
                    const t = i / steps;
                    const bx = this.bezierPoint(p1w.x, cp1w.x, cp2w.x, p2w.x, t);
                    const by = this.bezierPoint(p1w.y, cp1w.y, cp2w.y, p2w.y, t);
                    
                    const dx = worldPos.x - bx;
                    const dy = worldPos.y - by;
                    if (dx*dx+dy*dy < threshold*threshold) {
                        return { sourceNodeId: node.id, targetId: edge.targetId };
                    }
                }
            }
        }
        return null;
    }

    setupEventListeners() {
        // === MIDDLE MOUSE BUTTON PANNING ===
        this.canvas.addEventListener('mousedown', (e) => {
            if (e.button === 1) { // Prostřední tlačítko
                e.preventDefault();
                this.isMMBPanning = true;
                const rect = this.canvas.getBoundingClientRect();
                this.lastMouse = { x: e.clientX - rect.left, y: e.clientY - rect.top };
                this.canvas.style.cursor = 'grabbing';
                return;
            }
        });

        this.canvas.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return; // Only left click for these

            const rect = this.canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            const worldPos = this.toWorld(mouseX, mouseY);
            this.lastMouse = { x: mouseX, y: mouseY };

            const project = this.getProject();
            if (!project) return;
            
            // Context menu close
            this.appManager.hideContextMenu();

            // 1. Check for Resize Handles
            if (this.appManager.selectedNodeIds.size === 1) {
                const node = project.getNode(Array.from(this.appManager.selectedNodeIds)[0]);
                
                // Resize check
                const handle = this.getResizeHandleAt(node, worldPos);
                if (handle) {
                    this.isResizing = true;
                    this.dragNode = node;
                    this.resizeDir = handle;
                    this.initialBounds = { x: node.x, y: node.y, w: node.width, h: node.height };
                    this.aspectRatio = node.width / node.height;
                    this.appManager.pushHistory();
                    return;
                }

                // Connect handle check (V2.2)
                const connSide = this.getConnectHandleAt(node, worldPos);
                if (connSide) {
                    this.isConnectingDrag = true;
                    this.dragNode = node;
                    this.connectStartSide = connSide;
                    this.connectCurrentPos = worldPos;
                    return;
                }
            }

            // 2. Check for Nodes
            let clickedNode = null;
            const nodesArr = Array.from(project.nodes.values()).reverse();
            for (let node of nodesArr) {
                const b = node.getBounds();
                if (worldPos.x >= b.x && worldPos.x <= b.x + b.w &&
                    worldPos.y >= b.y && worldPos.y <= b.y + b.h) {
                    clickedNode = node;
                    break;
                }
            }

            if (this.appManager.isConnecting) {
                if (clickedNode && !this.appManager.selectedNodeIds.has(clickedNode.id)) {
                    // Logic handled in Editor or Main usually, but let's sync
                    const snode = this.appManager.getSelectedNode();
                    if (snode) {
                        snode.addEdge(clickedNode.id);
                        this.appManager.pushHistory();
                    }
                }
                this.appManager.isConnecting = false;
                document.getElementById('connect-overlay').classList.add('hidden');
                return;
            }

            if (clickedNode) {
                const isSelected = this.appManager.selectedNodeIds.has(clickedNode.id);
                this.appManager.selectNode(clickedNode.id, e.shiftKey);
                this.isDragging = true;
                this.dragNode = clickedNode;
                this.appManager.pushHistory();
            } else {
                if (e.shiftKey) {
                    this.isSelecting = true;
                    this.selectionStart = worldPos;
                } else {
                    // Začníme pan, ale NEzavírej panel — to uděláme až na mouseup
                    // pokud se myš posunula méně než 5px, byl to "klik na prázdno"
                    this.isPanning = true;
                    this.panStartMouse = { x: mouseX, y: mouseY };
                }
            }
        });

        this.canvas.addEventListener('mousemove', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            const worldPos = this.toWorld(mouseX, mouseY);
            const dx = mouseX - this.lastMouse.x;
            const dy = mouseY - this.lastMouse.y;
            const dwx = dx / this.camera.zoom;
            const dwy = dy / this.camera.zoom;
            this.lastMouse = { x: mouseX, y: mouseY };

            if (this.isResizing && this.dragNode) {
                this.handleResizeMove(this.dragNode, worldPos, e.shiftKey);
            } else if (this.isConnectingDrag && this.dragNode) {
                this.connectCurrentPos = worldPos;
            } else if (this.isDragging && this.dragNode) {
                // Reset alignment lines
                this.appManager.alignmentLines = { x: null, y: null };

                // Move all selected nodes
                for (let id of this.appManager.selectedNodeIds) {
                    const node = this.getProject().getNode(id);
                    if (node) {
                        node.x += dwx;
                        node.y += dwy;
                    }
                }

                // Smart Guides (V2.2) — only if one node dragged
                if (this.appManager.selectedNodeIds.size === 1) {
                    this.appManager.alignmentLines = this.appManager.getAlignmentLines(this.dragNode);
                }
            } else if (this.isPanning) {
                this.camera.x += dwx;
                this.camera.y += dwy;
            } else if (this.isMMBPanning) {
                this.camera.x += dwx;
                this.camera.y += dwy;
            } else if (this.isSelecting) {
                // Selection box logic handled in draw
            } else {
                // Hover check
                const project = this.getProject();
                this.hoveredNodeId = null;
                this.hoveredEdge = null; // V2.3

                if (project) {
                    for (let [id, node] of project.nodes) {
                        const b = node.getBounds();
                        if (worldPos.x >= b.x && worldPos.x <= b.x + b.w &&
                            worldPos.y >= b.y && worldPos.y <= b.y + b.h) {
                            this.hoveredNodeId = node.id;
                        }
                    }

                    // If no node hovered, check for edges (V2.3)
                    if (!this.hoveredNodeId) {
                        this.hoveredEdge = this.getEdgeAt(worldPos);
                    }
                }
                
                // Cursor style
                if (this.hoveredNodeId || this.hoveredEdge) {
                    this.canvas.style.cursor = 'pointer';
                } else {
                    this.canvas.style.cursor = this.isPanning ? 'grabbing' : 'crosshair';
                }
            }
        });

        window.addEventListener('mouseup', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const worldPos = this.toWorld(e.clientX - rect.left, e.clientY - rect.top);

            if (this.isConnectingDrag && this.dragNode) {
                // Finalize connection
                const project = this.getProject();
                let targetNode = null;
                for (let node of project.nodes.values()) {
                    if (node.id === this.dragNode.id) continue;
                    const b = node.getBounds();
                    if (worldPos.x >= b.x && worldPos.x <= b.x + b.w &&
                        worldPos.y >= b.y && worldPos.y <= b.y + b.h) {
                        targetNode = node;
                        break;
                    }
                }

                if (targetNode) {
                    const endSide = targetNode.getNearestSide(worldPos);
                    this.dragNode.addEdge(targetNode.id, "->", "neutral", "", 1, null, this.connectStartSide, endSide);
                    this.appManager.pushHistory();
                    this.appManager.toast.success("Spojeno!");
                }
            }

            if (this.isSelecting) {
                this.finishSelection(this.toWorld(e.clientX - this.canvas.getBoundingClientRect().left, e.clientY - this.canvas.getBoundingClientRect().top));
            }
            
            if (this.isDragging && this.dragNode && this.appManager.snapToGrid) {
                for (let id of this.appManager.selectedNodeIds) {
                    const node = this.getProject().getNode(id);
                    if (node) {
                        node.x = Math.round(node.x / this.GRID_SIZE) * this.GRID_SIZE;
                        node.y = Math.round(node.y / this.GRID_SIZE) * this.GRID_SIZE;
                    }
                }
            }

            // Pan vs. Klik na prázdno: rozlišení pomocí pohybu myši
            if (this.isPanning && this.panStartMouse) {
                const rect2 = this.canvas.getBoundingClientRect();
                const endX = e.clientX - rect2.left;
                const endY = e.clientY - rect2.top;
                const moved = Math.sqrt(
                    Math.pow(endX - this.panStartMouse.x, 2) +
                    Math.pow(endY - this.panStartMouse.y, 2)
                );
                if (moved < 5) {
                    // Byl to klik bez pohybu → odselektovat
                    this.appManager.selectNode(null);
                }
                // Pokud se posunul, byl to pan → ponechat výběr
            }

            this.isDragging = false;
            this.isPanning = false;
            this.isMMBPanning = false;
            this.isResizing = false;
            this.isSelecting = false;
            this.isConnectingDrag = false;
            this.dragNode = null;
            this.resizeDir = null;
            this.connectStartSide = null;
            this.panStartMouse = null;
            // Obnovit kurzor pokud jsme byli v MMB modu
            if (!this.hoveredNodeId && !this.hoveredEdge) {
                this.canvas.style.cursor = 'crosshair';
            }
        });

        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const zoomAmount = e.deltaY > 0 ? 0.9 : 1.1;
            const rect = this.canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            
            const worldBefore = this.toWorld(mouseX, mouseY);
            this.camera.zoom *= zoomAmount;
            this.camera.zoom = Math.max(0.1, Math.min(this.camera.zoom, 3));
            
            const worldAfter = this.toWorld(mouseX, mouseY);
            this.camera.x += (worldAfter.x - worldBefore.x);
            this.camera.y += (worldAfter.y - worldBefore.y);
            if (this.stickyEditNode) this.syncStickyOverlayPosition();
        }, { passive: false });

        this.canvas.addEventListener('dblclick', (e) => {
            if (e.button !== 0) return;
            const project = this.getProject();
            if (!project || project.mode !== 'data') return;
            const rect = this.canvas.getBoundingClientRect();
            const worldPos = this.toWorld(e.clientX - rect.left, e.clientY - rect.top);
            const nodesArr = Array.from(project.nodes.values()).reverse();
            for (const node of nodesArr) {
                if (node.shape !== 'sticky') continue;
                const b = node.getBounds();
                if (worldPos.x >= b.x && worldPos.x <= b.x + b.w &&
                    worldPos.y >= b.y && worldPos.y <= b.y + b.h) {
                    e.preventDefault();
                    this.appManager.selectNode(node.id);
                    this.beginStickyInlineEdit(node);
                    return;
                }
            }
        });
    }

    getStickyEditingNodeId() {
        return this.stickyEditNode ? this.stickyEditNode.id : null;
    }

    ensureStickyOverlay() {
        let el = document.getElementById('sticky-inline-edit');
        if (!el) {
            el = document.createElement('div');
            el.id = 'sticky-inline-edit';
            el.className = 'sticky-inline-edit hidden';
            el.setAttribute('contenteditable', 'true');
            el.setAttribute('spellcheck', 'true');
            document.getElementById('canvas-panel')?.appendChild(el);
        }
        this.stickyOverlay = el;
        return el;
    }

    applyStickyOverlayTheme(node, el) {
        if (!node || !el) return;
        const light = document.body.classList.contains('light-mode');
        el.style.backgroundColor = node.stickyBgColor || (light ? '#fef3c7' : '#3a2f14');
        el.style.color = node.stickyTextColor || (light ? '#422006' : '#fef3c7');
    }

    syncStickyOverlayPosition() {
        if (!this.stickyEditNode || !this.stickyOverlay) return;
        const node = this.stickyEditNode;
        const b = node.getBounds();
        const p = this.toScreen(b.x, b.y);
        const w = b.w * this.camera.zoom;
        const h = b.h * this.camera.zoom;
        const crect = this.canvas.getBoundingClientRect();
        const pad = 4 * this.camera.zoom;
        const innerPad = 6 * this.camera.zoom;
        this.stickyOverlay.style.left = `${crect.left + p.x + innerPad}px`;
        this.stickyOverlay.style.top = `${crect.top + p.y + 22 * this.camera.zoom}px`;
        this.stickyOverlay.style.width = `${Math.max(40, w - innerPad * 2)}px`;
        this.stickyOverlay.style.height = `${Math.max(40, h - 22 * this.camera.zoom - 18 * this.camera.zoom - pad)}px`;
        this.applyStickyOverlayTheme(node, this.stickyOverlay);
    }

    beginStickyInlineEdit(node) {
        if (!node || node.shape !== 'sticky') return;
        if (!this.getProject() || this.getProject().mode !== 'data') return;
        this.endStickyInlineEdit(true);
        this.appManager.pushHistory();
        this.stickyEditNode = node;
        const el = this.ensureStickyOverlay();
        el.removeEventListener('input', this._stickyInputHandler);
        el.removeEventListener('blur', this._stickyBlurHandler);
        const html = this.appManager.editor?.sanitizeHtml(node.stickyText || '') || '';
        el.innerHTML = html || '<p><br></p>';
        el.classList.remove('hidden');
        this.syncStickyOverlayPosition();
        el.addEventListener('input', this._stickyInputHandler);
        el.addEventListener('blur', this._stickyBlurHandler);
        el.focus();
        try {
            const range = document.createRange();
            range.selectNodeContents(el);
            range.collapse(false);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        } catch (_) { /* ignore */ }

        this._stickyEscHandler = (ev) => {
            if (ev.key === 'Escape' && this.stickyEditNode) {
                ev.preventDefault();
                ev.stopPropagation();
                this.endStickyInlineEdit(true);
            }
        };
        document.addEventListener('keydown', this._stickyEscHandler, true);
    }

    endStickyInlineEdit(commit) {
        const el = this.stickyOverlay;
        if (!this.stickyEditNode) {
            if (el) {
                el.classList.add('hidden');
                el.removeEventListener('input', this._stickyInputHandler);
                el.removeEventListener('blur', this._stickyBlurHandler);
            }
            return;
        }
        const node = this.stickyEditNode;
        if (commit && el) {
            node.stickyText = this.appManager.editor?.sanitizeHtml(el.innerHTML) || '';
            node.lastEditedAt = Date.now();
            this.appManager.editor?.renderCurrentNode?.();
        }
        this.stickyEditNode = null;
        if (el) {
            el.removeEventListener('input', this._stickyInputHandler);
            el.removeEventListener('blur', this._stickyBlurHandler);
            el.classList.add('hidden');
            el.innerHTML = '';
        }
        if (this._stickyEscHandler) {
            document.removeEventListener('keydown', this._stickyEscHandler, true);
            this._stickyEscHandler = null;
        }
        this.draw();
    }

    getResizeHandleAt(node, worldPos) {
        const b = node.getBounds();
        const s = 12 / this.camera.zoom; // Handle size sensitive to zoom
        if (Math.abs(worldPos.x - b.x) < s && Math.abs(worldPos.y - b.y) < s) return 'nw';
        if (Math.abs(worldPos.x - (b.x+b.w)) < s && Math.abs(worldPos.y - b.y) < s) return 'ne';
        if (Math.abs(worldPos.x - b.x) < s && Math.abs(worldPos.y - (b.y+b.h)) < s) return 'sw';
        if (Math.abs(worldPos.x - (b.x+b.w)) < s && Math.abs(worldPos.y - (b.y+b.h)) < s) return 'se';
        return null;
    }

    getConnectHandleAt(node, worldPos) {
        const sides = ["top", "bottom", "left", "right"];
        const s = 12 / this.camera.zoom;
        for (let side of sides) {
            const p = node.getSidePoint(side);
            if (Math.abs(worldPos.x - p.x) < s && Math.abs(worldPos.y - p.y) < s) return side;
        }
        return null;
    }


    handleResizeMove(node, worldPos, shiftKey) {
        const b = this.initialBounds;
        const isImage = node.shape === 'image';
        // Pro obrázky chceme držet poměr stran defaultně, SHIFT to vypne. Pro ostatní SHIFT poměr zapne.
        const lockRatio = isImage ? !shiftKey : shiftKey;
        const MinSize = 20; // Minimální velikost bodu

        if (this.resizeDir === 'se') {
            let nw = Math.max(MinSize, worldPos.x - b.x);
            let nh = Math.max(MinSize, worldPos.y - b.y);

            if (lockRatio) {
                if (nw / nh > this.aspectRatio) {
                    nw = nh * this.aspectRatio;
                } else {
                    nh = nw / this.aspectRatio;
                }
            }
            node.width = nw;
            node.height = nh;
        } else if (this.resizeDir === 'nw') {
            const oldRight = b.x + b.w;
            const oldBottom = b.y + b.h;
            
            let nw = Math.max(MinSize, oldRight - worldPos.x);
            let nh = Math.max(MinSize, oldBottom - worldPos.y);

            if (lockRatio) {
                if (nw / nh > this.aspectRatio) {
                    nw = nh * this.aspectRatio;
                } else {
                    nh = nw / this.aspectRatio;
                }
            }

            node.x = oldRight - nw;
            node.y = oldBottom - nh;
            node.width = nw;
            node.height = nh;
        } else if (this.resizeDir === 'ne') {
            const oldBottom = b.y + b.h;
            
            let nw = Math.max(MinSize, worldPos.x - b.x);
            let nh = Math.max(MinSize, oldBottom - worldPos.y);

            if (lockRatio) {
                if (nw / nh > this.aspectRatio) nw = nh * this.aspectRatio;
                else nh = nw / this.aspectRatio;
            }

            node.y = oldBottom - nh;
            node.width = nw;
            node.height = nh;
        } else if (this.resizeDir === 'sw') {
            const oldRight = b.x + b.w;
            let nw = Math.max(MinSize, oldRight - worldPos.x);
            let nh = Math.max(MinSize, worldPos.y - b.y);

            if (lockRatio) {
                if (nw / nh > this.aspectRatio) nw = nh * this.aspectRatio;
                else nh = nw / this.aspectRatio;
            }

            node.x = oldRight - nw;
            node.width = nw;
            node.height = nh;
        }
    }

    finishSelection(worldEnd) {
        const x1 = Math.min(this.selectionStart.x, worldEnd.x);
        const y1 = Math.min(this.selectionStart.y, worldEnd.y);
        const x2 = Math.max(this.selectionStart.x, worldEnd.x);
        const y2 = Math.max(this.selectionStart.y, worldEnd.y);

        const project = this.getProject();
        for (let [id, node] of project.nodes) {
            const b = node.getBounds();
            if (b.x >= x1 && b.x + b.w <= x2 && b.y >= y1 && b.y + b.h <= y2) {
                this.appManager.selectNode(id, true);
            }
        }
    }

    drawGrid() {
        const isLight = document.body.classList.contains('light-mode');
        this.ctx.strokeStyle = isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.03)';
        this.ctx.lineWidth = 1;
        
        const start = this.toWorld(0, 0);
        const end = this.toWorld(this.canvas.width, this.canvas.height);
        
        const startX = Math.floor(start.x / this.GRID_SIZE) * this.GRID_SIZE;
        const startY = Math.floor(start.y / this.GRID_SIZE) * this.GRID_SIZE;

        this.ctx.beginPath();
        for (let x = startX; x < end.x; x += this.GRID_SIZE) {
            const px = this.toScreen(x, 0).x;
            this.ctx.moveTo(px, 0);
            this.ctx.lineTo(px, this.canvas.height);
        }
        for (let y = startY; y < end.y; y += this.GRID_SIZE) {
            const py = this.toScreen(0, y).y;
            this.ctx.moveTo(0, py);
            this.ctx.lineTo(this.canvas.width, py);
        }
        this.ctx.stroke();
    }

    draw() {
        const now = performance.now();
        const dt = (now - this.lastFrameTime) / 1000;
        this.lastFrameTime = now;
        this.animTime += dt;

        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.drawGrid();

        const project = this.getProject();
        if (!project) return;

        const isLight = document.body.classList.contains('light-mode');

        // 1. EDGES
        for (let [id, node] of project.nodes) {
            for (let edge of node.edges) {
                const child = project.getNode(edge.targetId);
                if (child) {
                    const isHovered = this.hoveredEdge && 
                                     this.hoveredEdge.sourceNodeId === node.id && 
                                     this.hoveredEdge.targetId === edge.targetId;

                    this.ctx.lineWidth = (edge.thickness || 3) * this.camera.zoom + (isHovered ? 3 : 0);
                    this.ctx.strokeStyle = isHovered 
                        ? (isLight ? '#3b82f6' : '#00f0ff') 
                        : ProjectNode.resolveEdgeColor(edge);
                    
                    this.drawBasicEdge(node, child, edge);
                }
            }
        }

        // 2. NODES
        for (let [id, node] of project.nodes) {
            this.drawNode(node, isLight);
        }

        // 3. SELECTION BOX
        if (this.isSelecting) {
            const s = this.toScreen(this.selectionStart.x, this.selectionStart.y);
            const e = this.toScreen(this.lastMouse.x / this.camera.zoom - this.camera.x, this.lastMouse.y / this.camera.zoom - this.camera.y);
            // Wait, mapping is simpler since lastMouse is already in screen space
            const m = this.lastMouse;
            
            this.ctx.strokeStyle = 'rgba(0, 240, 255, 0.5)';
            this.ctx.lineWidth = 1;
            this.ctx.setLineDash([5, 5]);
            this.ctx.strokeRect(s.x, s.y, m.x - s.x, m.y - s.y);
            this.ctx.fillStyle = 'rgba(0, 240, 255, 0.05)';
            this.ctx.fillRect(s.x, s.y, m.x - s.x, m.y - s.y);
            this.ctx.setLineDash([]);
        }

        // 3.5 ACTIVE CONNECTION LINE (V2.2)
        if (this.isConnectingDrag && this.dragNode) {
            const p1 = this.toScreen(this.dragNode.getSidePoint(this.connectStartSide).x, this.dragNode.getSidePoint(this.connectStartSide).y);
            const p2 = this.toScreen(this.connectCurrentPos.x, this.connectCurrentPos.y);
            this.ctx.strokeStyle = '#00f0ff';
            this.ctx.lineWidth = 2 * this.camera.zoom;
            this.ctx.setLineDash([5, 5]);
            this.ctx.beginPath();
            this.ctx.moveTo(p1.x, p1.y);
            this.ctx.lineTo(p2.x, p2.y);
            this.ctx.stroke();
            this.ctx.setLineDash([]);
        }

        // 3.7 SMART GUIDES (V2.2)
        if (this.isDragging && this.appManager.alignmentLines.x !== null) {
            const lx = this.toScreen(this.appManager.alignmentLines.x, 0).x;
            this.ctx.strokeStyle = '#3b82f6';
            this.ctx.setLineDash([5, 5]);
            this.ctx.beginPath();
            this.ctx.moveTo(lx, 0);
            this.ctx.lineTo(lx, this.canvas.height);
            this.ctx.stroke();
            this.ctx.setLineDash([]);
        }
        if (this.isDragging && this.appManager.alignmentLines.y !== null) {
            const ly = this.toScreen(0, this.appManager.alignmentLines.y).y;
            this.ctx.strokeStyle = '#3b82f6';
            this.ctx.setLineDash([5, 5]);
            this.ctx.beginPath();
            this.ctx.moveTo(0, ly);
            this.ctx.lineTo(this.canvas.width, ly);
            this.ctx.stroke();
            this.ctx.setLineDash([]);
        }

        // 4. MINIMAP
        this.drawMinimap(project, isLight);
    }

    drawBasicEdge(parent, child, edge = {}) {
        const p1w = parent.getSidePoint(edge.startSide || "bottom");
        const p2w = child.getSidePoint(edge.endSide || "top");
        
        const p1 = this.toScreen(p1w.x, p1w.y);
        const p2 = this.toScreen(p2w.x, p2w.y);
        
        let cp1, cp2;
        const dist = Math.abs(p1.y - p2.y) / 2;
        
        // Simple bezier based on sides
        if (edge.startSide === 'left' || edge.startSide === 'right') {
            const dx = (p2.x - p1.x) / 2;
            cp1 = { x: p1.x + dx, y: p1.y };
            cp2 = { x: p2.x - dx, y: p2.y };
        } else {
            cp1 = { x: p1.x, y: p1.y + (p2.y > p1.y ? dist : -dist) };
            cp2 = { x: p2.x, y: p2.y + (p2.y > p1.y ? -dist : dist) };
        }

        this.ctx.beginPath();
        this.ctx.moveTo(p1.x, p1.y);
        this.ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, p2.x, p2.y);
        this.ctx.stroke();
    }


    drawNode(node, isLight) {
        const b = node.getBounds();
        const p = this.toScreen(b.x, b.y);
        const w = b.w * this.camera.zoom;
        const h = b.h * this.camera.zoom;
        const s = this.camera.zoom;
        
        const isSelected = this.appManager.selectedNodeIds.has(node.id);
        const isHovered = this.hoveredNodeId === node.id;

        // FOCUS MODE — ztmavit nesouvisející uzly
        if (this.appManager.focusMode && !this.appManager.focusConnectedIds.has(node.id)) {
            this.ctx.globalAlpha = 0.12;
        } else if (this.appManager.heatmapMode && node.lastEditedAt) {
            // HEATMAP MODE — barva podle stáří
            const ageMs = Date.now() - node.lastEditedAt;
            const ageDays = ageMs / (1000 * 60 * 60 * 24);
            if (ageDays < 1) this.ctx.globalAlpha = 1.0;
            else if (ageDays < 7) this.ctx.globalAlpha = 0.6;
            else this.ctx.globalAlpha = 0.25;
        } else {
            this.ctx.globalAlpha = 1.0;
        }

        // Shadow
        this.ctx.shadowColor = isSelected ? (isLight ? 'rgba(59, 130, 246, 0.5)' : 'rgba(0, 240, 255, 0.5)') : 'rgba(0, 0, 0, 0.3)';
        this.ctx.shadowBlur = isSelected ? 18 * s : 6 * s;

        // Background Gradient
        let bgGrad = this.ctx.createLinearGradient(p.x, p.y, p.x, p.y + h);
        if (isLight) {
            bgGrad.addColorStop(0, isSelected ? '#e8edff' : '#ffffff');
            bgGrad.addColorStop(1, isSelected ? '#dbe4ff' : '#f8fafc');
        } else {
            bgGrad.addColorStop(0, isSelected ? '#222640' : '#1f2130');
            bgGrad.addColorStop(1, isSelected ? '#1a1e35' : '#16181f');
        }
        
        this.ctx.fillStyle = bgGrad;
        
        // DRAW SHAPE
        this.ctx.beginPath();
        if (node.shape === 'rect' || node.shape === 'image') {
            const radius = 10 * s;
            this.ctx.roundRect(p.x, p.y, w, h, radius);
        } else if (node.shape === 'diamond') {
            this.ctx.moveTo(p.x + w/2, p.y);
            this.ctx.lineTo(p.x + w, p.y + h/2);
            this.ctx.lineTo(p.x + w/2, p.y + h);
            this.ctx.lineTo(p.x, p.y + h/2);
            this.ctx.closePath();
        } else if (node.shape === 'circle') {
            this.ctx.arc(p.x + w/2, p.y + h/2, Math.min(w,h)/2, 0, Math.PI*2);
        } else if (node.shape === 'hexagon') {
            this.ctx.moveTo(p.x + w * 0.25, p.y);
            this.ctx.lineTo(p.x + w * 0.75, p.y);
            this.ctx.lineTo(p.x + w, p.y + h/2);
            this.ctx.lineTo(p.x + w * 0.75, p.y + h);
            this.ctx.lineTo(p.x + w * 0.25, p.y + h);
            this.ctx.lineTo(p.x, p.y + h/2);
            this.ctx.closePath();
        } else if (node.shape === 'pill') {
            const radius = Math.min(w, h) / 2;
            this.ctx.roundRect(p.x, p.y, w, h, radius);
        } else if (node.shape === 'sticky') {
            const radius = 8 * s;
            this.ctx.roundRect(p.x, p.y, w, h, radius);
        }
        
        this.ctx.fill();
        this.ctx.shadowBlur = 0;

        // BORDER — s podporou custom node.color
        this.ctx.lineWidth = isSelected ? 3 * s : 1.5 * s;
        const borderColor = node.shape === 'sticky'
            ? (node.color || (isLight ? '#d97706' : '#f59e0b'))
            : node.color
            ? node.color
            : isSelected 
                ? (isLight ? '#3b82f6' : '#00f0ff') 
                : (isLight ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)');
        this.ctx.strokeStyle = borderColor;
        // Pokud má node custom barvu, přidáme glow
        if (node.color && !isSelected) {
            this.ctx.shadowBlur = 8 * s;
            this.ctx.shadowColor = node.color;
        }
        this.ctx.stroke();
        this.ctx.shadowBlur = 0;

        // IMAGE NODE SPECIAL
        if (node.shape === 'image' && node.nodeImage) {
            this.drawNodeAsImage(node, p, w, h, s, isLight);
        } else if (node.shape === 'sticky') {
            this.drawStickyText(node, p, w, h, s, isLight);
        } else {
            // TEXT CONTENT (for non-image shapes)
            this.drawNodeText(node, p, w, h, s, isLight);
        }

        // PIN INDIKÁTOR — 🚩 nad uzlem
        if (node.isPinned) {
            this.ctx.font = `${14 * s}px serif`;
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';
            this.ctx.shadowBlur = 6 * s;
            this.ctx.shadowColor = '#ef4444';
            this.ctx.fillText('🚩', p.x + w - 8 * s, p.y - 8 * s);
            this.ctx.shadowBlur = 0;
        }

        // RESIZE HANDLES & CONNECT HANDLES (if only one selected)
        if (isSelected && this.appManager.selectedNodeIds.size === 1) {
            this.drawResizeHandles(p, w, h, s);
            this.drawConnectHandles(node, s);
        }

        // Reset globalAlpha (Focus/Heatmap)
        this.ctx.globalAlpha = 1.0;
    }


    drawNodeAsImage(node, p, w, h, s, isLight) {
        if (!this.imageCache.has(node.nodeImage)) {
            const img = new Image();
            img.src = node.nodeImage;
            img.onload = () => { this.imageCache.set(node.nodeImage, img); };
            this.imageCache.set(node.nodeImage, null);
            return;
        }
        const img = this.imageCache.get(node.nodeImage);
        if (img) {
            this.ctx.save();
            this.ctx.beginPath();
            this.ctx.roundRect(p.x, p.y, w, h, 10 * s);
            this.ctx.clip();
            
            // preserved aspect ratio (object-fit: cover logic)
            const iw = img.width;
            const ih = img.height;
            const targetRatio = w / h;
            const imgRatio = iw / ih;
            let sx, sy, sw, sh;
            
            if (imgRatio > targetRatio) {
                sw = ih * targetRatio;
                sh = ih;
                sx = (iw - sw) / 2;
                sy = 0;
            } else {
                sw = iw;
                sh = iw / targetRatio;
                sx = 0;
                sy = (ih - sh) / 2;
            }
            
            this.ctx.drawImage(img, sx, sy, sw, sh, p.x, p.y, w, h);
            this.ctx.restore();
        }

        // LABEL BAR ABOVE
        const barH = 22 * s;
        const barY = p.y - barH - 4*s;
        this.ctx.fillStyle = isLight ? 'rgba(255,255,255,0.9)' : 'rgba(15,17,26,0.9)';
        this.ctx.beginPath();
        this.ctx.roundRect(p.x, barY, w, barH, 4*s);
        this.ctx.fill();
        this.ctx.strokeStyle = isLight ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)';
        this.ctx.lineWidth = 1;
        this.ctx.stroke();

        this.ctx.fillStyle = isLight ? '#111827' : '#e2e8f0';
        this.ctx.font = `600 ${12 * s}px ${this.uiFontFamily()}`;
        this.ctx.textAlign = 'center';
        this.ctx.fillText(node.title, p.x + w/2, barY + barH/2 + 4*s);
    }

    drawNodeText(node, p, w, h, s, isLight) {
        const textColor = isLight ? '#111827' : '#e2e8f0';
        this.ctx.fillStyle = textColor;
        const fontSize = (node.labelFontSize || 14) * s;
        this.ctx.font = `600 ${fontSize}px ${this.uiFontFamily()}`;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        let text = node.title;
        // Dynamická délka zkrácení dle velkosti fontu
        const maxChars = Math.max(8, Math.round(26 - (node.labelFontSize || 14) * 0.5));
        if (text.length > maxChars) text = text.substring(0, maxChars - 2) + '...';

        // Posunout text nahoru, pokud je status badge
        const hasStatus = node.status && node.status !== 'none';
        const textY = hasStatus ? p.y + h/2 - 10 * s : p.y + h/2;
        this.ctx.fillText(text, p.x + w/2, textY);

        // STATUS BADGE
        if (hasStatus) {
            const statusData = {
                todo:     { color: '#f59e0b', label: 'TODO' },
                progress: { color: '#3b82f6', label: 'WIP' },
                done:     { color: '#10b981', label: 'DONE' },
                blocked:  { color: '#ef4444', label: 'BLOCKED' },
            };
            const sd = statusData[node.status];
            if (sd) {
                const badgeH = 13 * s;
                const pad = 7 * s;
                this.ctx.font = `700 ${8 * s}px ${this.uiFontFamily()}`;
                const bw = this.ctx.measureText(sd.label).width + pad * 2;
                const bx = p.x + w/2 - bw/2;
                const by = p.y + h - badgeH - 5 * s;

                // Badge background
                this.ctx.fillStyle = sd.color + '30';
                this.ctx.beginPath();
                this.ctx.roundRect(bx, by, bw, badgeH, 3 * s);
                this.ctx.fill();
                this.ctx.strokeStyle = sd.color + '99';
                this.ctx.lineWidth = 1 * s;
                this.ctx.stroke();

                // Badge text
                this.ctx.fillStyle = sd.color;
                this.ctx.textAlign = 'center';
                this.ctx.textBaseline = 'middle';
                this.ctx.fillText(sd.label, p.x + w/2, by + badgeH/2);
            }
        }
    }

    drawStickyText(node, p, w, h, s, isLight) {
        const ix = p.x + 3 * s;
        const iy = p.y + 3 * s;
        const iw = w - 6 * s;
        const ih = h - 6 * s;
        const defBg = isLight ? '#fef3c7' : '#3a2f14';
        const defTitle = isLight ? '#78350f' : '#fde68a';
        const defBody = isLight ? '#422006' : '#fef3c7';
        const defStamp = isLight ? 'rgba(120,53,15,0.75)' : 'rgba(253,230,138,0.85)';
        const bg = node.stickyBgColor || defBg;
        const txtCustom = node.stickyTextColor;
        const titleC = txtCustom || defTitle;
        const bodyC = txtCustom || defBody;
        const stampC = (txtCustom && hexToRgbaSticky(txtCustom, 0.85)) || defStamp;

        this.ctx.fillStyle = bg;
        this.ctx.beginPath();
        this.ctx.roundRect(ix, iy, iw, ih, 6 * s);
        this.ctx.fill();

        const padX = 8 * s;
        const titleH = 16 * s;
        const stampH = 14 * s;
        let bodyTop = iy + padX + titleH;
        const bodyMaxY = iy + ih - stampH - padX;

        this.ctx.fillStyle = titleC;
        this.ctx.font = `700 ${11 * s}px ${this.uiFontFamily()}`;
        this.ctx.textAlign = 'left';
        this.ctx.textBaseline = 'top';
        let title = node.title || '';
        while (title.length > 1 && this.ctx.measureText(title + '…').width > iw - padX * 2) {
            title = title.slice(0, -1);
        }
        if (node.title && node.title !== title) title += '…';
        this.ctx.fillText(title || ' ', ix + padX, iy + padX);

        const plain = ProjectNode.stickyPlainText(node.stickyText || '');
        this.ctx.font = `500 ${12 * s}px ${this.uiFontFamily()}`;
        this.ctx.fillStyle = bodyC;
        const maxW = iw - padX * 2;
        const lineH = 14 * s;
        const lines = ProjectNode.wrapStickyPlainLines(this.ctx, plain, maxW);
        let y = bodyTop;
        let truncated = false;
        for (let i = 0; i < lines.length; i++) {
            if (y + lineH > bodyMaxY) {
                truncated = true;
                break;
            }
            this.ctx.fillText(lines[i], ix + padX, y);
            y += lineH;
        }
        if (truncated && y > bodyTop) {
            this.ctx.fillStyle = bodyC;
            this.ctx.globalAlpha = 0.85;
            this.ctx.font = `600 ${10 * s}px ${this.uiFontFamily()}`;
            this.ctx.fillText('…', ix + padX, Math.max(bodyTop, bodyMaxY - lineH));
            this.ctx.globalAlpha = 1;
        }

        if (node.stickyCreatedAt) {
            try {
                const d = new Date(node.stickyCreatedAt);
                const stamp = d.toLocaleString('cs-CZ', {
                    day: '2-digit', month: '2-digit', year: '2-digit',
                    hour: '2-digit', minute: '2-digit'
                });
                this.ctx.font = `600 ${8.5 * s}px ${this.uiFontFamily()}`;
                this.ctx.fillStyle = stampC;
                this.ctx.textAlign = 'right';
                this.ctx.textBaseline = 'bottom';
                this.ctx.fillText(stamp, ix + iw - padX, iy + ih - padX * 0.5);
                this.ctx.textAlign = 'left';
                this.ctx.textBaseline = 'top';
            } catch (_) { /* ignore */ }
        }
    }

    drawResizeHandles(p, w, h, s) {
        this.ctx.fillStyle = '#00f0ff';
        const hs = 8 * s;
        this.ctx.shadowBlur = 5 * s;
        this.ctx.shadowColor = '#00f0ff';
        this.ctx.fillRect(p.x - hs/2, p.y - hs/2, hs, hs);
        this.ctx.fillRect(p.x + w - hs/2, p.y - hs/2, hs, hs);
        this.ctx.fillRect(p.x - hs/2, p.y + h - hs/2, hs, hs);
        this.ctx.fillRect(p.x + w - hs/2, p.y + h - hs/2, hs, hs);
        this.ctx.shadowBlur = 0;
    }

    drawConnectHandles(node, s) {
        const sides = ["top", "bottom", "left", "right"];
        this.ctx.fillStyle = "#10b981";
        this.ctx.strokeStyle = "#fff";
        this.ctx.lineWidth = 1.5 * s;
        const r = 5 * s;
        
        for (let side of sides) {
            const pWorld = node.getSidePoint(side);
            const p = this.toScreen(pWorld.x, pWorld.y);
            this.ctx.beginPath();
            this.ctx.arc(p.x, p.y, r, 0, Math.PI*2);
            this.ctx.fill();
            this.ctx.stroke();
        }
    }


    drawMinimap(project, isLight) {
        const mw = 180;
        const mh = 120;
        const pad = 16;
        // Minimap se umisťuje relativně k plátnu, odsunuta od spodního okraje
        // (footer bar ~28px + shortcut btn ~36px + mezera + timeline)
        let timelineOffset = 0;
        const timelinePanel = document.getElementById('timeline-panel');
        if (timelinePanel && !timelinePanel.classList.contains('hidden')) {
            timelineOffset = timelinePanel.offsetHeight;
        }

        const mx = this.canvas.width - mw - pad;
        const my = this.canvas.height - mh - pad - 72 - timelineOffset;

        this.ctx.save();
        this.ctx.translate(mx, my);

        // Glass background
        this.ctx.fillStyle = isLight ? 'rgba(255,255,255,0.82)' : 'rgba(10,12,20,0.75)';
        this.ctx.beginPath();
        this.ctx.roundRect(0, 0, mw, mh, 10);
        this.ctx.fill();
        this.ctx.strokeStyle = isLight ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.1)';
        this.ctx.lineWidth = 1;
        this.ctx.stroke();
        this.ctx.clip();

        // Spočítáme bounding box všech uzlů
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (let [id, node] of project.nodes) {
            const b = node.getBounds();
            if (b.x < minX) minX = b.x;
            if (b.y < minY) minY = b.y;
            if (b.x + b.w > maxX) maxX = b.x + b.w;
            if (b.y + b.h > maxY) maxY = b.y + b.h;
        }

        if (!isFinite(minX)) {
            this.ctx.restore();
            return;
        }

        const contentW = maxX - minX || 1;
        const contentH = maxY - minY || 1;
        const marginFactor = 1.15;
        const scaleX = mw / (contentW * marginFactor);
        const scaleY = mh / (contentH * marginFactor);
        const mapScale = Math.min(scaleX, scaleY, 0.15); // Max scale 0.15 aby minimap nebyla moc velká

        // Střed obsahu ve world space
        const contentCX = (minX + maxX) / 2;
        const contentCY = (minY + maxY) / 2;

        this.ctx.save();
        // Přeložíme na střed minmapy a pak na střed obsahu
        this.ctx.translate(mw / 2, mh / 2);
        this.ctx.scale(mapScale, mapScale);
        this.ctx.translate(-contentCX, -contentCY);

        // Uzly
        for (let [id, node] of project.nodes) {
            const b = node.getBounds();
            if (this.appManager.selectedNodeIds.has(node.id)) {
                this.ctx.fillStyle = isLight ? '#3b82f6' : '#00f0ff';
            } else {
                this.ctx.fillStyle = node.color || (isLight ? '#cbd5e1' : '#334155');
            }
            this.ctx.fillRect(b.x, b.y, Math.max(b.w, 8), Math.max(b.h, 8));
        }

        // Viewport obdélník
        const vw = this.canvas.width / this.camera.zoom;
        const vh = this.canvas.height / this.camera.zoom;
        const vpX = -this.camera.x;
        const vpY = -this.camera.y;

        this.ctx.strokeStyle = '#00f0ff';
        this.ctx.lineWidth = Math.max(4, 2 / mapScale);
        this.ctx.globalAlpha = 0.85;
        this.ctx.strokeRect(vpX, vpY, vw, vh);
        this.ctx.fillStyle = 'rgba(0, 240, 255, 0.05)';
        this.ctx.fillRect(vpX, vpY, vw, vh);
        this.ctx.globalAlpha = 1.0;

        this.ctx.restore();
        this.ctx.restore();
    }



    animate = () => {
        // Přeskočit draw, pokud je canvas skrytý (aktivní je SimulationRenderer)
        if (this.canvas.style.display !== 'none') {
            this.draw();
            if (this.stickyEditNode) this.syncStickyOverlayPosition();
        }
        requestAnimationFrame(this.animate);
    }
}
