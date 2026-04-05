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
        this.dragNode = null;
        this.lastMouse = { x: 0, y: 0 };
        this.hoveredNodeId = null;

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
    toScreen(x, y) { return { x: (x + this.camera.x) * this.camera.zoom, y: (y + this.camera.y) * this.camera.zoom }; }
    toWorld(x, y) { return { x: (x / this.camera.zoom) - this.camera.x, y: (y / this.camera.zoom) - this.camera.y }; }

    setupEventListeners() {
        this.canvas.addEventListener('mousedown', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            const worldPos = this.toWorld(mouseX, mouseY);
            this.lastMouse = { x: mouseX, y: mouseY };

            const project = this.getProject();
            if (!project) return;
            this.appManager.hideContextMenu();

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
                if (e.shiftKey) {
                    // Selection box logic not yet in SIM, but panning for now
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
            this.lastMouse = { x: mouseX, y: mouseY };

            if (this.isDragging && this.dragNode) {
                const dwx = dx / this.camera.zoom;
                const dwy = dy / this.camera.zoom;
                for (let id of this.appManager.selectedNodeIds) {
                    const node = this.getProject().getNode(id);
                    if (node) {
                        node.x += dwx;
                        node.y += dwy;
                    }
                }
            } else if (this.isPanning) {
                this.camera.x += dx / this.camera.zoom;
                this.camera.y += dy / this.camera.zoom;
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
            }
        });

        window.addEventListener('mouseup', () => {
            if (this.isDragging && this.dragNode) {
                // Snap to grid
                for (let id of this.appManager.selectedNodeIds) {
                    const node = this.getProject().getNode(id);
                    if (node) {
                        node.x = Math.round(node.x / this.GRID_SIZE) * this.GRID_SIZE;
                        node.y = Math.round(node.y / this.GRID_SIZE) * this.GRID_SIZE;
                    }
                }
            }
            this.isDragging = false;
            this.isPanning = false;
            this.dragNode = null;
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

        // Sestavit set platných edgeKey — pro cleanup smazaných hran
        const validEdgeKeys = new Set();

        for (let [id, node] of project.nodes) {
            for (let edge of node.edges) {
                const edgeKey = `${id}-${edge.targetId}`;
                validEdgeKeys.add(edgeKey);

                if (!this.particles.has(edgeKey)) this.particles.set(edgeKey, []);
                const parts = this.particles.get(edgeKey);

                // Přidat nové
                if (parts.length < 5 && Math.random() < 0.05) {
                    parts.push({ t: 0, speed: 0.2 + Math.random() * 0.3 });
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
    getEdgePoints(pId, cId) {
        const project = this.getProject();
        const pNode = project.getNode(pId);
        const cNode = project.getNode(cId);
        if (!pNode || !cNode) return null;

        const b1 = pNode.getBounds();
        const b2 = cNode.getBounds();

        const p1 = this.toScreen(b1.x + b1.w/2, b1.y + b1.h);
        const p2 = this.toScreen(b2.x + b2.w/2, b2.y);
        const ctrlY = (p1.y + p2.y) / 2;
        const cp1 = { x: p1.x, y: ctrlY };
        const cp2 = { x: p2.x, y: ctrlY };
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

    drawArrowhead(x, y, angle, color, size = 10) {
        this.ctx.save();
        this.ctx.translate(x, y);
        this.ctx.rotate(angle);
        this.ctx.fillStyle = color;
        this.ctx.shadowBlur = 10;
        this.ctx.shadowColor = color;
        this.ctx.beginPath();
        this.ctx.moveTo(size, 0);
        this.ctx.lineTo(-size*0.7, -size*0.6);
        this.ctx.lineTo(-size*0.7, size*0.6);
        this.ctx.closePath();
        this.ctx.fill();
        this.ctx.restore();
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
    }

    drawSimEdge(parent, child, edge) {
        const pts = this.getEdgePoints(parent.id, child.id);
        if (!pts) return;
        const { p1, p2, cp1, cp2 } = pts;

        const color = ProjectNode.resolveEdgeColor(edge);
        const thickness = (edge.thickness || 2) * this.camera.zoom;

        // Glow line
        this.ctx.shadowBlur = 12 * this.camera.zoom;
        this.ctx.shadowColor = color;
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = thickness;
        this.ctx.beginPath();
        this.ctx.moveTo(p1.x, p1.y);
        this.ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, p2.x, p2.y);
        this.ctx.stroke();
        this.ctx.shadowBlur = 0;

        // Particles
        const edgeKey = `${parent.id}-${child.id}`;
        const parts = this.particles.get(edgeKey) || [];
        this.ctx.fillStyle = "#fff";
        for (let p of parts) {
            const px = this.bezierPoint(p1.x, cp1.x, cp2.x, p2.x, p.t);
            const py = this.bezierPoint(p1.y, cp1.y, cp2.y, p2.y, p.t);
            this.ctx.shadowBlur = 8;
            this.ctx.shadowColor = "#fff";
            this.ctx.beginPath();
            this.ctx.arc(px, py, thickness * 0.8, 0, Math.PI*2);
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
        this.ctx.font = `${11 * s}px Inter`;
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

        // Pulse effect if selected
        const pulse = isSelected ? Math.sin(this.glowPhase * 4) * 0.2 + 1 : 1;
        
        // Neon Glow
        this.ctx.shadowBlur = (isSelected ? 25 : (isHovered ? 15 : 5)) * s * pulse;
        this.ctx.shadowColor = isSelected ? "#00f0ff" : "rgba(0, 240, 255, 0.3)";

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
        } else {
            this.drawSimNodeText(node, p, w, h, s);
        }

        // Stats indicator if value > 0
        if (node.statValue > 0) {
            this.drawStatTag(node, p, w, h, s);
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
            this.ctx.globalAlpha = 0.8;
            this.ctx.drawImage(img, p.x, p.y, w, h);
            this.ctx.restore();
        }

        // Title above image
        this.ctx.fillStyle = "#fff";
        this.ctx.font = `600 ${12 * s}px Inter`;
        this.ctx.textAlign = 'center';
        this.ctx.fillText(node.title, p.x + w/2, p.y - 12*s);
    }

    drawSimNodeText(node, p, w, h, s) {
        this.ctx.fillStyle = "#fff";
        this.ctx.font = `600 ${14 * s}px Outfit`;
        this.ctx.textAlign = "center";
        this.ctx.textBaseline = "middle";
        this.ctx.fillText(node.title, p.x + w/2, p.y + h/2);
    }

    drawStatTag(node, p, w, h, s) {
        const val = node.statValue;
        this.ctx.fillStyle = "#00f0ff";
        this.ctx.font = `800 ${10 * s}px Inter`;
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
