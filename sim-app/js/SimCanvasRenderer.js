import { SimNode } from './SimNode.js';
import { formatStateOverlay } from './SimulationEngine.js';

/**
 * @typedef {object} SimStudioAppLike
 * @property {() => import('./SimProject.js').SimProject | null} getProject
 * @property {Set<string>} selectedNodeIds
 * @property {boolean} snapToGrid
 * @property {() => void} pushHistory
 * @property {{ success: (msg: string) => void }} toast
 * @property {boolean} performanceMode
 * @property {{ x: number | null, y: number | null }} alignmentLines
 * @property {(node: SimNode) => { x: number | null, y: number | null }} getAlignmentLines
 * @property {() => object | null} getSimState
 */

export class SimCanvasRenderer {
    /**
     * @param {string} canvasId
     * @param {SimStudioAppLike} app
     */
    constructor(canvasId, app) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.app = app;
        this.camera = { x: 0, y: 0, zoom: 1 };
        this.GRID_SIZE = 40;

        this.isPanning = false;
        this.isDragging = false;
        this.isResizing = false;
        this.isConnectingDrag = false;
        this.panStartMouse = null;
        this.isMMBPanning = false;

        this.dragNode = null;
        this.resizeDir = null;
        this.initialBounds = null;
        this.aspectRatio = 1;
        this.connectStartSide = null;
        this.connectCurrentPos = { x: 0, y: 0 };

        this.lastMouse = { x: 0, y: 0 };
        this.hoveredNodeId = null;
        this.hoveredEdge = null;

        this.animTime = 0;
        this.lastFrameTime = performance.now();
        this.glowPhase = 0;

        this.particles = new Map();
        this.transferBurstQueue = [];

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

    getProject() {
        return this.app.getProject();
    }

    toScreen(x, y) {
        return { x: (x + this.camera.x) * this.camera.zoom, y: (y + this.camera.y) * this.camera.zoom };
    }

    toWorld(x, y) {
        return { x: x / this.camera.zoom - this.camera.x, y: y / this.camera.zoom - this.camera.y };
    }

    /** @param {Array<{ edgeKey: string }>} transfers */
    queueTransferParticles(transfers) {
        for (const t of transfers) {
            if (!t.edgeKey) continue;
            this.transferBurstQueue.push({ edgeKey: t.edgeKey, left: 6 });
        }
    }

    setupEventListeners() {
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

            if (this.app.selectedNodeIds.size === 1) {
                const node = project.getNode(Array.from(this.app.selectedNodeIds)[0]);
                if (node) {
                    const handle = this.getResizeHandleAt(node, worldPos);
                    if (handle) {
                        this.isResizing = true;
                        this.dragNode = node;
                        this.resizeDir = handle;
                        this.initialBounds = { x: node.x, y: node.y, w: node.width, h: node.height };
                        this.aspectRatio = node.width / node.height;
                        this.app.pushHistory();
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
            }

            let clickedNode = null;
            const nodesArr = Array.from(project.nodes.values()).reverse();
            for (const node of nodesArr) {
                const b = node.getBounds();
                if (worldPos.x >= b.x && worldPos.x <= b.x + b.w && worldPos.y >= b.y && worldPos.y <= b.y + b.h) {
                    clickedNode = node;
                    break;
                }
            }

            if (clickedNode) {
                this.app.selectNode(clickedNode.id, e.shiftKey);
                this.isDragging = true;
                this.dragNode = clickedNode;
                this.app.pushHistory();
            } else {
                const edgeHit = this.getEdgeAt(worldPos);
                if (edgeHit) {
                    this.app.selectEdge(edgeHit);
                    return;
                }
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
                this.app.alignmentLines = { x: null, y: null };
                const dwx = dx / this.camera.zoom;
                const dwy = dy / this.camera.zoom;
                for (const id of this.app.selectedNodeIds) {
                    const node = this.getProject()?.getNode(id);
                    if (node) {
                        node.x += dwx;
                        node.y += dwy;
                    }
                }
                if (this.app.selectedNodeIds.size === 1) {
                    this.app.alignmentLines = this.app.getAlignmentLines(this.dragNode);
                }
            } else if (this.isPanning) {
                this.camera.x += dx / this.camera.zoom;
                this.camera.y += dy / this.camera.zoom;
            } else if (this.isMMBPanning) {
                this.camera.x += dx / this.camera.zoom;
                this.camera.y += dy / this.camera.zoom;
            } else {
                const project = this.getProject();
                this.hoveredNodeId = null;
                this.hoveredEdge = null;
                if (project) {
                    for (const node of project.nodes.values()) {
                        const b = node.getBounds();
                        if (worldPos.x >= b.x && worldPos.x <= b.x + b.w && worldPos.y >= b.y && worldPos.y <= b.y + b.h) {
                            this.hoveredNodeId = node.id;
                        }
                    }
                    if (!this.hoveredNodeId) {
                        this.hoveredEdge = this.getEdgeAt(worldPos);
                    }
                }
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
                for (const node of project.nodes.values()) {
                    if (node.id === this.dragNode.id) continue;
                    const b = node.getBounds();
                    if (worldPos.x >= b.x && worldPos.x <= b.x + b.w && worldPos.y >= b.y && worldPos.y <= b.y + b.h) {
                        targetNode = node;
                        break;
                    }
                }
                if (targetNode) {
                    const endSide = targetNode.getNearestSide(worldPos);
                    this.dragNode.addEdge(targetNode.id, {
                        startSide: this.connectStartSide,
                        endSide: endSide,
                    });
                    this.app.pushHistory();
                    this.app.toast.success('Spojeno');
                }
            }

            if (this.isDragging && this.dragNode && this.app.snapToGrid) {
                for (const id of this.app.selectedNodeIds) {
                    const node = this.getProject()?.getNode(id);
                    if (node) {
                        node.x = Math.round(node.x / this.GRID_SIZE) * this.GRID_SIZE;
                        node.y = Math.round(node.y / this.GRID_SIZE) * this.GRID_SIZE;
                    }
                }
            }

            if (this.isPanning && this.panStartMouse) {
                const rect2 = this.canvas.getBoundingClientRect();
                const endX = e.clientX - rect2.left;
                const endY = e.clientY - rect2.top;
                const moved = Math.hypot(endX - this.panStartMouse.x, endY - this.panStartMouse.y);
                if (moved < 5) {
                    this.app.selectNode(null);
                    this.app.selectEdge(null);
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

        this.canvas.addEventListener(
            'wheel',
            (e) => {
                e.preventDefault();
                const zoomAmount = e.deltaY > 0 ? 0.9 : 1.1;
                const rect = this.canvas.getBoundingClientRect();
                const mouseX = e.clientX - rect.left;
                const mouseY = e.clientY - rect.top;
                const worldBefore = this.toWorld(mouseX, mouseY);
                this.camera.zoom *= zoomAmount;
                this.camera.zoom = Math.max(0.1, Math.min(this.camera.zoom, 3));
                const worldAfter = this.toWorld(mouseX, mouseY);
                this.camera.x += worldAfter.x - worldBefore.x;
                this.camera.y += worldAfter.y - worldBefore.y;
            },
            { passive: false }
        );
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

    updateParticles(dt) {
        const project = this.getProject();
        if (!project) return;

        const validEdgeKeys = new Set();
        const perf = this.app.performanceMode;

        for (const [id, node] of project.nodes) {
            for (const edge of node.edges) {
                const edgeKey = `${id}-${edge.targetId}`;
                validEdgeKeys.add(edgeKey);
                if (!this.particles.has(edgeKey)) this.particles.set(edgeKey, []);
                const parts = this.particles.get(edgeKey);
                const maxParts = perf ? 3 : 8;
                const chance = perf ? 0.015 : 0.04;
                if (parts.length < maxParts && Math.random() < chance) {
                    parts.push({ t: 0, speed: 0.2 + Math.random() * 0.35, isSignal: false });
                }
                for (let i = parts.length - 1; i >= 0; i--) {
                    parts[i].t += parts[i].speed * dt;
                    if (parts[i].t > 1) parts.splice(i, 1);
                }
            }
        }

        for (let i = this.transferBurstQueue.length - 1; i >= 0; i--) {
            const b = this.transferBurstQueue[i];
            if (!validEdgeKeys.has(b.edgeKey)) {
                this.transferBurstQueue.splice(i, 1);
                continue;
            }
            if (!this.particles.has(b.edgeKey)) this.particles.set(b.edgeKey, []);
            const parts = this.particles.get(b.edgeKey);
            const maxParts = perf ? 12 : 24;
            if (b.left > 0 && parts.length < maxParts) {
                parts.push({ t: 0, speed: 0.45 + Math.random() * 0.35, isSignal: true });
                b.left--;
            }
            if (b.left <= 0) this.transferBurstQueue.splice(i, 1);
        }

        for (const key of this.particles.keys()) {
            if (!validEdgeKeys.has(key)) this.particles.delete(key);
        }
    }

    getEdgePoints(pId, cId, edge = {}) {
        const project = this.getProject();
        const pNode = project.getNode(pId);
        const cNode = project.getNode(cId);
        if (!pNode || !cNode) return null;
        const p1 = this.toScreen(pNode.getSidePoint(edge.startSide || 'bottom').x, pNode.getSidePoint(edge.startSide || 'bottom').y);
        const p2 = this.toScreen(cNode.getSidePoint(edge.endSide || 'top').x, cNode.getSidePoint(edge.endSide || 'top').y);
        let cp1;
        let cp2;
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
        return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
    }

    bezierTangent(p0, p1, p2, p3, t) {
        const mt = 1 - t;
        return 3 * mt * mt * (p1 - p0) + 6 * mt * t * (p2 - p1) + 3 * t * t * (p3 - p2);
    }

    getEdgeAt(worldPos) {
        const project = this.getProject();
        if (!project) return null;
        const threshold = 12 / this.camera.zoom;
        for (const node of project.nodes.values()) {
            for (const edge of node.edges) {
                const child = project.getNode(edge.targetId);
                if (!child) continue;
                const p1w = node.getSidePoint(edge.startSide || 'bottom');
                const p2w = child.getSidePoint(edge.endSide || 'top');
                let cp1w;
                let cp2w;
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
                    const ddx = worldPos.x - bx;
                    const ddy = worldPos.y - by;
                    if (ddx * ddx + ddy * ddy < threshold * threshold) {
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
        if (!this.app.performanceMode) {
            this.ctx.shadowBlur = 10;
            this.ctx.shadowColor = color;
        }
        this.ctx.beginPath();
        this.ctx.moveTo(size, 0);
        this.ctx.lineTo(-size * 0.7, -size * 0.6);
        this.ctx.lineTo(-size * 0.7, size * 0.6);
        this.ctx.closePath();
        this.ctx.fill();
        this.ctx.restore();
    }

    getResizeHandleAt(node, worldPos) {
        const b = node.getBounds();
        const s = 12 / this.camera.zoom;
        if (Math.abs(worldPos.x - b.x) < s && Math.abs(worldPos.y - b.y) < s) return 'nw';
        if (Math.abs(worldPos.x - (b.x + b.w)) < s && Math.abs(worldPos.y - b.y) < s) return 'ne';
        if (Math.abs(worldPos.x - b.x) < s && Math.abs(worldPos.y - (b.y + b.h)) < s) return 'sw';
        if (Math.abs(worldPos.x - (b.x + b.w)) < s && Math.abs(worldPos.y - (b.y + b.h)) < s) return 'se';
        return null;
    }

    getConnectHandleAt(node, worldPos) {
        const sides = ['top', 'bottom', 'left', 'right'];
        const s = 12 / this.camera.zoom;
        for (const side of sides) {
            const p = node.getSidePoint(side);
            if (Math.abs(worldPos.x - p.x) < s && Math.abs(worldPos.y - p.y) < s) return side;
        }
        return null;
    }

    handleResizeMove(node, worldPos, shiftKey) {
        const b = this.initialBounds;
        const isImageShape = node.shape === 'image' || (node.simKind === 'actor' && node.nodeImage);
        const lockRatio = isImageShape ? !shiftKey : shiftKey;
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

    drawSimEdge(parent, child, edge) {
        const pts = this.getEdgePoints(parent.id, child.id, edge);
        if (!pts) return;
        const { p1, p2, cp1, cp2 } = pts;
        const perf = this.app.performanceMode;
        const color = SimNode.resolveEdgeColor(edge);
        const isHovered =
            this.hoveredEdge && this.hoveredEdge.sourceNodeId === parent.id && this.hoveredEdge.targetId === edge.targetId;
        const thickness = (edge.thickness || (isHovered ? 4 : 2)) * this.camera.zoom;
        if (!perf || isHovered) {
            this.ctx.shadowBlur = (isHovered ? 20 : 12) * this.camera.zoom;
            this.ctx.shadowColor = isHovered ? '#fff' : color;
        }
        this.ctx.strokeStyle = isHovered ? '#fff' : color;
        this.ctx.lineWidth = isHovered ? thickness + 2 : thickness;
        this.ctx.beginPath();
        this.ctx.moveTo(p1.x, p1.y);
        this.ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, p2.x, p2.y);
        this.ctx.stroke();
        this.ctx.shadowBlur = 0;

        const edgeKey = `${parent.id}-${edge.targetId}`;
        const parts = this.particles.get(edgeKey) || [];
        for (const p of parts) {
            const px = this.bezierPoint(p1.x, cp1.x, cp2.x, p2.x, p.t);
            const py = this.bezierPoint(p1.y, cp1.y, cp2.y, p2.y, p.t);
            this.ctx.fillStyle = p.isSignal ? '#00f0ff' : '#fff';
            if (!perf) {
                this.ctx.shadowBlur = p.isSignal ? 15 : 8;
                this.ctx.shadowColor = p.isSignal ? '#00f0ff' : '#fff';
            }
            this.ctx.beginPath();
            this.ctx.arc(px, py, thickness * (p.isSignal ? 1.2 : 0.8), 0, Math.PI * 2);
            this.ctx.fill();
        }

        const tx = this.bezierTangent(p1.x, cp1.x, cp2.x, p2.x, 1);
        const ty = this.bezierTangent(p1.y, cp1.y, cp2.y, p2.y, 1);
        const angle = Math.atan2(ty, tx);
        this.drawArrowhead(p2.x, p2.y, angle, color, 10 * this.camera.zoom);

        const label = edge.label || edge.simChannel || '';
        if (label) {
            const mx = this.bezierPoint(p1.x, cp1.x, cp2.x, p2.x, 0.5);
            const my = this.bezierPoint(p1.y, cp1.y, cp2.y, p2.y, 0.5);
            this.drawEdgeLabel(label, mx, my, color);
        }
    }

    drawEdgeLabel(label, x, y, color) {
        const s = this.camera.zoom;
        this.ctx.font = `${11 * s}px Inter, sans-serif`;
        const tw = this.ctx.measureText(label).width;
        const bw = tw + 16 * s;
        const bh = 18 * s;
        this.ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
        this.ctx.shadowBlur = 4;
        this.ctx.shadowColor = 'black';
        this.ctx.beginPath();
        this.ctx.roundRect(x - bw / 2, y - bh / 2, bw, bh, 4 * s);
        this.ctx.fill();
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = 1 * s;
        this.ctx.stroke();
        this.ctx.fillStyle = '#fff';
        this.ctx.textAlign = 'center';
        this.ctx.fillText(label, x, y + 4 * s);
        this.ctx.shadowBlur = 0;
    }

    defineShapePath(node, p, w, h, s) {
        if (node.shape === 'rect' || node.shape === 'image') {
            this.ctx.roundRect(p.x, p.y, w, h, 10 * s);
        } else if (node.shape === 'circle') {
            this.ctx.arc(p.x + w / 2, p.y + h / 2, Math.min(w, h) / 2, 0, Math.PI * 2);
        } else {
            this.ctx.roundRect(p.x, p.y, w, h, 10 * s);
        }
    }

    drawSimNodeImage(node, p, w, h, s) {
        const url = node.nodeImage;
        if (!url) return;
        if (!this.imageCache.has(url)) {
            const img = new Image();
            img.src = url;
            img.onload = () => {
                this.imageCache.set(url, img);
            };
            this.imageCache.set(url, null);
            return;
        }
        const img = this.imageCache.get(url);
        if (!img) return;
        this.ctx.save();
        this.ctx.beginPath();
        this.defineShapePath(node, p, w, h, s);
        this.ctx.clip();
        const iw = img.width;
        const ih = img.height;
        const targetRatio = w / h;
        const imgRatio = iw / ih;
        let sx;
        let sy;
        let sw;
        let sh;
        if (imgRatio > targetRatio) {
            sh = ih;
            sw = ih * targetRatio;
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

    drawSimNode(node) {
        const b = node.getBounds();
        const p = this.toScreen(b.x, b.y);
        const w = b.w * this.camera.zoom;
        const h = b.h * this.camera.zoom;
        const s = this.camera.zoom;
        const isSelected = this.app.selectedNodeIds.has(node.id);
        const isHovered = this.hoveredNodeId === node.id;
        const pulse = isSelected ? Math.sin(this.glowPhase * 4) * 0.2 + 1 : 1;
        const showImage = Boolean(node.nodeImage && (node.shape === 'image' || node.simKind === 'actor'));

        if (!this.app.performanceMode) {
            this.ctx.shadowBlur = (isSelected ? 25 : isHovered ? 15 : 5) * s * pulse;
            this.ctx.shadowColor = isSelected ? '#00f0ff' : 'rgba(0, 240, 255, 0.3)';
        }

        this.ctx.fillStyle = isSelected ? 'rgba(30, 41, 59, 0.95)' : 'rgba(15, 23, 42, 0.8)';
        this.ctx.beginPath();
        this.defineShapePath(node, p, w, h, s);
        this.ctx.fill();

        if (showImage) {
            this.drawSimNodeImage(node, p, w, h, s);
        }

        this.ctx.strokeStyle = isSelected ? '#00f0ff' : 'rgba(0, 240, 255, 0.4)';
        this.ctx.lineWidth = (isSelected ? 3 : 1.5) * s;
        this.ctx.beginPath();
        this.defineShapePath(node, p, w, h, s);
        this.ctx.stroke();
        this.ctx.shadowBlur = 0;

        const roleSuffix = node.simKind === 'actor' && node.simMeta?.role ? ` · ${node.simMeta.role}` : '';
        this.ctx.fillStyle = '#fff';
        this.ctx.font = `600 ${12 * s}px Outfit, sans-serif`;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'top';
        const kindLabel = (node.simKind || '') + roleSuffix;
        const titleY = showImage ? p.y + 4 * s : p.y + 6 * s;
        this.ctx.fillStyle = showImage ? 'rgba(15,23,42,0.92)' : '#fff';
        if (showImage) {
            const tw = Math.min(w - 8 * s, this.ctx.measureText(node.title).width + 8 * s);
            this.ctx.beginPath();
            this.ctx.roundRect(p.x + w / 2 - tw / 2, titleY - 2 * s, tw, 16 * s, 4 * s);
            this.ctx.fill();
            this.ctx.fillStyle = '#fff';
        }
        this.ctx.fillText(node.title, p.x + w / 2, titleY);
        this.ctx.font = `500 ${9 * s}px Inter, sans-serif`;
        this.ctx.fillStyle = 'rgba(148, 163, 184, 0.95)';
        if (showImage) {
            this.ctx.fillStyle = 'rgba(241,245,249,0.95)';
            this.ctx.shadowColor = 'rgba(0,0,0,0.8)';
            this.ctx.shadowBlur = 4 * s;
        }
        this.ctx.fillText(kindLabel, p.x + w / 2, titleY + 14 * s);
        this.ctx.shadowBlur = 0;

        const simState = this.app.getSimState?.();
        if (simState?.vars?.[node.id]) {
            const overlay = formatStateOverlay(node, simState.vars);
            if (overlay) {
                this.ctx.font = `600 ${9 * s}px Inter, sans-serif`;
                this.ctx.fillStyle = '#00f0ff';
                this.ctx.textBaseline = 'bottom';
                if (showImage) {
                    this.ctx.fillStyle = 'rgba(254,249,195,0.98)';
                    this.ctx.shadowColor = 'rgba(0,0,0,0.85)';
                    this.ctx.shadowBlur = 6 * s;
                }
                const lines = overlay.length > 42 ? `${overlay.slice(0, 40)}…` : overlay;
                this.ctx.fillText(lines, p.x + w / 2, p.y + h - 6 * s);
                this.ctx.shadowBlur = 0;
                this.ctx.textBaseline = 'alphabetic';
            }
        }

        if (isSelected && this.app.selectedNodeIds.size === 1) {
            this.drawSimHandles(node, p, w, h, s);
        }
    }

    drawSimHandles(node, p, w, h, s) {
        this.ctx.fillStyle = '#00f0ff';
        const hs = 8 * s;
        this.ctx.fillRect(p.x - hs / 2, p.y - hs / 2, hs, hs);
        this.ctx.fillRect(p.x + w - hs / 2, p.y - hs / 2, hs, hs);
        this.ctx.fillRect(p.x - hs / 2, p.y + h - hs / 2, hs, hs);
        this.ctx.fillRect(p.x + w - hs / 2, p.y + h - hs / 2, hs, hs);
        const sides = ['top', 'bottom', 'left', 'right'];
        this.ctx.fillStyle = '#10b981';
        this.ctx.strokeStyle = '#fff';
        this.ctx.lineWidth = 1 * s;
        for (const side of sides) {
            const sp = this.toScreen(node.getSidePoint(side).x, node.getSidePoint(side).y);
            this.ctx.beginPath();
            this.ctx.arc(sp.x, sp.y, 4 * s, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.stroke();
        }
    }

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

        for (const node of project.nodes.values()) {
            for (const edge of node.edges) {
                const child = project.getNode(edge.targetId);
                if (child) this.drawSimEdge(node, child, edge);
            }
        }

        for (const node of project.nodes.values()) {
            this.drawSimNode(node);
        }

        if (this.isConnectingDrag && this.dragNode) {
            const p1 = this.toScreen(
                this.dragNode.getSidePoint(this.connectStartSide).x,
                this.dragNode.getSidePoint(this.connectStartSide).y
            );
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

        if (this.isDragging && this.dragNode && this.app.alignmentLines.x !== null) {
            const lx = this.toScreen(this.app.alignmentLines.x, 0).x;
            this.ctx.strokeStyle = '#00f0ff';
            this.ctx.setLineDash([5, 5]);
            this.ctx.beginPath();
            this.ctx.moveTo(lx, 0);
            this.ctx.lineTo(lx, this.canvas.height);
            this.ctx.stroke();
            this.ctx.setLineDash([]);
        }
        if (this.isDragging && this.dragNode && this.app.alignmentLines.y !== null) {
            const ly = this.toScreen(0, this.app.alignmentLines.y).y;
            this.ctx.strokeStyle = '#00f0ff';
            this.ctx.setLineDash([5, 5]);
            this.ctx.beginPath();
            this.ctx.moveTo(0, ly);
            this.ctx.lineTo(this.canvas.width, ly);
            this.ctx.stroke();
            this.ctx.setLineDash([]);
        }
    }

    animate = () => {
        this.draw();
        requestAnimationFrame(this.animate);
    };
}
