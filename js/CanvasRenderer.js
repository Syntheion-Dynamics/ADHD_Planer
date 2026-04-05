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
        this.dragNode = null;
        this.lastMouse = { x: 0, y: 0 };
        this.hoveredNodeId = null;
        
        // V2.0 animation state
        this.animTime = 0;
        this.lastFrameTime = performance.now();

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
            
            let clickedNode = null;
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

            if (this.appManager.isConnecting) {
                if (clickedNode && clickedNode.id !== this.appManager.selectedNodeId) {
                    const snode = project.getNode(this.appManager.selectedNodeId);
                    if (snode) {
                        snode.addEdge(clickedNode.id);
                        this.appManager.selectNode(this.appManager.selectedNodeId);
                    }
                }
                this.appManager.isConnecting = false;
                document.getElementById('connect-overlay').classList.add('hidden');
                return;
            }

            if (clickedNode) {
                this.appManager.selectNode(clickedNode.id);
                this.isDragging = true;
                this.dragNode = clickedNode;
            } else {
                this.isPanning = true;
            }
        });

        this.canvas.addEventListener('mousemove', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            const dx = mouseX - this.lastMouse.x;
            const dy = mouseY - this.lastMouse.y;
            this.lastMouse = { x: mouseX, y: mouseY };

            if (this.isDragging && this.dragNode) {
                this.dragNode.x += dx / this.camera.zoom;
                this.dragNode.y += dy / this.camera.zoom;
            } else if (this.isPanning) {
                this.camera.x += dx / this.camera.zoom;
                this.camera.y += dy / this.camera.zoom;
            } else {
                const worldPos = this.toWorld(mouseX, mouseY);
                const project = this.getProject();
                this.hoveredNodeId = null;
                if (project) {
                    const nodesArr = Array.from(project.nodes.values()).reverse();
                    for (let node of nodesArr) {
                        let ww = node.shape === 'diamond' ? node.width * 1.5 : node.width;
                        let hh = node.shape === 'diamond' ? node.height * 1.5 : node.height;
                        let cx = node.shape === 'diamond' ? node.x - node.width*0.25 : node.x;
                        let cy = node.shape === 'diamond' ? node.y - node.height*0.25 : node.y;

                        if (worldPos.x >= cx && worldPos.x <= cx + ww &&
                            worldPos.y >= cy && worldPos.y <= cy + hh) {
                            this.hoveredNodeId = node.id;
                            break;
                        }
                    }
                }
                this.canvas.style.cursor = this.hoveredNodeId ? 'pointer' : (this.isPanning ? 'grabbing' : 'crosshair');
            }
        });

        window.addEventListener('mouseup', () => {
            if (this.isDragging && this.dragNode) {
                this.dragNode.x = Math.round(this.dragNode.x / this.GRID_SIZE) * this.GRID_SIZE;
                this.dragNode.y = Math.round(this.dragNode.y / this.GRID_SIZE) * this.GRID_SIZE;
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

    // ---- BEZIER HELPERS (V2.0) ----
    
    bezierPoint(p0, p1, p2, p3, t) {
        const mt = 1 - t;
        return mt*mt*mt*p0 + 3*mt*mt*t*p1 + 3*mt*t*t*p2 + t*t*t*p3;
    }

    bezierTangent(p0, p1, p2, p3, t) {
        const mt = 1 - t;
        return 3*mt*mt*(p1-p0) + 6*mt*t*(p2-p1) + 3*t*t*(p3-p2);
    }

    getEdgeEndpoints(parent, child) {
        const p1 = this.toScreen(parent.x + parent.width / 2, parent.y + parent.height);
        const p2 = this.toScreen(child.x + child.width / 2, child.y);
        const ctrlY = (p1.y + p2.y) / 2;
        const cp1 = { x: p1.x, y: ctrlY };
        const cp2 = { x: p2.x, y: ctrlY };
        return { p1, p2, cp1, cp2 };
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

        // 1. KRESLENÍ ČAR
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

        // 2. KRESLENÍ UZLŮ
        for (let [id, node] of project.nodes) {
            this.drawNode(node, isLight);
        }
    }

    drawBasicEdge(parent, child) {
        const { p1, p2, cp1, cp2 } = this.getEdgeEndpoints(parent, child);
        this.ctx.beginPath();
        this.ctx.moveTo(p1.x, p1.y);
        this.ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, p2.x, p2.y);
        this.ctx.stroke();
    }

    // V2.0 — Opravená šipka: trojúhelník zahnutý ve směru tečny křivky
    drawArrowhead(x, y, angle, color, size = 7) {
        const s = this.camera.zoom;
        this.ctx.save();
        this.ctx.translate(x, y);
        this.ctx.rotate(angle);
        this.ctx.beginPath();
        // Trojúhelník směřující doprava (angle=0 → tip na +x)
        const tipLen = size * s;
        const halfBase = (size * 0.6) * s;
        this.ctx.moveTo(tipLen, 0);         // špička
        this.ctx.lineTo(-halfBase, -halfBase); // vlevo nahoře
        this.ctx.lineTo(-halfBase, halfBase);  // vlevo dole
        this.ctx.closePath();
        this.ctx.fillStyle = color;
        this.ctx.fill();
        this.ctx.restore();
    }

    drawNode(node, isLight) {
        let p = this.toScreen(node.x, node.y);
        let w = node.width * this.camera.zoom;
        let h = node.height * this.camera.zoom;
        const isSelected = this.appManager.selectedNodeId === node.id;
        const isHovered = this.hoveredNodeId === node.id;

        let actualW = w; let actualH = h; let startX = p.x; let startY = p.y;
        if (node.shape === 'diamond') {
            actualW = w * 1.5;
            actualH = h * 1.5;
            startX = p.x - w*0.25;
            startY = p.y - h*0.25;
        }

        // V2.0 — Stín
        this.ctx.shadowColor = isSelected ? (isLight ? 'rgba(59, 130, 246, 0.5)' : 'rgba(0, 240, 255, 0.5)') : 'rgba(0, 0, 0, 0.3)';
        this.ctx.shadowBlur = isSelected ? 18 : 6;
        this.ctx.shadowOffsetX = 0;
        this.ctx.shadowOffsetY = 3;

        // V2.0 — Gradient pozadí uzlu
        let bgGrad;
        if (node.shape === 'diamond') {
            bgGrad = isLight ? (isSelected ? '#e0e7ff' : '#ffffff') : (isSelected ? '#1e2235' : '#191b24');
        } else {
            bgGrad = this.ctx.createLinearGradient(startX, startY, startX, startY + actualH);
            if (isLight) {
                bgGrad.addColorStop(0, isSelected ? '#e8edff' : '#ffffff');
                bgGrad.addColorStop(1, isSelected ? '#dbe4ff' : '#f8fafc');
            } else {
                bgGrad.addColorStop(0, isSelected ? '#222640' : '#1f2130');
                bgGrad.addColorStop(1, isSelected ? '#1a1e35' : '#16181f');
            }
        }
        
        // Border barva
        let borderColor = isSelected ? (isLight ? '#3b82f6' : '#00f0ff') : (isHovered ? (isLight?'#8b5cf6':'#9d4edd') : (isLight ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.1)'));
        let statusStroke = false;
        
        if (!isSelected && node.status !== 'none' && node.status) {
            statusStroke = true;
            if (node.status === 'todo') borderColor = isLight ? '#9ca3af' : '#6b7280';
            else if (node.status === 'progress') borderColor = '#f59e0b';
            else if (node.status === 'done') borderColor = '#10b981';
            else if (node.status === 'blocked') borderColor = '#ef4444';
        }

        this.ctx.fillStyle = bgGrad;
        
        this.ctx.beginPath();
        if (node.shape === 'diamond') {
            this.ctx.moveTo(startX + actualW/2, startY);
            this.ctx.lineTo(startX + actualW, startY + actualH/2);
            this.ctx.lineTo(startX + actualW/2, startY + actualH);
            this.ctx.lineTo(startX, startY + actualH/2);
            this.ctx.closePath();
        } else {
            const radius = 10 * this.camera.zoom;
            this.ctx.roundRect(startX, startY, actualW, actualH, radius);
        }
        this.ctx.fill();
        
        this.ctx.shadowBlur = 0;
        this.ctx.shadowColor = 'transparent';
        
        // Border
        this.ctx.lineWidth = (statusStroke || isSelected) ? 2.5 * this.camera.zoom : 1.5 * this.camera.zoom;
        this.ctx.strokeStyle = borderColor;
        this.ctx.stroke();

        // V2.0 — Status stripe na levé straně (jen rect)
        if (node.shape === 'rect' && node.status && node.status !== 'none') {
            let stripeColor = '#6b7280';
            if (node.status === 'todo') stripeColor = '#6b7280';
            else if (node.status === 'progress') stripeColor = '#f59e0b';
            else if (node.status === 'done') stripeColor = '#10b981';
            else if (node.status === 'blocked') stripeColor = '#ef4444';
            
            const stripeW = 4 * this.camera.zoom;
            const radius = 10 * this.camera.zoom;
            this.ctx.save();
            this.ctx.beginPath();
            this.ctx.roundRect(startX, startY, stripeW + radius, actualH, [radius, 0, 0, radius]);
            this.ctx.clip();
            this.ctx.fillStyle = stripeColor;
            this.ctx.fillRect(startX, startY, stripeW, actualH);
            this.ctx.restore();
        }

        // ---- TEXT ----
        const textColor = isLight ? '#111827' : '#e2e8f0';
        this.ctx.fillStyle = textColor;
        this.ctx.font = `600 ${14 * this.camera.zoom}px Outfit`;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        
        let text = node.title;
        let limit = node.shape === 'diamond' ? 14 : 20;
        if (text.length > limit) text = text.substring(0, limit-2) + '...';
        
        this.ctx.fillText(text, startX + actualW/2, startY + actualH/2);

        // V2.0 — Note count badge (jen rect, hlavně v data módu)
        if (node.shape === 'rect' && node.notes && node.notes.length > 1) {
            const badgeSize = 16 * this.camera.zoom;
            const bx = startX + actualW - badgeSize - 4 * this.camera.zoom;
            const by = startY + 4 * this.camera.zoom;
            this.ctx.fillStyle = isLight ? 'rgba(59,130,246,0.15)' : 'rgba(0,240,255,0.15)';
            this.ctx.beginPath();
            this.ctx.arc(bx + badgeSize/2, by + badgeSize/2, badgeSize/2, 0, Math.PI*2);
            this.ctx.fill();
            this.ctx.fillStyle = isLight ? '#3b82f6' : '#00f0ff';
            this.ctx.font = `700 ${9 * this.camera.zoom}px Inter`;
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';
            this.ctx.fillText(`${node.notes.length}`, bx + badgeSize/2, by + badgeSize/2);
        }

        // Pinned Flag 🚩
        if (node.isPinned) {
            this.ctx.font = `${16 * this.camera.zoom}px Inter`;
            this.ctx.textAlign = 'center';
            this.ctx.fillText("🚩", startX + 10*this.camera.zoom, startY - 5*this.camera.zoom);
        }

        // Hashtag z první noty
        if (node.shape === 'rect' && node.notes && node.notes.length > 0 && node.notes[0].tags && node.notes[0].tags.length > 0) {
            const firstTag = node.notes[0].tags[0];
            this.ctx.fillStyle = isLight ? '#94a3b8' : '#475569';
            this.ctx.font = `500 ${9 * this.camera.zoom}px Inter`;
            this.ctx.textAlign = 'left';
            this.ctx.fillText(firstTag, startX + 8*this.camera.zoom, startY + actualH - 10*this.camera.zoom);
        }
    }

    animate = () => {
        this.draw();
        requestAnimationFrame(this.animate);
    }
}
