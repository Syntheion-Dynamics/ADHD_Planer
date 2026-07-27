// V4.1 — TimelineRenderer: Vizuální časová osa pro Data mód
export class TimelineRenderer {
    constructor(canvasId, appManager) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
        this.appManager = appManager;

        // Interakce
        this.hoveredEventNodeId = null;
        this.isPanning = false;
        this.panStartX = 0;
        this.panOffsetX = 0; // Extra pan offset v pixelech

        if (this.canvas) {
            this.setupEvents();
        }
    }

    getTimeline() {
        return this.appManager.currentProject?.timeline || null;
    }

    uiFontFamily() {
        const Ctor = this.appManager.constructor;
        return typeof Ctor.fontForCanvas === 'function'
            ? Ctor.fontForCanvas(this.appManager.appSettings?.uiFont)
            : 'Inter';
    }

    // Převod roku na pixel X pozici na canvasu
    yearToX(year) {
        const tl = this.getTimeline();
        if (!tl) return 0;
        const pad = 60;
        const usableW = this.canvas.width - pad * 2;
        const span = tl.endYear - tl.startYear || 1;
        return pad + ((year - tl.startYear) / span) * usableW + this.panOffsetX;
    }

    // Převod pixel X pozice na rok
    xToYear(x) {
        const tl = this.getTimeline();
        if (!tl) return 0;
        const pad = 60;
        const usableW = this.canvas.width - pad * 2;
        const span = tl.endYear - tl.startYear || 1;
        return tl.startYear + ((x - pad - this.panOffsetX) / usableW) * span;
    }

    // Vrátí node id eventu na dané pixel pozici (pro hover/click)
    getEventAt(x, y) {
        const project = this.appManager.currentProject;
        if (!project) return null;
        const cy = this.canvas.height / 2;
        for (let [id, node] of project.nodes) {
            if (!node.timelineDate) continue;
            const year = parseInt(node.timelineDate);
            if (isNaN(year)) continue;
            const ex = this.yearToX(year);
            const dist = Math.sqrt((x - ex) ** 2 + (y - cy) ** 2);
            if (dist < 14) return node;
        }
        return null;
    }

    setupEvents() {
        this.canvas.addEventListener('mousemove', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;

            if (this.isPanning) {
                this.panOffsetX += mx - this.panStartX;
                this.panStartX = mx;
                this.draw();
                return;
            }

            const node = this.getEventAt(mx, my);
            const prevHovered = this.hoveredEventNodeId;
            this.hoveredEventNodeId = node ? node.id : null;
            this.canvas.style.cursor = node ? 'pointer' : 'default';
            if (prevHovered !== this.hoveredEventNodeId) this.draw();
        });

        this.canvas.addEventListener('mousedown', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;

            const node = this.getEventAt(mx, my);
            if (node) {
                // Vybrat uzel v hlavní canvas a zaměřit na něj
                this.appManager.selectNode(node.id);
                const renderer = this.appManager.canvasRenderer;
                const cx = node.x + node.width / 2;
                const cy = node.y + node.height / 2;
                renderer.camera.x = -cx + (renderer.canvas.width / 2) / renderer.camera.zoom;
                renderer.camera.y = -cy + (renderer.canvas.height / 2) / renderer.camera.zoom;
                renderer.draw();
            } else {
                this.isPanning = true;
                this.panStartX = mx;
            }
        });

        window.addEventListener('mouseup', () => {
            this.isPanning = false;
        });

        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            this.panOffsetX -= e.deltaX * 0.5;
            this.panOffsetX -= e.deltaY * 0.5;
            this.draw();
        }, { passive: false });

        window.addEventListener('resize', () => this.resize());
    }

    resize() {
        if (!this.canvas) return;
        const panel = document.getElementById('timeline-panel');
        if (!panel) return;
        this.canvas.width = panel.clientWidth;
        this.canvas.height = panel.clientHeight - 36; // minus header
    }

    draw() {
        if (!this.canvas || !this.ctx) return;
        const project = this.appManager.currentProject;
        const tl = this.getTimeline();
        if (!project || !tl || !tl.enabled) return;

        const isLight = document.body.classList.contains('light-mode');
        const W = this.canvas.width;
        const H = this.canvas.height;
        const cy = H / 2;

        this.ctx.clearRect(0, 0, W, H);

        // Pozadí
        this.ctx.fillStyle = isLight ? 'rgba(248,250,252,0.95)' : 'rgba(13,15,23,0.95)';
        this.ctx.fillRect(0, 0, W, H);

        // Osa
        const axisY = cy;
        this.ctx.strokeStyle = isLight ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.15)';
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.moveTo(40, axisY);
        this.ctx.lineTo(W - 40, axisY);
        this.ctx.stroke();

        // Tick marks a popisky dle granularity
        this.drawTicks(isLight, axisY);

        // Dnešní datum marker
        const currentYear = new Date().getFullYear();
        if (currentYear >= tl.startYear && currentYear <= tl.endYear) {
            const todayX = this.yearToX(currentYear);
            this.ctx.strokeStyle = '#ef4444';
            this.ctx.lineWidth = 1.5;
            this.ctx.setLineDash([4, 4]);
            this.ctx.beginPath();
            this.ctx.moveTo(todayX, axisY - 30);
            this.ctx.lineTo(todayX, axisY + 30);
            this.ctx.stroke();
            this.ctx.setLineDash([]);
            this.ctx.fillStyle = '#ef4444';
            this.ctx.font = `700 9px ${this.uiFontFamily()}`;
            this.ctx.textAlign = 'center';
            this.ctx.fillText('DNES', todayX, axisY - 34);
        }

        // Eventy (uzly s timelineDate)
        for (let [id, node] of project.nodes) {
            if (!node.timelineDate) continue;
            const year = parseInt(node.timelineDate);
            if (isNaN(year)) continue;

            const ex = this.yearToX(year);
            const isSelected = this.appManager.selectedNodeIds.has(node.id);
            const isHovered = this.hoveredEventNodeId === node.id;

            // Vertikální linka od osy k bodu (alternující nahoru/dolů pro overlapy)
            const isAbove = this._shouldBeAbove(node, year, project);
            const lineEndY = isAbove ? axisY - 28 : axisY + 28;
            const labelY = isAbove ? axisY - 54 : axisY + 50;

            this.ctx.strokeStyle = node.color || (isLight ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.2)');
            this.ctx.lineWidth = 1.5;
            this.ctx.beginPath();
            this.ctx.moveTo(ex, axisY);
            this.ctx.lineTo(ex, lineEndY);
            this.ctx.stroke();

            // Kruh
            const r = isSelected ? 10 : isHovered ? 9 : 7;
            const nodeColor = node.color || (isLight ? '#3b82f6' : '#00f0ff');
            this.ctx.beginPath();
            this.ctx.arc(ex, lineEndY, r, 0, Math.PI * 2);
            this.ctx.fillStyle = nodeColor + (isSelected ? 'ff' : isHovered ? 'dd' : '99');
            this.ctx.fill();
            this.ctx.strokeStyle = nodeColor;
            this.ctx.lineWidth = isSelected ? 3 : 1.5;
            this.ctx.stroke();

            if (isSelected) {
                this.ctx.shadowColor = nodeColor;
                this.ctx.shadowBlur = 12;
                this.ctx.stroke();
                this.ctx.shadowBlur = 0;
            }

            // Popisek
            this.ctx.fillStyle = isLight ? '#111827' : '#e2e8f0';
            this.ctx.font = `${isSelected ? '700' : '500'} 11px ${this.uiFontFamily()}`;
            this.ctx.textAlign = 'center';
            const label = node.title.length > 16 ? node.title.substring(0, 14) + '…' : node.title;
            this.ctx.fillText(label, ex, labelY);

            // Rok pod/nad popiskem
            this.ctx.fillStyle = isLight ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.4)';
            this.ctx.font = `500 9px ${this.uiFontFamily()}`;
            this.ctx.fillText(String(year), ex, isAbove ? labelY + 14 : labelY - 14);
        }
    }

    // Střídání uzlů nad/pod osou aby se nepřekrývaly
    _shouldBeAbove(node, year, project) {
        let index = 0;
        for (let [id, n] of project.nodes) {
            if (!n.timelineDate) continue;
            if (n.id === node.id) break;
            index++;
        }
        return index % 2 === 0;
    }

    drawTicks(isLight, axisY) {
        const tl = this.getTimeline();
        const W = this.canvas.width;
        let step = 1;

        if (tl.granularity === 'decades') step = 10;
        else if (tl.granularity === 'centuries') step = 100;

        // Zaokrouhlit start na nejbližší step
        const firstTick = Math.ceil(tl.startYear / step) * step;

        this.ctx.textAlign = 'center';
        this.ctx.fillStyle = isLight ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.5)';
        this.ctx.strokeStyle = isLight ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.15)';
        this.ctx.font = `500 10px ${this.uiFontFamily()}`;

        for (let y = firstTick; y <= tl.endYear; y += step) {
            const x = this.yearToX(y);
            if (x < 30 || x > W - 30) continue;

            this.ctx.lineWidth = 1;
            this.ctx.beginPath();
            this.ctx.moveTo(x, axisY - 6);
            this.ctx.lineTo(x, axisY + 6);
            this.ctx.stroke();

            this.ctx.fillText(String(y), x, axisY + 18);
        }
    }
}
