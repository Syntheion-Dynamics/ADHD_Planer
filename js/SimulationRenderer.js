import { ProjectNode, EDGE_COLORS } from './ProjectNode.js';

export class SimulationRenderer {
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

        // Animation state
        this.animTime = 0;
        this.lastFrameTime = performance.now();
        this.particles = new Map(); // edgeKey -> [{t, speed}, ...]
        this.glowPhase = 0;

        // Node image cache
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

    // =============================================
    // EVENT LISTENERS (shared pattern)
    // =============================================
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
    // BEZIER MATH
    // =============================================
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
        return {
            p1, p2,
            cp1: { x: p1.x, y: ctrlY },
            cp2: { x: p2.x, y: ctrlY }
        };
    }

    // =============================================
    // INFLUENCE CHAIN
    // =============================================
    getInfluenceChain(project, startId) {
        let chain = new Set();
        if (!startId) return chain;
        
        const visitDown = (id) => {
            if (chain.has(id)) return;
            chain.add(id);
            const n = project.getNode(id);
            if (n && n.edges) {
                n.edges.forEach(e => visitDown(e.targetId));
            }
        };
        visitDown(startId);

        chain.delete(startId);
        const visitUp = (id) => {
            if (chain.has(id)) return;
            chain.add(id);
            for (let [nid, n] of project.nodes) {
                if (n.edges.some(e => e.targetId === id)) {
                    visitUp(nid);
                }
            }
        };
        visitUp(startId);
        chain.add(startId);
        return chain;
    }

    // =============================================
    // PARTICLE SYSTEM
    // =============================================
    updateParticles(dt) {
        const project = this.getProject();
        if (!project) return;
        
        const activeKeys = new Set();
        
        for (let [id, node] of project.nodes) {
            for (let edge of node.edges) {
                const key = `${id}_${edge.targetId}`;
                activeKeys.add(key);
                
                if (!this.particles.has(key)) {
                    const count = Math.max(2, Math.min(5, (edge.thickness || 1) + 1));
                    const parts = [];
                    for (let i = 0; i < count; i++) {
                        parts.push({
                            t: i / count,
                            speed: 0.15 + Math.random() * 0.12,
                            size: 1.5 + Math.random() * 1.5
                        });
                    }
                    this.particles.set(key, parts);
                }
                
                const parts = this.particles.get(key);
                for (let p of parts) {
                    p.t += p.speed * dt;
                    if (p.t > 1) p.t -= 1;
                    if (p.t < 0) p.t += 1;
                }
            }
        }
        
        // Clean up particles for removed edges
        for (let key of this.particles.keys()) {
            if (!activeKeys.has(key)) this.particles.delete(key);
        }
    }

    drawEdgeParticles(p1, cp1, cp2, p2, edgeKey, color, opacity) {
        const parts = this.particles.get(edgeKey);
        if (!parts || opacity < 0.3) return;
        
        const s = this.camera.zoom;
        
        for (let p of parts) {
            const px = this.bezierPoint(p1.x, cp1.x, cp2.x, p2.x, p.t);
            const py = this.bezierPoint(p1.y, cp1.y, cp2.y, p2.y, p.t);
            
            // Glow effect
            this.ctx.save();
            this.ctx.globalAlpha = opacity * 0.8;
            this.ctx.shadowColor = color;
            this.ctx.shadowBlur = 10 * s;
            this.ctx.beginPath();
            this.ctx.arc(px, py, p.size * s, 0, Math.PI * 2);
            this.ctx.fillStyle = color;
            this.ctx.fill();
            
            // Inner bright core
            this.ctx.globalAlpha = opacity;
            this.ctx.shadowBlur = 0;
            this.ctx.beginPath();
            this.ctx.arc(px, py, p.size * 0.5 * s, 0, Math.PI * 2);
            this.ctx.fillStyle = '#ffffff';
            this.ctx.fill();
            this.ctx.restore();
        }
    }

    // =============================================
    // NEON EDGE RENDERING
    // =============================================
    drawNeonEdge(parent, child, edge, isLight, opacity) {
        const { p1, p2, cp1, cp2 } = this.getEdgeEndpoints(parent, child);
        const edgeKey = `${parent.id}_${edge.targetId}`;
        const baseColor = ProjectNode.resolveEdgeColor(edge);

        // Compute alpha string from hex color
        const colorWithAlpha = (hex, alpha) => {
            const r = parseInt(hex.slice(1,3), 16);
            const g = parseInt(hex.slice(3,5), 16);
            const b = parseInt(hex.slice(5,7), 16);
            return `rgba(${r},${g},${b},${alpha})`;
        };

        // Outer glow line
        this.ctx.save();
        this.ctx.globalAlpha = opacity;
        this.ctx.lineWidth = ((edge.thickness || 1) + 4) * this.camera.zoom;
        this.ctx.strokeStyle = colorWithAlpha(baseColor, 0.12);
        this.ctx.beginPath();
        this.ctx.moveTo(p1.x, p1.y);
        this.ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, p2.x, p2.y);
        this.ctx.stroke();

        // Main line
        this.ctx.lineWidth = (edge.thickness || 1) * 1.5 * this.camera.zoom;
        this.ctx.strokeStyle = colorWithAlpha(baseColor, 0.7 * opacity);
        this.ctx.shadowColor = baseColor;
        this.ctx.shadowBlur = 8 * this.camera.zoom;
        this.ctx.beginPath();
        this.ctx.moveTo(p1.x, p1.y);
        this.ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, p2.x, p2.y);
        this.ctx.stroke();
        this.ctx.shadowBlur = 0;
        this.ctx.restore();

        // Particles
        this.drawEdgeParticles(p1, cp1, cp2, p2, edgeKey, baseColor, opacity);

        // Arrowheads (V2.0 - computed from bezier tangent)
        if (edge.direction === "->" || edge.direction === "<->") {
            const tdx = this.bezierTangent(p1.x, cp1.x, cp2.x, p2.x, 0.98);
            const tdy = this.bezierTangent(p1.y, cp1.y, cp2.y, p2.y, 0.98);
            const endAngle = Math.atan2(tdy, tdx);
            this.drawGlowArrowhead(p2.x, p2.y, endAngle, baseColor, opacity);
        }
        if (edge.direction === "<->") {
            const tdx = this.bezierTangent(p1.x, cp1.x, cp2.x, p2.x, 0.02);
            const tdy = this.bezierTangent(p1.y, cp1.y, cp2.y, p2.y, 0.02);
            const startAngle = Math.atan2(-tdy, -tdx); // opposite direction at start
            this.drawGlowArrowhead(p1.x, p1.y, startAngle, baseColor, opacity);
        }

        // Edge label
        if (edge.label && opacity > 0.4) {
            const midT = 0.5;
            const midX = this.bezierPoint(p1.x, cp1.x, cp2.x, p2.x, midT);
            const midY = this.bezierPoint(p1.y, cp1.y, cp2.y, p2.y, midT);
            
            this.ctx.save();
            this.ctx.globalAlpha = opacity;
            this.ctx.font = `600 ${11 * this.camera.zoom}px Inter`;
            const metrics = this.ctx.measureText(edge.label);
            const pad = 6 * this.camera.zoom;
            
            // Glass badge background
            this.ctx.fillStyle = isLight ? 'rgba(255,255,255,0.85)' : 'rgba(15,17,26,0.85)';
            this.ctx.strokeStyle = colorWithAlpha(baseColor, 0.4);
            this.ctx.lineWidth = 1;
            const bw = metrics.width + pad*2;
            const bh = 18 * this.camera.zoom;
            this.ctx.beginPath();
            this.ctx.roundRect(midX - bw/2, midY - bh/2, bw, bh, 4 * this.camera.zoom);
            this.ctx.fill();
            this.ctx.stroke();
            
            this.ctx.fillStyle = baseColor;
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';
            this.ctx.fillText(edge.label, midX, midY);
            this.ctx.restore();
        }
    }

    drawGlowArrowhead(x, y, angle, color, opacity) {
        const s = this.camera.zoom;
        this.ctx.save();
        this.ctx.globalAlpha = opacity;
        this.ctx.translate(x, y);
        this.ctx.rotate(angle);
        
        // Glow
        this.ctx.shadowColor = color;
        this.ctx.shadowBlur = 10 * s;
        
        const tipLen = 8 * s;
        const halfBase = 5 * s;
        
        this.ctx.beginPath();
        this.ctx.moveTo(tipLen, 0);
        this.ctx.lineTo(-halfBase, -halfBase);
        this.ctx.lineTo(-halfBase, halfBase);
        this.ctx.closePath();
        this.ctx.fillStyle = color;
        this.ctx.fill();
        
        this.ctx.shadowBlur = 0;
        this.ctx.restore();
    }

    // =============================================
    // GLASSMORPHISM NODE
    // =============================================
    drawNode(node, isLight, opacity) {
        this.ctx.save();
        this.ctx.globalAlpha = opacity;
        
        let p = this.toScreen(node.x, node.y);
        let w = node.width * this.camera.zoom;
        let h = node.height * this.camera.zoom;
        const isSelected = this.appManager.selectedNodeId === node.id;
        const isHovered = this.hoveredNodeId === node.id;
        const s = this.camera.zoom;

        let actualW = w; let actualH = h; let startX = p.x; let startY = p.y;
        if (node.shape === 'diamond') {
            actualW = w * 1.5;
            actualH = h * 1.5;
            startX = p.x - w*0.25;
            startY = p.y - h*0.25;
        }

        // Status => glow barva
        let glowColor = isLight ? '#3b82f6' : '#00f0ff';
        let statusColor = null;
        if (node.status === 'todo')     statusColor = '#6b7280';
        if (node.status === 'progress') statusColor = '#f59e0b';
        if (node.status === 'done')     statusColor = '#10b981';
        if (node.status === 'blocked')  statusColor = '#ef4444';
        if (statusColor && !isSelected) glowColor = statusColor;

        // Pulsating selected glow
        const pulseIntensity = isSelected ? (12 + Math.sin(this.animTime * 3) * 6) : (isHovered ? 8 : 0);
        
        // Shadow / glow
        this.ctx.shadowColor = isSelected ? glowColor : (isHovered ? (isLight ? '#8b5cf6' : '#9d4edd') : 'rgba(0,0,0,0.4)');
        this.ctx.shadowBlur = isSelected ? pulseIntensity * s : (isHovered ? 10 * s : 5 * s);
        this.ctx.shadowOffsetX = 0;
        this.ctx.shadowOffsetY = isSelected ? 0 : 3 * s;

        // Glassmorphism gradient
        let bgGrad;
        if (node.shape !== 'diamond') {
            bgGrad = this.ctx.createLinearGradient(startX, startY, startX, startY + actualH);
            if (isLight) {
                bgGrad.addColorStop(0, isSelected ? 'rgba(224,231,255,0.92)' : 'rgba(255,255,255,0.88)');
                bgGrad.addColorStop(1, isSelected ? 'rgba(199,210,254,0.85)' : 'rgba(248,250,252,0.82)');
            } else {
                bgGrad.addColorStop(0, isSelected ? 'rgba(30,34,53,0.92)' : 'rgba(25,27,36,0.88)');
                bgGrad.addColorStop(1, isSelected ? 'rgba(26,30,53,0.85)' : 'rgba(18,20,28,0.82)');
            }
        } else {
            bgGrad = isLight ? 'rgba(255,255,255,0.88)' : 'rgba(25,27,36,0.88)';
        }

        this.ctx.fillStyle = bgGrad;
        
        // Shape
        this.ctx.beginPath();
        if (node.shape === 'diamond') {
            this.ctx.moveTo(startX + actualW/2, startY);
            this.ctx.lineTo(startX + actualW, startY + actualH/2);
            this.ctx.lineTo(startX + actualW/2, startY + actualH);
            this.ctx.lineTo(startX, startY + actualH/2);
            this.ctx.closePath();
        } else {
            const radius = 10 * s;
            this.ctx.roundRect(startX, startY, actualW, actualH, radius);
        }
        this.ctx.fill();
        
        // Reset shadow before border
        this.ctx.shadowBlur = 0;
        this.ctx.shadowColor = 'transparent';
        
        // Neon border
        const borderAlpha = isSelected ? (0.7 + Math.sin(this.animTime * 3) * 0.3) : (isHovered ? 0.5 : 0.2);
        let borderColor;
        if (isSelected) {
            borderColor = glowColor;
        } else if (isHovered) {
            borderColor = isLight ? '#8b5cf6' : '#9d4edd';
        } else if (statusColor) {
            borderColor = statusColor;
        } else {
            borderColor = isLight ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.12)';
        }
        
        this.ctx.lineWidth = (isSelected ? 2.5 : 1.5) * s;
        this.ctx.strokeStyle = borderColor;
        this.ctx.globalAlpha = opacity * borderAlpha;
        this.ctx.stroke();
        this.ctx.globalAlpha = opacity;

        // Status stripe (rect only)
        if (node.shape === 'rect' && statusColor) {
            const stripeW = 4 * s;
            const radius = 10 * s;
            this.ctx.save();
            this.ctx.beginPath();
            this.ctx.roundRect(startX, startY, stripeW + radius, actualH, [radius, 0, 0, radius]);
            this.ctx.clip();
            this.ctx.fillStyle = statusColor;
            this.ctx.globalAlpha = opacity * 0.8;
            this.ctx.fillRect(startX, startY, stripeW, actualH);
            this.ctx.restore();
        }

        // ---- TEXT ----
        const textColor = isLight ? '#111827' : '#e2e8f0';
        this.ctx.fillStyle = textColor;
        this.ctx.font = `600 ${14 * s}px Outfit`;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        
        let text = node.title;
        let limit = node.shape === 'diamond' ? 14 : 20;
        if (text.length > limit) text = text.substring(0, limit-2) + '...';
        
        let textY = startY + actualH/2;
        const hasStat = node.statValue !== undefined && node.statValue !== 0;
        if (hasStat) textY -= 8 * s;

        this.ctx.fillText(text, startX + actualW/2, textY);

        // Stat value (neon colored)
        if (hasStat) {
            this.ctx.fillStyle = isLight ? '#3b82f6' : '#00f0ff';
            this.ctx.font = `700 ${13 * s}px Inter`;
            this.ctx.shadowColor = isLight ? '#3b82f6' : '#00f0ff';
            this.ctx.shadowBlur = 6 * s;
            this.ctx.fillText(`${node.statValue}`, startX + actualW/2, textY + 16*s);
            this.ctx.shadowBlur = 0;
        }

        // Note count badge
        if (node.shape === 'rect' && node.notes && node.notes.length > 1) {
            const badgeSize = 16 * s;
            const bx = startX + actualW - badgeSize - 4 * s;
            const by = startY + 4 * s;
            this.ctx.fillStyle = isLight ? 'rgba(59,130,246,0.15)' : 'rgba(0,240,255,0.15)';
            this.ctx.beginPath();
            this.ctx.arc(bx + badgeSize/2, by + badgeSize/2, badgeSize/2, 0, Math.PI*2);
            this.ctx.fill();
            this.ctx.fillStyle = isLight ? '#3b82f6' : '#00f0ff';
            this.ctx.font = `700 ${9 * s}px Inter`;
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';
            this.ctx.fillText(`${node.notes.length}`, bx + badgeSize/2, by + badgeSize/2);
        }

        // Pinned Flag 🚩
        if (node.isPinned) {
            this.ctx.font = `${16 * s}px Inter`;
            this.ctx.textAlign = 'center';
            this.ctx.fillText("🚩", startX + 10*s, startY - 5*s);
        }

        // Node image thumbnail
        if (node.nodeImage && node.shape === 'rect') {
            this.drawNodeThumbnail(node, startX, startY, actualW, actualH, s);
        }

        // Hashtags
        if (node.shape === 'rect' && node.notes && node.notes.length > 0 && node.notes[0].tags && node.notes[0].tags.length > 0) {
            const firstTag = node.notes[0].tags[0];
            this.ctx.fillStyle = isLight ? '#94a3b8' : '#475569';
            this.ctx.font = `500 ${9 * s}px Inter`;
            this.ctx.textAlign = 'left';
            this.ctx.fillText(firstTag, startX + 8*s, startY + actualH - 10*s);
        }

        this.ctx.restore();
    }

    drawNodeThumbnail(node, startX, startY, actualW, actualH, s) {
        if (!this.imageCache.has(node.nodeImage)) {
            const img = new Image();
            img.src = node.nodeImage;
            img.onload = () => { this.imageCache.set(node.nodeImage, img); };
            this.imageCache.set(node.nodeImage, null); // pending
            return;
        }
        const img = this.imageCache.get(node.nodeImage);
        if (!img) return;

        const thumbH = 30 * s;
        const thumbW = 40 * s;
        const tx = startX + actualW - thumbW - 6 * s;
        const ty = startY + actualH - thumbH - 6 * s;
        
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.roundRect(tx, ty, thumbW, thumbH, 4*s);
        this.ctx.clip();
        this.ctx.drawImage(img, tx, ty, thumbW, thumbH);
        this.ctx.restore();
        
        this.ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        this.ctx.roundRect(tx, ty, thumbW, thumbH, 4*s);
        this.ctx.stroke();
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

        // Update particles
        this.updateParticles(dt);

        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.drawGrid();

        const project = this.getProject();
        if (!project) return;

        const isLight = document.body.classList.contains('light-mode');
        
        let influenceChain = null;
        if (this.appManager.selectedNodeId) {
            influenceChain = this.getInfluenceChain(project, this.appManager.selectedNodeId);
        }

        // 1. EDGES
        for (let [id, node] of project.nodes) {
            let edgeOpacity = 1.0;
            if (influenceChain && !influenceChain.has(node.id)) edgeOpacity = 0.12;

            for (let edge of node.edges) {
                const child = project.getNode(edge.targetId);
                if (child) {
                    let cEdgeOpacity = edgeOpacity;
                    if (influenceChain && (!influenceChain.has(child.id) || !influenceChain.has(node.id))) {
                        cEdgeOpacity = 0.12;
                    }
                    this.drawNeonEdge(node, child, edge, isLight, cEdgeOpacity);
                }
            }
        }

        // 2. NODES
        for (let [id, node] of project.nodes) {
            let nodeOpacity = 1.0;
            if (influenceChain && !influenceChain.has(node.id)) nodeOpacity = 0.12;
            this.drawNode(node, isLight, nodeOpacity);
        }
    }

    animate = () => {
        this.draw();
        requestAnimationFrame(this.animate);
    }
}
