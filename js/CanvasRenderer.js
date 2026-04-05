import { ProjectNode } from './ProjectNode.js';

export class CanvasRenderer {
    constructor(canvasId, appManager) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.appManager = appManager;
        
        this.camera = { x: 0, y: 0, zoom: 1 };
        this.GRID_SIZE = 35;
        
        this.isDragging = false;
        this.isPanning = false;
        this.isResizing = false;
        this.isSelecting = false;
        
        this.dragNode = null;
        this.resizeDir = null; // 'nw', 'ne', 'sw', 'se'
        this.initialBounds = null; // V2.1
        this.aspectRatio = 1; // V2.1
        this.selectionStart = { x: 0, y: 0 };
        this.lastMouse = { x: 0, y: 0 };
        this.hoveredNodeId = null;
        
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
    toScreen(x, y) { return { x: (x + this.camera.x) * this.camera.zoom, y: (y + this.camera.y) * this.camera.zoom }; }
    toWorld(x, y) { return { x: (x / this.camera.zoom) - this.camera.x, y: (y / this.camera.zoom) - this.camera.y }; }

    setupEventListeners() {
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
                    this.isPanning = true;
                    this.appManager.selectNode(null);
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
            } else if (this.isDragging && this.dragNode) {
                // Move all selected nodes
                for (let id of this.appManager.selectedNodeIds) {
                    const node = this.getProject().getNode(id);
                    if (node) {
                        node.x += dwx;
                        node.y += dwy;
                    }
                }
            } else if (this.isPanning) {
                this.camera.x += dwx;
                this.camera.y += dwy;
            } else if (this.isSelecting) {
                // Selection box logic handled in draw
            } else {
                // Hover check
                const project = this.getProject();
                this.hoveredNodeId = null;
                if (project) {
                    for (let [id, node] of project.nodes) {
                        const b = node.getBounds();
                        if (worldPos.x >= b.x && worldPos.x <= b.x + b.w &&
                            worldPos.y >= b.y && worldPos.y <= b.y + b.h) {
                            this.hoveredNodeId = node.id;
                        }
                    }
                }
                
                // Cursor style
                if (this.hoveredNodeId) {
                    this.canvas.style.cursor = 'pointer';
                } else {
                    this.canvas.style.cursor = this.isPanning ? 'grabbing' : 'crosshair';
                }
            }
        });

        window.addEventListener('mouseup', (e) => {
            if (this.isSelecting) {
                this.finishSelection(this.toWorld(e.clientX - this.canvas.getBoundingClientRect().left, e.clientY - this.canvas.getBoundingClientRect().top));
            }
            
            if ((this.isDragging || this.isResizing) && this.dragNode) {
                // Snap to grid
                for (let id of this.appManager.selectedNodeIds) {
                    const node = this.getProject().getNode(id);
                    if (node) {
                        node.x = Math.round(node.x / this.GRID_SIZE) * this.GRID_SIZE;
                        node.y = Math.round(node.y / this.GRID_SIZE) * this.GRID_SIZE;
                        node.width = Math.round(node.width / this.GRID_SIZE) * this.GRID_SIZE;
                        node.height = Math.round(node.height / this.GRID_SIZE) * this.GRID_SIZE;
                    }
                }
            }

            this.isDragging = false;
            this.isPanning = false;
            this.isResizing = false;
            this.isSelecting = false;
            this.dragNode = null;
            this.resizeDir = null;
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
        }, { passive: false });
    }

    getResizeHandleAt(node, worldPos) {
        const b = node.getBounds();
        const s = 10; // Handle size
        if (Math.abs(worldPos.x - b.x) < s && Math.abs(worldPos.y - b.y) < s) return 'nw';
        if (Math.abs(worldPos.x - (b.x+b.w)) < s && Math.abs(worldPos.y - b.y) < s) return 'ne';
        if (Math.abs(worldPos.x - b.x) < s && Math.abs(worldPos.y - (b.y+b.h)) < s) return 'sw';
        if (Math.abs(worldPos.x - (b.x+b.w)) < s && Math.abs(worldPos.y - (b.y+b.h)) < s) return 'se';
        return null;
    }

    handleResizeMove(node, worldPos, shiftKey) {
        const GRID = this.GRID_SIZE;
        const b = this.initialBounds;
        const isImage = node.shape === 'image';
        const lockRatio = isImage ? !shiftKey : shiftKey;

        if (this.resizeDir === 'se') {
            let nw = Math.max(GRID, worldPos.x - b.x);
            let nh = Math.max(GRID, worldPos.y - b.y);

            // Real-time grid snapping
            nw = Math.round(nw / GRID) * GRID;
            nh = Math.round(nh / GRID) * GRID;

            if (lockRatio) {
                if (nw / nh > this.aspectRatio) {
                    nw = nh * this.aspectRatio;
                } else {
                    nh = nw / this.aspectRatio;
                }
                nw = Math.round(nw / GRID) * GRID;
                nh = Math.round(nh / GRID) * GRID;
            }

            node.width = nw;
            node.height = nh;
        } else if (this.resizeDir === 'nw') {
            const oldRight = b.x + b.w;
            const oldBottom = b.y + b.h;
            
            let nx = Math.round(worldPos.x / GRID) * GRID;
            let ny = Math.round(worldPos.y / GRID) * GRID;
            
            let nw = Math.max(GRID, oldRight - nx);
            let nh = Math.max(GRID, oldBottom - ny);

            if (lockRatio) {
                if (nw / nh > this.aspectRatio) {
                    nw = nh * this.aspectRatio;
                } else {
                    nh = nw / this.aspectRatio;
                }
                nw = Math.round(nw / GRID) * GRID;
                nh = Math.round(nh / GRID) * GRID;
            }

            node.x = oldRight - nw;
            node.y = oldBottom - nh;
            node.width = nw;
            node.height = nh;
        } else if (this.resizeDir === 'ne') {
            const oldBottom = b.y + b.h;
            let ny = Math.round(worldPos.y / GRID) * GRID;
            let nw = Math.max(GRID, worldPos.x - b.x);
            let nh = Math.max(GRID, oldBottom - ny);

            nw = Math.round(nw / GRID) * GRID;
            nh = Math.round(nh / GRID) * GRID;

            if (lockRatio) {
                if (nw / nh > this.aspectRatio) nw = nh * this.aspectRatio;
                else nh = nw / this.aspectRatio;
                nw = Math.round(nw / GRID) * GRID;
                nh = Math.round(nh / GRID) * GRID;
            }

            node.y = oldBottom - nh;
            node.width = nw;
            node.height = nh;
        } else if (this.resizeDir === 'sw') {
            const oldRight = b.x + b.w;
            let nx = Math.round(worldPos.x / GRID) * GRID;
            let nw = Math.max(GRID, oldRight - nx);
            let nh = Math.max(GRID, worldPos.y - b.y);

            nw = Math.round(nw / GRID) * GRID;
            nh = Math.round(nh / GRID) * GRID;

            if (lockRatio) {
                if (nw / nh > this.aspectRatio) nw = nh * this.aspectRatio;
                else nh = nw / this.aspectRatio;
                nw = Math.round(nw / GRID) * GRID;
                nh = Math.round(nh / GRID) * GRID;
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
                    this.ctx.lineWidth = 2 * this.camera.zoom;
                    this.ctx.strokeStyle = isLight ? `rgba(0,0,0,0.3)` : `rgba(255,255,255,0.2)`;
                    this.drawBasicEdge(node, child);
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

        // 4. MINIMAP
        this.drawMinimap(project, isLight);
    }

    drawBasicEdge(parent, child) {
        const pStart = parent.getBounds();
        const pEnd = child.getBounds();
        
        const p1 = this.toScreen(pStart.x + pStart.w / 2, pStart.y + pStart.h);
        const p2 = this.toScreen(pEnd.x + pEnd.w / 2, pEnd.y);
        
        const ctrlY = (p1.y + p2.y) / 2;
        const cp1 = { x: p1.x, y: ctrlY };
        const cp2 = { x: p2.x, y: ctrlY };

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
        } else if (node.shape === 'trapezoid') {
            this.ctx.moveTo(p.x + w*0.2, p.y);
            this.ctx.lineTo(p.x + w*0.8, p.y);
            this.ctx.lineTo(p.x + w, p.y + h);
            this.ctx.lineTo(p.x, p.y + h);
            this.ctx.closePath();
        } else if (node.shape === 'cylinder') {
            const eh = 10 * s;
            this.ctx.moveTo(p.x, p.y + eh);
            this.ctx.bezierCurveTo(p.x, p.y - eh/3, p.x + w, p.y - eh/3, p.x + w, p.y + eh);
            this.ctx.lineTo(p.x + w, p.y + h - eh);
            this.ctx.bezierCurveTo(p.x + w, p.y + h + eh/3, p.x, p.y + h + eh/3, p.x, p.y + h - eh);
            this.ctx.closePath();
        }
        
        this.ctx.fill();
        this.ctx.shadowBlur = 0;

        // BORDER
        this.ctx.lineWidth = isSelected ? 3 * s : 1.5 * s;
        this.ctx.strokeStyle = isSelected ? (isLight ? '#3b82f6' : '#00f0ff') : (isLight ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)');
        this.ctx.stroke();

        // IMAGE NODE SPECIAL
        if (node.shape === 'image' && node.nodeImage) {
            this.drawNodeAsImage(node, p, w, h, s, isLight);
        } else {
            // TEXT CONTENT (for non-image shapes)
            this.drawNodeText(node, p, w, h, s, isLight);
        }

        // RESIZE HANDLES (if only one selected)
        if (isSelected && this.appManager.selectedNodeIds.size === 1) {
            this.drawResizeHandles(p, w, h, s);
        }
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
            this.ctx.drawImage(img, p.x, p.y, w, h);
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
        this.ctx.font = `600 ${12 * s}px Inter`;
        this.ctx.textAlign = 'center';
        this.ctx.fillText(node.title, p.x + w/2, barY + barH/2 + 4*s);
    }

    drawNodeText(node, p, w, h, s, isLight) {
        const textColor = isLight ? '#111827' : '#e2e8f0';
        this.ctx.fillStyle = textColor;
        this.ctx.font = `600 ${14 * s}px Outfit`;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        let text = node.title;
        if (text.length > 20) text = text.substring(0, 18) + '...';
        this.ctx.fillText(text, p.x + w/2, p.y + h/2);
    }

    drawResizeHandles(p, w, h, s) {
        this.ctx.fillStyle = '#00f0ff';
        const hs = 8 * s;
        this.ctx.fillRect(p.x - hs/2, p.y - hs/2, hs, hs);
        this.ctx.fillRect(p.x + w - hs/2, p.y - hs/2, hs, hs);
        this.ctx.fillRect(p.x - hs/2, p.y + h - hs/2, hs, hs);
        this.ctx.fillRect(p.x + w - hs/2, p.y + h - hs/2, hs, hs);
    }

    drawMinimap(project, isLight) {
        const mw = 180;
        const mh = 120;
        const pad = 15;
        const mx = this.canvas.width - mw - pad;
        const my = this.canvas.height - mh - pad;

        this.ctx.save();
        this.ctx.translate(mx, my);
        // Glass background
        this.ctx.fillStyle = isLight ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.4)';
        this.ctx.beginPath();
        this.ctx.roundRect(0, 0, mw, mh, 10);
        this.ctx.fill();
        this.ctx.strokeStyle = isLight ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)';
        this.ctx.stroke();
        this.ctx.clip();

        // Scale factor based on all nodes bounds or fixed
        const mapScale = 0.08;
        this.ctx.scale(mapScale, mapScale);
        this.ctx.translate(mw/2 / mapScale, mh/2 / mapScale);
        this.ctx.translate(this.camera.x, this.camera.y);

        // Draw nodes simplified
        for (let [id, node] of project.nodes) {
            const b = node.getBounds();
            this.ctx.fillStyle = isLight ? '#cbd5e1' : '#334155';
            if (this.appManager.selectedNodeIds.has(node.id)) this.ctx.fillStyle = '#3b82f6';
            this.ctx.fillRect(b.x, b.y, b.w, b.h);
        }

        // Draw current viewport
        const vw = this.canvas.width / this.camera.zoom;
        const vh = this.canvas.height / this.camera.zoom;
        this.ctx.strokeStyle = '#00f0ff';
        this.ctx.lineWidth = 10;
        this.ctx.strokeRect(-this.camera.x, -this.camera.y, vw, vh);

        this.ctx.restore();
    }

    animate = () => {
        // Přeskočit draw, pokud je canvas skrytý (aktivní je SimulationRenderer)
        if (this.canvas.style.display !== 'none') {
            this.draw();
        }
        requestAnimationFrame(this.animate);
    }
}
