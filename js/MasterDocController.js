/**
 * Levý panel — hlavní dokument (HTML sidecar + volitelný náhled PDF).
 */
const MASTER_PANEL_WIDTH_KEY = 'planer_master_panel_width';
const MASTER_PANEL_COLLAPSED_KEY = 'planer_master_panel_collapsed';

export class MasterDocController {
    constructor(appManager) {
        this.appManager = appManager;
        this.panel = document.getElementById('master-doc-panel');
        this.resizer = document.getElementById('master-panel-resizer');
        this.editor = document.getElementById('master-rich-editor');
        this.toolbar = document.getElementById('master-editor-toolbar');
        this.importInput = document.getElementById('master-doc-import-input');
        this.importBtn = document.getElementById('master-doc-import-btn');
        this.nodeLinkBtn = document.getElementById('master-doc-node-link-btn');
        this.pdfToggle = document.getElementById('master-doc-pdf-toggle');
        this.pdfWrap = document.getElementById('master-pdf-preview-wrap');
        this.pdfIframe = document.getElementById('master-pdf-iframe');
        this.toggleHeaderBtn = document.getElementById('master-doc-toggle-btn');
        this.mainContent = document.getElementById('main-content');

        this._loadedProjectId = null;
        this._saveTimer = null;
        this._isResizing = false;

        this._bind();
        this._applyCollapsedFromStorage();
        this._applyWidthFromStorage();
    }

    _sanitize(html) {
        return this.appManager.editor?.sanitizeHtml(html) || '';
    }

    _bind() {
        this.toggleHeaderBtn?.addEventListener('click', () => this.toggleCollapsed());

        this.importBtn?.addEventListener('click', () => this.importInput?.click());
        this.importInput?.addEventListener('change', (e) => this._onImportFile(e));

        this.nodeLinkBtn?.addEventListener('click', () => this._insertNodeLink());

        this.pdfToggle?.addEventListener('click', () => {
            this.pdfWrap?.classList.toggle('hidden');
        });

        this.editor?.addEventListener('input', () => this._scheduleSave());
        this.editor?.addEventListener('click', (e) => {
            const a = e.target.closest('a.master-node-link');
            if (a?.dataset?.nodeId) {
                e.preventDefault();
                this.appManager.selectNode(a.dataset.nodeId);
                this.appManager.getActiveRenderer().draw();
                this.appManager.editor?.showNode(this.appManager.getSelectedNode());
            }
        });

        this.toolbar?.querySelectorAll('[data-master-cmd]').forEach((btn) => {
            btn.addEventListener('click', (ev) => {
                ev.preventDefault();
                const cmd = btn.getAttribute('data-master-cmd');
                this.editor?.focus();
                document.execCommand(cmd, false, null);
                this._scheduleSave();
            });
        });
        const fmt = document.getElementById('master-format-select');
        fmt?.addEventListener('change', (e) => {
            const v = e.target.value;
            this.editor?.focus();
            document.execCommand('formatBlock', false, v);
            e.target.value = 'p';
            this._scheduleSave();
        });

        this.resizer?.addEventListener('mousedown', (e) => {
            e.preventDefault();
            this._isResizing = true;
            this.resizer.classList.add('is-resizing');
            document.body.style.cursor = 'ew-resize';
        });
        window.addEventListener('mousemove', (e) => {
            if (!this._isResizing || !this.panel) return;
            const maxW = Math.floor(window.innerWidth * 0.65);
            const w = Math.min(maxW, Math.max(260, e.clientX));
            this.panel.style.width = `${w}px`;
            this.appManager.canvasRenderer.resize();
            this.appManager.simRenderer.resize();
        });
        window.addEventListener('mouseup', () => {
            if (!this._isResizing) return;
            this._isResizing = false;
            this.resizer?.classList.remove('is-resizing');
            document.body.style.cursor = 'default';
            const w = parseInt(this.panel?.style.width, 10);
            if (w) localStorage.setItem(MASTER_PANEL_WIDTH_KEY, String(w));
        });
    }

    _applyWidthFromStorage() {
        const w = parseInt(localStorage.getItem(MASTER_PANEL_WIDTH_KEY) || '', 10);
        const maxW = Math.floor(window.innerWidth * 0.65);
        if (this.panel && w >= 260 && w <= maxW) {
            this.panel.style.width = `${w}px`;
        }
    }

    _applyCollapsedFromStorage() {
        const c = localStorage.getItem(MASTER_PANEL_COLLAPSED_KEY) === '1';
        this.mainContent?.classList.toggle('master-doc-collapsed', c);
        if (this.toggleHeaderBtn) {
            this.toggleHeaderBtn.classList.toggle('active', !c);
        }
    }

    toggleCollapsed() {
        const next = !this.mainContent?.classList.contains('master-doc-collapsed');
        this.mainContent?.classList.toggle('master-doc-collapsed', next);
        localStorage.setItem(MASTER_PANEL_COLLAPSED_KEY, next ? '1' : '0');
        this.toggleHeaderBtn?.classList.toggle('active', !next);
        requestAnimationFrame(() => {
            this.appManager.canvasRenderer.resize();
            this.appManager.simRenderer.resize();
        });
    }

    _insertNodeLink() {
        const node = this.appManager.getSelectedNode();
        if (!node) {
            this.appManager.toast?.info('Nejdřív vyber uzel na plátně.');
            return;
        }
        const label = (node.title || 'Uzel').replace(/</g, '');
        const id = node.id.replace(/"/g, '');
        const html = `<a href="#" class="master-node-link" data-node-id="${id}">${label}</a>&nbsp;`;
        this.editor?.focus();
        document.execCommand('insertHTML', false, html);
        this._scheduleSave();
    }

    _scheduleSave() {
        if (!this._loadedProjectId) return;
        if (this._saveTimer) clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(() => this._saveNow(), 1200);
    }

    async _saveToProjectId(pid) {
        if (!pid || !this.editor) return;
        if (!this.appManager.projects.has(pid)) return;
        const html = this._sanitize(this.editor.innerHTML);
        try {
            const res = await fetch('/api/save-master', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: pid, html }),
            });
            if (!res.ok) {
                const msg = res.status === 413
                    ? 'Dokument je příliš velký.'
                    : res.status === 400
                        ? 'Neplatná data při ukládání dokumentu.'
                        : 'Uložení hlavního dokumentu selhalo.';
                this.appManager.toast?.error(msg);
                throw new Error(String(res.status));
            }
            const proj = this.appManager.projects.get(pid);
            if (proj?.masterDocument) {
                proj.masterDocument.updatedAt = new Date().toISOString();
            }
        } catch (err) {
            console.error('save-master', err);
            this.appManager.toast?.error('Uložení hlavního dokumentu selhalo.');
        }
    }

    async _saveNow() {
        await this._saveToProjectId(this._loadedProjectId);
    }

    async flush() {
        if (this._saveTimer) {
            clearTimeout(this._saveTimer);
            this._saveTimer = null;
        }
        await this._saveNow();
    }

    async prepareProjectSwitch() {
        if (this._saveTimer) {
            clearTimeout(this._saveTimer);
            this._saveTimer = null;
        }
        const pid = this._loadedProjectId;
        if (pid && this.appManager.projects.has(pid)) {
            await this._saveToProjectId(pid);
        }
        this._loadedProjectId = null;
    }

    _updatePdfUi(proj) {
        const url = proj?.masterDocument?.pdfPreviewUrl;
        if (url && this.pdfIframe && this.pdfWrap && this.pdfToggle) {
            this.pdfIframe.src = url;
            this.pdfWrap.classList.remove('hidden');
            this.pdfToggle.classList.remove('hidden');
        } else {
            if (this.pdfIframe) this.pdfIframe.src = 'about:blank';
            this.pdfWrap?.classList.add('hidden');
            this.pdfToggle?.classList.add('hidden');
        }
    }

    async loadForProject(proj) {
        if (!proj || !this.editor) return;
        this._loadedProjectId = proj.id;
        this._updatePdfUi(proj);

        try {
            const res = await fetch(`/api/master-doc?id=${encodeURIComponent(proj.id)}`);
            if (res.ok) {
                const text = await res.text();
                this.editor.innerHTML = this._sanitize(text) || '';
            } else {
                this.editor.innerHTML = '';
            }
        } catch (e) {
            console.error('load master-doc', e);
            this.editor.innerHTML = '';
        }
    }

    async _onImportFile(e) {
        const file = e.target.files?.[0];
        e.target.value = '';
        const proj = this.appManager.currentProject;
        if (!file || !proj) return;

        const reader = new FileReader();
        reader.onload = async () => {
            try {
                const res = await fetch('/api/import-master', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        id: proj.id,
                        filename: file.name,
                        base64: reader.result,
                    }),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) {
                    const msg = res.status === 413
                        ? 'Soubor je příliš velký (limit serveru).'
                        : res.status === 400
                            ? 'Neplatný soubor pro import.'
                            : (data?.message || 'Import selhal.');
                    this.appManager.toast?.error(msg);
                    return;
                }
                proj.masterDocument = proj.masterDocument || {};
                proj.masterDocument.sourceType = data.sourceType || null;
                proj.masterDocument.sourceFileName = data.sourceFileName || file.name;
                proj.masterDocument.pdfPreviewUrl = data.pdfPreviewUrl || null;
                proj.masterDocument.updatedAt = new Date().toISOString();

                this._updatePdfUi(proj);
                if (this.editor) {
                    this.editor.innerHTML = this._sanitize(data.html || '');
                }
                await this._saveNow();
                this.appManager.saveToAPI();
                this.appManager.toast?.success('Hlavní dokument naimportován.');
            } catch (err) {
                console.error(err);
                this.appManager.toast?.error('Import selhal.');
            }
        };
        reader.readAsDataURL(file);
    }
}
