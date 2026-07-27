import { ProjectNode } from './ProjectNode.js';

export class SimulationRenderer {
    constructor(canvasId, appManager) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.appManager = appManager;
        this.camera = { x: 0, y: 0, zoom: 1 };
        this.GRID_SIZE = 40;
        
        this.isPanning = false;
        this.isDragging = false;
        this.isResizing = false; // V2.2
        this.isConnectingDrag = false; // V2.2
        this.panStartMouse = null; // Pro rozlišení pan vs. klik na prázdno
        
        this.dragNode = null;
        this.resizeDir = null; // V2.2
        this.initialBounds = null; // V2.2
        this.aspectRatio = 1; // V2.2
        this.connectStartSide = null; // V2.2
        this.connectCurrentPos = { x: 0, y: 0 }; // V2.2

        this.lastMouse = { x: 0, y: 0 };
        this.hoveredNodeId = null;
        this.hoveredEdge = null; // V2.3: { sourceNodeId, targetId }

        // ANIMATION
        this.animTime = 0;
        this.lastFrameTime = performance.now();
        this.glowPhase = 0;
        
        // PARTICLES
        this.particles = new Map(); // edgeId -> Particle[]
        
        // IMAGES
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

    setupEventListeners() {
        // === MIDDLE MOUSE BUTTON PANNING ===
        this.canvas.addEventListener('mousedown', (e) => {
            if (e.button === 1) {
                e.preventDefault();
                this.isMMBPanning = true;
                const rect = this.canvas.getBoundingClientRect();
                this.lastMouse = { x: e.clientX - rect.left, y: e.clientY - rect.top };
                this.canvas.style.cursor = 'grabbing';
                return;
            }
        });

        this.canvas.addEventListener('mousedown', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            const worldPos = this.toWorld(mouseX, mouseY);
            this.lastMouse = { x: mouseX, y: mouseY };

            const project = this.getProject();
            if (!project) return;
            this.appManager.hideContextMenu();

            // 1. Check for Resize/Connect Handles (V2.2)
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

                const connSide = this.getConnectHandleAt(node, worldPos);
                if (connSide) {
                    this.isConnectingDrag = true;
                    this.dragNode = node;
                    this.connectStartSide = connSide;
                    this.connectCurrentPos = worldPos;
                    return;
                }
            }

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

            if (clickedNode) {
                this.appManager.selectNode(clickedNode.id, e.shiftKey);
                this.isDragging = true;
                this.dragNode = clickedNode;
                this.appManager.pushHistory();
            } else {
                this.isPanning = true;
                this.panStartMouse = { x: mouseX, y: mouseY };
            }
        });

        this.canvas.addEventListener('mousemove', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            const worldPos = this.toWorld(mouseX, mouseY);
            const dx = mouseX - this.lastMouse.x;
            const dy = mouseY - this.lastMouse.y;
            this.lastMouse = { x: mouseX, y: mouseY };

            if (this.isResizing && this.dragNode) {
                this.handleResizeMove(this.dragNode, worldPos, e.shiftKey);
            } else if (this.isConnectingDrag && this.dragNode) {
                this.connectCurrentPos = worldPos;
            } else if (this.isDragging && this.dragNode) {
                this.appManager.alignmentLines = { x: null, y: null };
                const dwx = dx / this.camera.zoom;
                const dwy = dy / this.camera.zoom;
                for (let id of this.appManager.selectedNodeIds) {
                    const node = this.getProject().getNode(id);
                    if (node) {
                        node.x += dwx;
                        node.y += dwy;
                    }
                }
                if (this.appManager.selectedNodeIds.size === 1) {
                    this.appManager.alignmentLines = this.appManager.getAlignmentLines(this.dragNode);
                }
            } else if (this.isPanning) {
                this.camera.x += dx / this.camera.zoom;
                this.camera.y += dy / this.camera.zoom;
            } else if (this.isMMBPanning) {
                this.camera.x += dx / this.camera.zoom;
                this.camera.y += dy / this.camera.zoom;
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
                    this.appManager.selectNode(null);
                }
            }

            this.isDragging = false;
            this.isPanning = false;
            this.isMMBPanning = false;
            this.isResizing = false;
            this.isConnectingDrag = false;
            this.dragNode = null;
            this.resizeDir = null;
            this.connectStartSide = null;
            this.panStartMouse = null;
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

    // =============================================
    // GRID
    // =============================================
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

    // =============================================
    // PARTICLES logic
    // =============================================
    updateParticles(dt) {
        const project = this.getProject();
        if (!project) return;

        const validEdgeKeys = new Set();
        const perfMode = this.appManager.performanceMode; // V2.2

        for (let [id, node] of project.nodes) {
            for (let edge of node.edges) {
                const edgeKey = `${id}-${edge.targetId}`;
                validEdgeKeys.add(edgeKey);

                if (!this.particles.has(edgeKey)) this.particles.set(edgeKey, []);
                const parts = this.particles.get(edgeKey);

                const maxParts = perfMode ? 2 : 5;
                const chance = perfMode ? 0.02 : 0.05;

                // Propagace statusu (V2.2) — Parent DONE posílá rychlejší částice
                const isParentDone = node.status === 'done';
                const speedMult = isParentDone ? 2.5 : 1.0;

                // Přidat nové
                if (parts.length < maxParts && Math.random() < chance) {
                    parts.push({ t: 0, speed: (0.2 + Math.random() * 0.3) * speedMult, isSignal: isParentDone });
                }

                // Update
                for (let i = parts.length - 1; i >= 0; i--) {
                    parts[i].t += parts[i].speed * dt;
                    if (parts[i].t > 1) parts.splice(i, 1);
                }
            }
        }

        // Cleanup smazaných hran z particles Map
        for (let key of this.particles.keys()) {
            if (!validEdgeKeys.has(key)) {
                this.particles.delete(key);
            }
        }
    }

    // =============================================
    // HELPERS FOR DRAWING
    // =============================================
    getEdgePoints(pId, cId, edge = {}) {
        const project = this.getProject();
        const pNode = project.getNode(pId);
        const cNode = project.getNode(cId);
        if (!pNode || !cNode) return null;

        const p1 = this.toScreen(pNode.getSidePoint(edge.startSide || "bottom").x, pNode.getSidePoint(edge.startSide || "bottom").y);
        const p2 = this.toScreen(cNode.getSidePoint(edge.endSide || "top").x, cNode.getSidePoint(edge.endSide || "top").y);
        
        let cp1, cp2;
        const dist = Math.abs(p1.y - p2.y) / 2;
        
        if (edge.startSide === 'left' || edge.startSide === 'right') {
            const dx = (p2.x - p1.x) / 2;
            cp1 = { x: p1.x + dx, y: p1.y };
            cp2 = { x: p2.x - dx, y: p2.y };
        } else {
            cp1 = { x: p1.x, y: p1.y + (p2.y > p1.y ? dist : -dist) };
            cp2 = { x: p2.x, y: p2.y + (p2.y > p1.y ? -dist : dist) };
        }
        return { p1, p2, cp1, cp2 };
    }


    bezierPoint(p0, p1, p2, p3, t) {
        const mt = 1 - t;
        return mt*mt*mt*p0 + 3*mt*mt*t*p1 + 3*mt*t*t*p2 + t*t*t*p3;
    }

    bezierTangent(p0, p1, p2, p3, t) {
        const mt = 1 - t;
        return 3*mt*mt*(p1-p0) + 6*mt*t*(p2-p1) + 3*t*t*(p3-p2);
    }

    getEdgeAt(worldPos) {
        const project = this.getProject();
        if (!project) return null;

        const threshold = 12 / this.camera.zoom;

        for (const node of project.nodes.values()) {
            for (const edge of node.edges) {
                const child = project.getNode(edge.targetId);
                if (!child) continue;

                // getEdgePoints returns screen coords, but we need world point for distance check
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

    drawArrowhead(x, y, angle, color, size = 10) {
        this.ctx.save();
        this.ctx.translate(x, y);
        this.ctx.rotate(angle);
        this.ctx.fillStyle = color;
        if (!this.appManager.performanceMode) {
            this.ctx.shadowBlur = 10;
            this.ctx.shadowColor = color;
        }
        this.ctx.beginPath();
        this.ctx.moveTo(size, 0);
        this.ctx.lineTo(-size*0.7, -size*0.6);
        this.ctx.lineTo(-size*0.7, size*0.6);
        this.ctx.closePath();
        this.ctx.fill();
        this.ctx.restore();
    }

    getResizeHandleAt(node, worldPos) {
        const b = node.getBounds();
        const s = 12 / this.camera.zoom;
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
        const lockRatio = isImage ? !shiftKey : shiftKey;
        const MinSize = 20;

        if (this.resizeDir === 'se') {
            let nw = Math.max(MinSize, worldPos.x - b.x);
            let nh = Math.max(MinSize, worldPos.y - b.y);
            if (lockRatio) {
                if (nw / nh > this.aspectRatio) nw = nh * this.aspectRatio;
                else nh = nw / this.aspectRatio;
            }
            node.width = nw;
            node.height = nh;
        } else if (this.resizeDir === 'nw') {
            const oldRight = b.x + b.w;
            const oldBottom = b.y + b.h;
            let nw = Math.max(MinSize, oldRight - worldPos.x);
            let nh = Math.max(MinSize, oldBottom - worldPos.y);
            if (lockRatio) {
                if (nw / nh > this.aspectRatio) nw = nh * this.aspectRatio;
                else nh = nw / this.aspectRatio;
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


    // =============================================
    // MAIN DRAW
    // =============================================
    draw() {
        const now = performance.now();
        const dt = (now - this.lastFrameTime) / 1000;
        this.lastFrameTime = now;
        this.animTime += dt;
        this.glowPhase = this.animTime;

        this.updateParticles(dt);

        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.drawGrid();

        const project = this.getProject();
        if (!project) return;

        // 1. DRAW EDGES
        for (let [id, node] of project.nodes) {
            for (let edge of node.edges) {
                const child = project.getNode(edge.targetId);
                if (child) {
                    this.drawSimEdge(node, child, edge);
                }
            }
        }

        // 2. DRAW NODES
        for (let [id, node] of project.nodes) {
            this.drawSimNode(node);
        }

        // 3. ACTIVE CONNECTION (V2.2)
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
            this.ctx.strokeStyle = '#00f0ff';
            this.ctx.setLineDash([5, 5]);
            this.ctx.beginPath();
            this.ctx.moveTo(lx, 0);
            this.ctx.lineTo(lx, this.canvas.height);
            this.ctx.stroke();
            this.ctx.setLineDash([]);
        }
        if (this.isDragging && this.appManager.alignmentLines.y !== null) {
            const ly = this.toScreen(0, this.appManager.alignmentLines.y).y;
            this.ctx.strokeStyle = '#00f0ff';
            this.ctx.setLineDash([5, 5]);
            this.ctx.beginPath();
            this.ctx.moveTo(0, ly);
            this.ctx.lineTo(this.canvas.width, ly);
            this.ctx.stroke();
            this.ctx.setLineDash([]);
        }
    }



    drawSimEdge(parent, child, edge) {
        const pts = this.getEdgePoints(parent.id, child.id, edge);
        if (!pts) return;
        const { p1, p2, cp1, cp2 } = pts;
        const perf = this.appManager.performanceMode;

        const color = ProjectNode.resolveEdgeColor(edge);
        const isHovered = this.hoveredEdge && 
                         this.hoveredEdge.sourceNodeId === parent.id && 
                         this.hoveredEdge.targetId === child.id;

        const thickness = (edge.thickness || (isHovered ? 4 : 2)) * this.camera.zoom;

        // Glow line
        if (!perf || isHovered) {
            this.ctx.shadowBlur = (isHovered ? 20 : 12) * this.camera.zoom;
            this.ctx.shadowColor = isHovered ? "#fff" : color;
        }
        this.ctx.strokeStyle = isHovered ? "#fff" : color;
        this.ctx.lineWidth = isHovered ? thickness + 2 : thickness;
        this.ctx.beginPath();
        this.ctx.moveTo(p1.x, p1.y);
        this.ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, p2.x, p2.y);
        this.ctx.stroke();
        this.ctx.shadowBlur = 0;

        // Particles
        const edgeKey = `${parent.id}-${child.id}`;
        const parts = this.particles.get(edgeKey) || [];
        for (let p of parts) {
            const px = this.bezierPoint(p1.x, cp1.x, cp2.x, p2.x, p.t);
            const py = this.bezierPoint(p1.y, cp1.y, cp2.y, p2.y, p.t);
            this.ctx.fillStyle = p.isSignal ? "#00f0ff" : "#fff";
            if (!perf) {
                this.ctx.shadowBlur = p.isSignal ? 15 : 8;
                this.ctx.shadowColor = p.isSignal ? "#00f0ff" : "#fff";
            }
            this.ctx.beginPath();
            this.ctx.arc(px, py, thickness * (p.isSignal ? 1.2 : 0.8), 0, Math.PI*2);
            this.ctx.fill();
        }


        // Arrowhead at the end
        const tx = this.bezierTangent(p1.x, cp1.x, cp2.x, p2.x, 1);
        const ty = this.bezierTangent(p1.y, cp1.y, cp2.y, p2.y, 1);
        const angle = Math.atan2(ty, tx);
        this.drawArrowhead(p2.x, p2.y, angle, color, 10 * this.camera.zoom);

        // Edge Label (Badge)
        if (edge.label) {
            const mx = this.bezierPoint(p1.x, cp1.x, cp2.x, p2.x, 0.5);
            const my = this.bezierPoint(p1.y, cp1.y, cp2.y, p2.y, 0.5);
            this.drawEdgeLabel(edge.label, mx, my, color);
        }
    }

    drawEdgeLabel(label, x, y, color) {
        const s = this.camera.zoom;
        this.ctx.font = `${11 * s}px ${this.uiFontFamily()}`;
        const tw = this.ctx.measureText(label).width;
        const bw = tw + 16 * s;
        const bh = 18 * s;

        this.ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
        this.ctx.shadowBlur = 4;
        this.ctx.shadowColor = "black";
        this.ctx.beginPath();
        this.ctx.roundRect(x - bw/2, y - bh/2, bw, bh, 4*s);
        this.ctx.fill();
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = 1 * s;
        this.ctx.stroke();

        this.ctx.fillStyle = "#fff";
        this.ctx.textAlign = "center";
        this.ctx.fillText(label, x, y + 4*s);
        this.ctx.shadowBlur = 0;
    }

    drawSimNode(node) {
        const b = node.getBounds();
        const p = this.toScreen(b.x, b.y);
        const w = b.w * this.camera.zoom;
        const h = b.h * this.camera.zoom;
        const s = this.camera.zoom;
        
        const isSelected = this.appManager.selectedNodeIds.has(node.id);
        const isHovered = this.hoveredNodeId === node.id;

        // FOCUS MODE — ztmavit nesouvisející uzly
        if (this.appManager.focusMode && !this.appManager.focusConnectedIds.has(node.id)) {
            this.ctx.globalAlpha = 0.1;
        } else if (this.appManager.heatmapMode && node.lastEditedAt) {
            const ageMs = Date.now() - node.lastEditedAt;
            const ageDays = ageMs / (1000 * 60 * 60 * 24);
            if (ageDays < 1) this.ctx.globalAlpha = 1.0;
            else if (ageDays < 7) this.ctx.globalAlpha = 0.55;
            else this.ctx.globalAlpha = 0.2;
        } else {
            this.ctx.globalAlpha = 1.0;
        }

        // Pulse effect if selected
        const pulse = isSelected ? Math.sin(this.glowPhase * 4) * 0.2 + 1 : 1;
        
        // Neon Glow
        if (!this.appManager.performanceMode) {
            this.ctx.shadowBlur = (isSelected ? 25 : (isHovered ? 15 : 5)) * s * pulse;
            this.ctx.shadowColor = isSelected ? "#00f0ff" : "rgba(0, 240, 255, 0.3)";
        }

        // Glass Body
        this.ctx.fillStyle = isSelected ? "rgba(30, 41, 59, 0.95)" : "rgba(15, 23, 42, 0.8)";
        
        this.ctx.beginPath();
        this.defineShapePath(node, p, w, h, s);
        this.ctx.fill();

        // Border Neon
        this.ctx.strokeStyle = isSelected ? "#00f0ff" : "rgba(0, 240, 255, 0.4)";
        this.ctx.lineWidth = (isSelected ? 3 : 1.5) * s;
        this.ctx.stroke();
        this.ctx.shadowBlur = 0;

        // Content
        if (node.shape === 'image' && node.nodeImage) {
            this.drawSimNodeImage(node, p, w, h, s);
        } else if (node.shape === 'sticky') {
            this.drawSimStickyText(node, p, w, h, s);
        } else {
            this.drawSimNodeText(node, p, w, h, s);
        }

        // Stats indicator if value > 0
        if (node.statValue > 0) {
            this.drawStatTag(node, p, w, h, s);
        }

        // PIN INDIKÁTOR — 🚩 nad uzlem s pulsováním
        if (node.isPinned) {
            const pulse = Math.sin(this.glowPhase * 3) * 0.4 + 1;
            this.ctx.font = `${14 * s}px serif`;
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';
            this.ctx.shadowBlur = 10 * s * pulse;
            this.ctx.shadowColor = '#ef4444';
            this.ctx.fillText('🚩', p.x + w - 8 * s, p.y - 8 * s);
            this.ctx.shadowBlur = 0;
        }

        // HANDLES (V2.2)
        if (isSelected && this.appManager.selectedNodeIds.size === 1) {
            this.drawSimHandles(node, p, w, h, s);
        }

        // Reset globalAlpha
        this.ctx.globalAlpha = 1.0;
    }

    drawSimHandles(node, p, w, h, s) {
        // Resize Handles
        this.ctx.fillStyle = '#00f0ff';
        const hs = 8 * s;
        this.ctx.fillRect(p.x - hs/2, p.y - hs/2, hs, hs);
        this.ctx.fillRect(p.x + w - hs/2, p.y - hs/2, hs, hs);
        this.ctx.fillRect(p.x - hs/2, p.y + h - hs/2, hs, hs);
        this.ctx.fillRect(p.x + w - hs/2, p.y + h - hs/2, hs, hs);

        // Connection Dots
        const sides = ["top", "bottom", "left", "right"];
        this.ctx.fillStyle = "#10b981";
        this.ctx.strokeStyle = "#fff";
        this.ctx.lineWidth = 1 * s;
        for (let side of sides) {
            const sp = this.toScreen(node.getSidePoint(side).x, node.getSidePoint(side).y);
            this.ctx.beginPath();
            this.ctx.arc(sp.x, sp.y, 4*s, 0, Math.PI*2);
            this.ctx.fill();
            this.ctx.stroke();
        }
    }


    defineShapePath(node, p, w, h, s) {
        if (node.shape === 'rect' || node.shape === 'image') {
            this.ctx.roundRect(p.x, p.y, w, h, 10 * s);
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
        } else if (node.shape === 'sticky') {
            this.ctx.roundRect(p.x, p.y, w, h, 8 * s);
        }
    }

    drawSimStickyText(node, p, w, h, s) {
        const ix = p.x + 3 * s;
        const iy = p.y + 3 * s;
        const iw = w - 6 * s;
        const ih = h - 6 * s;
        const defBg = 'rgba(30, 25, 18, 0.95)';
        const defTitle = '#fcd34d';
        const defBody = '#fde68a';
        const defStamp = 'rgba(253, 230, 138, 0.75)';
        const bg = node.stickyBgColor || defBg;
        const txtCustom = node.stickyTextColor;
        const titleC = txtCustom || defTitle;
        const bodyC = txtCustom || defBody;

        this.ctx.fillStyle = bg;
        this.ctx.beginPath();
        this.ctx.roundRect(ix, iy, iw, ih, 6 * s);
        this.ctx.fill();
        this.ctx.strokeStyle = node.color ? node.color : 'rgba(251, 191, 36, 0.5)';
        this.ctx.lineWidth = 1 * s;
        this.ctx.stroke();

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
                this.ctx.fillStyle = txtCustom || defStamp;
                this.ctx.textAlign = 'right';
                this.ctx.textBaseline = 'bottom';
                this.ctx.fillText(stamp, ix + iw - padX, iy + ih - padX * 0.5);
                this.ctx.textAlign = 'left';
                this.ctx.textBaseline = 'top';
            } catch (_) { /* ignore */ }
        }
    }

    drawSimNodeImage(node, p, w, h, s) {
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
            this.defineShapePath(node, p, w, h, s);
            this.ctx.clip();
            
            // object-fit: cover logic
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

        // Title above image
        this.ctx.fillStyle = "#fff";
        this.ctx.font = `600 ${12 * s}px ${this.uiFontFamily()}`;
        this.ctx.textAlign = 'center';
        this.ctx.fillText(node.title, p.x + w/2, p.y - 12*s);
    }

    drawSimNodeText(node, p, w, h, s) {
        this.ctx.fillStyle = "#fff";
        this.ctx.font = `600 ${14 * s}px ${this.uiFontFamily()}`;
        this.ctx.textAlign = "center";
        this.ctx.textBaseline = "middle";
        
        const hasStatus = node.status && node.status !== 'none';
        const textY = hasStatus ? p.y + h/2 - 10 * s : p.y + h/2;
        this.ctx.fillText(node.title, p.x + w/2, textY);

        // STATUS BADGE (neon verze)
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

                this.ctx.fillStyle = sd.color + '25';
                this.ctx.beginPath();
                this.ctx.roundRect(bx, by, bw, badgeH, 3 * s);
                this.ctx.fill();
                this.ctx.strokeStyle = sd.color;
                this.ctx.lineWidth = 1 * s;
                if (!this.appManager.performanceMode) {
                    this.ctx.shadowBlur = 6;
                    this.ctx.shadowColor = sd.color;
                }
                this.ctx.stroke();
                this.ctx.shadowBlur = 0;

                this.ctx.fillStyle = sd.color;
                this.ctx.textAlign = 'center';
                this.ctx.textBaseline = 'middle';
                this.ctx.fillText(sd.label, p.x + w/2, by + badgeH/2);
            }
        }
    }

    drawStatTag(node, p, w, h, s) {
        const val = node.statValue;
        this.ctx.fillStyle = "#00f0ff";
        this.ctx.font = `800 ${10 * s}px ${this.uiFontFamily()}`;
        this.ctx.beginPath();
        this.ctx.roundRect(p.x + w - 30*s, p.y - 10*s, 35*s, 16*s, 4*s);
        this.ctx.fill();
        this.ctx.fillStyle = "#000";
        this.ctx.fillText(val.toFixed(1), p.x + w - 12*s, p.y - 2*s);
    }

    animate = () => {
        // Přeskočit draw, pokud je canvas skrytý (aktivní je CanvasRenderer)
        if (this.canvas.style.display !== 'none') {
            this.draw();
        }
        requestAnimationFrame(this.animate);
    }
}
