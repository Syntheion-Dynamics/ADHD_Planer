import { EDGE_COLORS, ProjectNode } from './ProjectNode.js';

export class EditorController {
    constructor(appManager) {
        this.appManager = appManager;
        
        this.overlay = document.getElementById('no-node-overlay');
        this.titleInput = document.getElementById('node-title-input');
        
        this.notesListContainer = document.getElementById('notes-list');
        this.addNoteBtn = document.getElementById('add-note-btn');
        this.notesModeBtn = document.getElementById('notes-mode-btn');
        this.notebookModeBtn = document.getElementById('notebook-mode-btn');
        this.notesSectionTitle = document.getElementById('notes-section-title');
        
        this.richEditor = document.getElementById('rich-editor');
        this.deleteNodeBtn = document.getElementById('delete-node-btn');
        this.addChildBtn = document.getElementById('add-child-btn');
        this.toggleShapeBtn = document.getElementById('toggle-shape-btn');
        
        this.imageUploadBtn = document.getElementById('image-upload-btn');
        this.imageFileInput = document.getElementById('image-file-input');
        
        this.propModal = document.getElementById('properties-modal');
        this.propCloseBtn = document.getElementById('prop-close-btn');
        this.propTitleInput = document.getElementById('prop-title-input');
        this.propTagsInput = document.getElementById('prop-tags-input');
        this.propCreatedSpan = document.getElementById('prop-created-span');
        this.propUpdatedSpan = document.getElementById('prop-updated-span');
        
        // V1.3 UI Prvky
        this.statusSelect = document.getElementById('node-status-select');
        this.statInput = document.getElementById('node-stat-input');
        this.widthInput = document.getElementById('node-width-input');
        this.heightInput = document.getElementById('node-height-input');
        this.fontSizeInput = document.getElementById('node-font-size-input');
        this.pinBtn = document.getElementById('node-pin-btn');
        this.connectBtn = document.getElementById('connect-node-btn');
        this.edgesContainer = document.getElementById('edges-container');
        this.edgesList = document.getElementById('edges-list');

        // V2.0 — Node image
        this.nodeImageBtn = document.getElementById('node-image-btn');
        this.nodeImageInput = document.getElementById('node-image-input');

        this.currentNodeNode = null;
        this.activeNoteId = null;
        this.activeNotebookPageId = null;
        this.editingPropNoteId = null;
        this.editorMode = 'node'; // 'node' | 'notebook'

        this.setupEventListeners();
        this.setupToolbar();
    }

    setupEventListeners() {
        this.titleInput.addEventListener('input', (e) => {
            if (this.currentNodeNode) {
                this.currentNodeNode.title = e.target.value;
                this.currentNodeNode.lastEditedAt = Date.now(); // Heatmap tracking
                this.appManager.getActiveRenderer().draw();
            }
        });

        this.richEditor.addEventListener('input', () => {
            if (this.editorMode === 'notebook') {
                const page = this.getActiveNotebookPage();
                if (page) {
                    page.content = this.sanitizeHtml(this.richEditor.innerHTML);
                    page.updatedAt = new Date().toISOString();
                }
                return;
            }
            if (this.currentNodeNode?.shape === 'sticky') {
                this.currentNodeNode.stickyText = this.sanitizeHtml(this.richEditor.innerHTML);
                this.currentNodeNode.lastEditedAt = Date.now();
                this.appManager.getActiveRenderer().draw();
                return;
            }
            if (this.currentNodeNode && this.activeNoteId) {
                const note = this.currentNodeNode.notes.find(n => n.id === this.activeNoteId);
                if (note) {
                    note.content = this.sanitizeHtml(this.richEditor.innerHTML);
                    note.updatedAt = new Date().toISOString();
                    this.currentNodeNode.lastEditedAt = Date.now(); // Heatmap tracking
                }
            }
        });

        this.addNoteBtn.addEventListener('click', () => {
            if (this.editorMode === 'notebook') {
                this.addNotebookPage();
                return;
            }
            if (this.currentNodeNode) {
                const newNote = this.currentNodeNode.addNote();
                this.activeNoteId = newNote.id;
                this.renderNotesList();
            }
        });

        this.deleteNodeBtn.addEventListener('click', () => {
            if (this.currentNodeNode) {
                this.appManager.pushHistory();
                this.appManager.currentProject.deleteNode(this.currentNodeNode.id);
                this.appManager.selectNode(null); 
            }
        });

        this.addChildBtn.addEventListener('click', () => {
            if (this.currentNodeNode) {
                this.appManager.pushHistory();
                const child = this.appManager.currentProject.addNode(
                    "Nový uzel", 
                    this.currentNodeNode.x, 
                    this.currentNodeNode.y + 120
                );
                this.currentNodeNode.addEdge(child.id);
                this.appManager.selectNode(child.id);
            }
        });

        this.toggleShapeBtn.addEventListener('click', () => {
            if (this.currentNodeNode) {
                this.appManager.pushHistory();
                const shapes = ['rect', 'diamond', 'circle', 'trapezoid', 'cylinder'];
                let idx = shapes.indexOf(this.currentNodeNode.shape);
                if (idx === -1) idx = 0;
                this.currentNodeNode.shape = shapes[(idx + 1) % shapes.length];
                this.appManager.getActiveRenderer().draw();
            }
        });
        
        // V1.3 - Status, Pin, Values
        this.statusSelect.addEventListener('change', (e) => {
            if (this.currentNodeNode) {
                this.currentNodeNode.status = e.target.value;
                this.appManager.getActiveRenderer().draw();
            }
        });

        this.statInput.addEventListener('input', (e) => {
            if (this.currentNodeNode) {
                this.currentNodeNode.statValue = parseFloat(e.target.value) || 0;
                this.appManager.getActiveRenderer().draw();
            }
        });

        if (this.widthInput) {
            this.widthInput.addEventListener('change', (e) => {
                if (this.currentNodeNode) {
                    this.appManager.pushHistory();
                    this.currentNodeNode.width = parseInt(e.target.value) || 10;
                    this.appManager.getActiveRenderer().draw();
                }
            });
        }

        if (this.heightInput) {
            this.heightInput.addEventListener('change', (e) => {
                if (this.currentNodeNode) {
                    this.appManager.pushHistory();
                    this.currentNodeNode.height = parseInt(e.target.value) || 10;
                    this.appManager.getActiveRenderer().draw();
                }
            });
        }

        if (this.fontSizeInput) {
            this.fontSizeInput.addEventListener('change', (e) => {
                if (this.currentNodeNode) {
                    this.appManager.pushHistory();
                    const val = parseInt(e.target.value);
                    this.currentNodeNode.labelFontSize = Math.min(32, Math.max(8, val || 14));
                    this.appManager.getActiveRenderer().draw();
                }
            });
        }

        this.pinBtn.addEventListener('click', () => {
            if (this.currentNodeNode) {
                this.currentNodeNode.isPinned = !this.currentNodeNode.isPinned;
                this.showNode(this.currentNodeNode);
                this.appManager.getActiveRenderer().draw();
            }
        });

        const stickyBg = document.getElementById('sticky-bg-color');
        const stickyTxt = document.getElementById('sticky-text-color');
        const stickyReset = document.getElementById('sticky-colors-reset');
        const syncStickyOverlayIfEditing = () => {
            const n = this.currentNodeNode;
            if (!n || n.shape !== 'sticky') return;
            const overlay = document.getElementById('sticky-inline-edit');
            if (overlay && this.appManager.canvasRenderer?.getStickyEditingNodeId?.() === n.id) {
                this.appManager.canvasRenderer.applyStickyOverlayTheme(n, overlay);
            }
        };
        stickyBg?.addEventListener('input', () => {
            if (this.currentNodeNode?.shape !== 'sticky') return;
            this.currentNodeNode.stickyBgColor = stickyBg.value;
            this.currentNodeNode.lastEditedAt = Date.now();
            syncStickyOverlayIfEditing();
            this.appManager.getActiveRenderer().draw();
        });
        stickyTxt?.addEventListener('input', () => {
            if (this.currentNodeNode?.shape !== 'sticky') return;
            this.currentNodeNode.stickyTextColor = stickyTxt.value;
            this.currentNodeNode.lastEditedAt = Date.now();
            syncStickyOverlayIfEditing();
            this.appManager.getActiveRenderer().draw();
        });
        stickyReset?.addEventListener('click', () => {
            if (this.currentNodeNode?.shape !== 'sticky') return;
            this.appManager.pushHistory();
            this.currentNodeNode.stickyBgColor = null;
            this.currentNodeNode.stickyTextColor = null;
            this.currentNodeNode.lastEditedAt = Date.now();
            this.syncStickyAppearanceControls();
            syncStickyOverlayIfEditing();
            this.appManager.getActiveRenderer().draw();
        });

        this.connectBtn.addEventListener('click', () => {
            if (this.currentNodeNode) {
                this.appManager.isConnecting = true;
                document.getElementById('connect-overlay').classList.remove('hidden');
            }
        });

        this.notesModeBtn?.addEventListener('click', () => this.setEditorMode('node'));
        this.notebookModeBtn?.addEventListener('click', () => this.setEditorMode('notebook'));

        // V2.0 — Node image upload (simulace)
        if (this.nodeImageBtn && this.nodeImageInput) {
            this.nodeImageBtn.addEventListener('click', () => this.nodeImageInput.click());
            this.nodeImageInput.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (!file || !this.currentNodeNode) return;
                const reader = new FileReader();
                reader.onload = async (ev) => {
                    try {
                        const res = await fetch('/api/upload-image', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ filename: file.name, base64: ev.target.result })
                        });
                        let data = {};
                        try { data = await res.json(); } catch (_) { /* ignore */ }
                        if (res.ok && data.url) {
                            this.currentNodeNode.nodeImage = data.url;
                            this.showNode(this.currentNodeNode);
                            this.appManager.getActiveRenderer().draw();
                            if (this.appManager.toast) this.appManager.toast.success('Obrázek uzlu nastaven!');
                        } else if (this.appManager.toast) {
                            const msg = res.status === 413
                                ? 'Soubor je příliš velký — zmenši obrázek nebo rozlišení.'
                                : 'Nepodařilo se nahrát obrázek.';
                            this.appManager.toast.error(msg);
                        }
                    } catch (err) {
                        console.error(err);
                        if (this.appManager.toast) this.appManager.toast.error('Nepodařilo se nahrát obrázek.');
                    }
                };
                reader.readAsDataURL(file);
                e.target.value = '';
            });
        }

        // -------------------------

        this.imageUploadBtn.addEventListener('click', () => this.imageFileInput.click());
        this.imageFileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = async (ev) => {
                const base64 = ev.target.result;
                try {
                    const res = await fetch('/api/upload-image', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ filename: file.name, base64: base64 })
                    });
                    let data = {};
                    try { data = await res.json(); } catch (_) { /* ignore */ }
                    if (res.ok && data.url) {
                        this.richEditor.focus();
                        document.execCommand('insertImage', false, data.url);
                        
                        if (this.currentNodeNode?.shape === 'sticky') {
                            this.currentNodeNode.stickyText = this.sanitizeHtml(this.richEditor.innerHTML);
                            this.currentNodeNode.lastEditedAt = Date.now();
                            this.appManager.getActiveRenderer().draw();
                        } else if (this.currentNodeNode && this.activeNoteId) {
                            const note = this.currentNodeNode.notes.find(n => n.id === this.activeNoteId);
                            if (note) note.updatedAt = new Date().toISOString();
                        }
                    } else if (this.appManager.toast) {
                        const msg = res.status === 413
                            ? 'Soubor je příliš velký — zmenši obrázek nebo rozlišení.'
                            : 'Nepodařilo se nahrát obrázek.';
                        this.appManager.toast.error(msg);
                    }
                } catch (err) {
                    console.error(err);
                }
            };
            reader.readAsDataURL(file);
        });

        this.propCloseBtn.addEventListener('click', () => this.closePropertiesModal());
        
        this.propTitleInput.addEventListener('input', (e) => {
            if (this.editingPropNoteId && this.currentNodeNode) {
                const note = this.currentNodeNode.notes.find(n => n.id === this.editingPropNoteId);
                if (note) {
                    note.title = e.target.value;
                    note.updatedAt = new Date().toISOString();
                    this.renderNotesList();
                }
            }
        });
        
        this.propTagsInput.addEventListener('input', (e) => {
            if (this.editingPropNoteId && this.currentNodeNode) {
                const note = this.currentNodeNode.notes.find(n => n.id === this.editingPropNoteId);
                if (note) {
                    note.tags = e.target.value.split(" ").map(t => t.trim()).filter(t => t.length > 0);
                    note.updatedAt = new Date().toISOString();
                    this.appManager.getActiveRenderer().draw();
                }
            }
        });

        const quickTagsDiv = document.getElementById('prop-quick-tags');
        if (quickTagsDiv) {
            quickTagsDiv.addEventListener('click', (e) => {
                if (e.target.tagName === 'BUTTON') {
                    const tag = e.target.getAttribute('data-tag');
                    if (tag && this.editingPropNoteId && this.currentNodeNode) {
                        const note = this.currentNodeNode.notes.find(n => n.id === this.editingPropNoteId);
                        if (note) {
                            if (!note.tags) note.tags = [];
                            if (!note.tags.includes(tag)) {
                                note.tags.push(tag);
                                this.propTagsInput.value = note.tags.join(" ");
                                note.updatedAt = new Date().toISOString();
                                this.appManager.getActiveRenderer().draw();
                            }
                        }
                    }
                }
            });
        }
    }

    setupToolbar() {
        const buttons = document.querySelectorAll('.format-btn:not(#image-upload-btn)');
        buttons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const cmd = btn.getAttribute('data-cmd');
                document.execCommand(cmd, false, null);
                this.richEditor.focus();
                if (this.currentNodeNode?.shape === 'sticky') {
                    this.currentNodeNode.stickyText = this.sanitizeHtml(this.richEditor.innerHTML);
                    this.currentNodeNode.lastEditedAt = Date.now();
                    this.appManager.getActiveRenderer().draw();
                }
            });
        });

        const select = document.getElementById('format-select');
        select.addEventListener('change', (e) => {
            e.preventDefault();
            const format = e.target.value;
            document.execCommand('formatBlock', false, format);
            select.value = 'p'; 
            this.richEditor.focus();
            if (this.currentNodeNode?.shape === 'sticky') {
                this.currentNodeNode.stickyText = this.sanitizeHtml(this.richEditor.innerHTML);
                this.currentNodeNode.lastEditedAt = Date.now();
                this.appManager.getActiveRenderer().draw();
            }
        });
    }

    renderCurrentNode() {
        this.showNode(this.currentNodeNode);
    }

    getStickyThemeDefaults() {
        const light = document.body.classList.contains('light-mode');
        return {
            bg: light ? '#fef3c7' : '#3a2f14',
            text: light ? '#422006' : '#fef3c7',
        };
    }

    syncStickyAppearanceControls() {
        const row = document.getElementById('sticky-appearance-row');
        const bgInput = document.getElementById('sticky-bg-color');
        const txtInput = document.getElementById('sticky-text-color');
        if (!row) return;
        const show = this.currentNodeNode?.shape === 'sticky' && this.editorMode === 'node';
        if (!show) {
            row.classList.add('hidden');
            return;
        }
        row.classList.remove('hidden');
        const { bg, text } = this.getStickyThemeDefaults();
        if (bgInput) bgInput.value = this.currentNodeNode.stickyBgColor || bg;
        if (txtInput) txtInput.value = this.currentNodeNode.stickyTextColor || text;
    }

    showNode(node) {
        this.currentNodeNode = node;
        this.setModeButtonState();
        if (this.editorMode === 'notebook') {
            this.overlay.classList.add('hidden');
            this.renderNotesList();
            this.syncStickyAppearanceControls();
            return;
        }
        if (!node) {
            this.overlay.classList.remove('hidden');
            this.notesListContainer.innerHTML = '';
            this.notesListContainer.parentElement?.classList.remove('sticky-mode');
            this.addNoteBtn.classList.remove('hidden');
            document.getElementById('sticky-created-hint')?.classList.add('hidden');
            this.titleInput.placeholder = 'Název uzlu...';
            this.richEditor.innerHTML = '';
            this.edgesList.innerHTML = '';
            this.syncStickyAppearanceControls();
            return;
        }

        this.overlay.classList.add('hidden');
        this.titleInput.value = node.title;
        const stickyHint = document.getElementById('sticky-created-hint');
        const notesSection = this.notesListContainer.parentElement;

        if (node.shape === 'sticky' && this.editorMode === 'node') {
            notesSection?.classList.add('sticky-mode');
            this.addNoteBtn.classList.add('hidden');
            this.notesSectionTitle.textContent = 'Sticky poznámka';
            this.titleInput.placeholder = 'Titulek — orientace na plátně…';
            if (stickyHint) {
                stickyHint.classList.remove('hidden');
                if (node.stickyCreatedAt) {
                    try {
                        stickyHint.textContent = 'Vytvořeno: ' + new Date(node.stickyCreatedAt).toLocaleString('cs-CZ');
                    } catch (_) {
                        stickyHint.textContent = '';
                    }
                } else stickyHint.textContent = '';
            }
            if (this.fontSizeInput) this.fontSizeInput.style.visibility = 'hidden';
        } else {
            notesSection?.classList.remove('sticky-mode');
            this.addNoteBtn.classList.remove('hidden');
            if (this.editorMode === 'node') {
                this.notesSectionTitle.textContent = 'Poznámky';
            }
            this.titleInput.placeholder = 'Název uzlu...';
            stickyHint?.classList.add('hidden');
            if (this.fontSizeInput) this.fontSizeInput.style.visibility = '';
        }
        
        // V1.3 UI Update
        this.statusSelect.value = node.status || 'none';
        this.statInput.value = node.statValue || '';
        if (this.widthInput) this.widthInput.value = Math.round(node.width);
        if (this.heightInput) this.heightInput.value = Math.round(node.height);
        if (this.fontSizeInput) this.fontSizeInput.value = node.labelFontSize || 14;
        this.pinBtn.style.color = node.isPinned ? '#ef4444' : 'var(--text-muted)';
        this.pinBtn.style.background = node.isPinned ? 'rgba(239, 68, 68, 0.2)' : 'transparent';

        // V2.0 — Node image preview
        const imgPreview = document.getElementById('node-image-preview');
        if (imgPreview) {
            if (node.nodeImage) {
                imgPreview.src = node.nodeImage;
                imgPreview.style.display = 'block';
            } else {
                imgPreview.style.display = 'none';
            }
        }

        const projMode = this.appManager.currentProject.mode;
        if (projMode === 'simulation') {
            this.statInput.classList.remove('hidden');
            this.connectBtn.classList.remove('hidden');
            this.edgesContainer.classList.remove('hidden');
            if (this.nodeImageBtn) this.nodeImageBtn.style.display = '';
            this.renderEdgesList();
        } else {
            this.statInput.classList.add('hidden');
            this.connectBtn.classList.remove('hidden'); // V2.0: connect available in both modes
            this.edgesContainer.classList.add('hidden');
            if (this.nodeImageBtn) this.nodeImageBtn.style.display = 'none';
        }
        
        if (node.shape === 'sticky' && this.editorMode === 'node') {
            const overlay = document.getElementById('sticky-inline-edit');
            const editingHere = this.appManager.canvasRenderer?.getStickyEditingNodeId?.() === node.id
                && overlay && document.activeElement === overlay;
            if (!editingHere) {
                const html = this.sanitizeHtml(node.stickyText || '');
                if (this.richEditor.innerHTML !== html) {
                    this.richEditor.innerHTML = html || '';
                }
            }
            this.syncStickyAppearanceControls();
            return;
        }

        if (!node.notes || node.notes.length === 0) node.addNote();
        
        const exists = node.notes.find(n => n.id === this.activeNoteId);
        if (!exists) this.activeNoteId = node.notes[0].id;

        this.renderNotesList();
        this.syncStickyAppearanceControls();
    }

    renderEdgesList() {
        if (!this.currentNodeNode) return;
        this.edgesList.innerHTML = '';
        
        if (this.currentNodeNode.edges.length === 0) {
            this.edgesList.innerHTML = '<span style="color:var(--text-muted); font-size: 0.8rem; padding: 5px;">Žádné odchozí vazby...</span>';
            return;
        }

        const project = this.appManager.currentProject;

        for (let edge of this.currentNodeNode.edges) {
            const targetNode = project.getNode(edge.targetId);
            if (!targetNode) continue;

            const div = document.createElement('div');
            div.className = 'edge-item';

            // Generate color options
            let colorOptions = '';
            for (let [key, val] of Object.entries(EDGE_COLORS)) {
                colorOptions += `<option value="${key}" ${edge.color === key ? 'selected' : ''}>${val.labelShort}</option>`;
            }

            const showPicker = edge.color === 'custom1' || edge.color === 'custom2';

            div.innerHTML = `
                <div style="font-size:0.85rem; font-family:'Outfit'; color:var(--text-main); width: 80px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${targetNode.title}">
                    To: ${targetNode.title}
                </div>
                
                <select class="edge-dir-select" title="Směrnice šipky">
                    <option value="->" ${edge.direction === '->' ? 'selected' : ''}>→</option>
                    <option value="<->" ${edge.direction === '<->' ? 'selected' : ''}>↔</option>
                </select>

                <select class="edge-color-select" title="Barva asociace">
                    ${colorOptions}
                </select>

                <input type="color" class="edge-custom-color" value="${edge.customColor || '#ff6b9d'}" 
                    title="Vlastní barva" style="display:${showPicker ? 'inline-block' : 'none'}; width:28px; height:24px; border:none; padding:0; cursor:pointer;">

                <input type="number" class="edge-item-strength" value="${edge.thickness}" min="1" max="10" title="Mohutnost čáry (síla)">
                
                <input type="text" class="edge-item-label" value="${edge.label || ''}" placeholder="Popisek...">

                <button class="icon-btn del-edge-btn" style="color: var(--danger);">✖</button>
            `;

            // EVENT LISTENERS
            const colorSelect = div.querySelector('.edge-color-select');
            const pickerInput = div.querySelector('.edge-custom-color');

            colorSelect.addEventListener('change', (e) => {
                edge.color = e.target.value;
                pickerInput.style.display = (edge.color === 'custom1' || edge.color === 'custom2') ? 'inline-block' : 'none';
                this.appManager.getActiveRenderer().draw();
            });

            pickerInput.addEventListener('input', (e) => {
                edge.customColor = e.target.value;
                this.appManager.getActiveRenderer().draw();
            });

            div.querySelector('.edge-dir-select').addEventListener('change', (e) => {
                edge.direction = e.target.value;
                this.appManager.getActiveRenderer().draw();
            });
            div.querySelector('.edge-item-strength').addEventListener('input', (e) => {
                edge.thickness = parseInt(e.target.value) || 1;
                this.appManager.getActiveRenderer().draw();
            });
            div.querySelector('.edge-item-label').addEventListener('input', (e) => {
                edge.label = e.target.value;
                this.appManager.getActiveRenderer().draw();
            });
            div.querySelector('.del-edge-btn').addEventListener('click', () => {
                this.currentNodeNode.removeEdge(edge.targetId);
                this.renderEdgesList();
                this.appManager.getActiveRenderer().draw();
            });

            this.edgesList.appendChild(div);
        }
    }

    openPropertiesModal(note) {
        this.editingPropNoteId = note.id;
        this.propTitleInput.value = note.title;
        this.propTagsInput.value = note.tags ? note.tags.join(" ") : "";
        
        const cDate = new Date(note.date);
        const uDate = new Date(note.updatedAt);
        this.propCreatedSpan.innerText = cDate.toLocaleString();
        this.propUpdatedSpan.innerText = uDate.toLocaleString();
        
        this.propModal.classList.remove('hidden');
    }

    closePropertiesModal() {
        this.propModal.classList.add('hidden');
        this.editingPropNoteId = null;
    }

    renderNotesList() {
        if (this.editorMode === 'notebook') {
            this.renderNotebookPages();
            return;
        }
        if (!this.currentNodeNode) return;
        this.notesListContainer.innerHTML = '';
        
        for (let note of this.currentNodeNode.notes) {
            const div = document.createElement('div');
            const isActive = note.id === this.activeNoteId;
            const sizeClass = note.fontSize === 'large' ? 'size-large' : 'size-small';
            
            div.className = `note-item ${isActive ? 'active' : ''} ${sizeClass}`;
            
            let d = new Date(note.updatedAt || note.date);
            let timeStr = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
            
            const tagsStr = note.tags && note.tags.length > 0 ? `<span style="color:var(--neon-cyan); opacity:0.8; font-size: 0.7rem;">${note.tags.join(" ")}</span> ` : "";

            div.innerHTML = `
                <div class="note-item-title">${note.title}</div>
                <div class="note-item-date">${tagsStr}⏱️ Upraveno: ${d.toLocaleDateString()} ${timeStr}</div>
                <div class="note-actions">
                    <button class="icon-btn toggle-font" title="Přepnout velikost fontu">(Aa)</button>
                    <button class="icon-btn prop-btn" title="Vlastnosti poznámky">⚙️</button>
                    <button class="icon-btn del-btn" title="Smazat poznámku">🗑️</button>
                </div>
            `;
            
            div.addEventListener('click', (e) => {
                if (e.target.closest('.note-actions')) return;
                this.activeNoteId = note.id;
                this.renderNotesList();
            });
            
            div.querySelector('.toggle-font').addEventListener('click', () => {
                note.fontSize = note.fontSize === 'large' ? 'small' : 'large';
                note.updatedAt = new Date().toISOString();
                this.renderNotesList();
            });

            div.querySelector('.prop-btn').addEventListener('click', () => {
                this.openPropertiesModal(note);
            });

            div.querySelector('.del-btn').addEventListener('click', () => {
                if (confirm("Opravdu smazat tuto poznámku?")) {
                    this.currentNodeNode.deleteNote(note.id);
                    if (this.activeNoteId === note.id && this.currentNodeNode.notes.length > 0) {
                        this.activeNoteId = this.currentNodeNode.notes[0].id;
                    }
                    this.renderNotesList();
                }
            });
            
            this.notesListContainer.appendChild(div);
        }
        
        const activeNoteObj = this.currentNodeNode.notes.find(n => n.id === this.activeNoteId);
        if (activeNoteObj) {
            if (this.richEditor.innerHTML !== activeNoteObj.content) {
                 this.richEditor.innerHTML = this.sanitizeHtml(activeNoteObj.content || '');
            }
        } else {
            this.richEditor.innerHTML = '';
        }
    }

    setEditorMode(mode) {
        this.editorMode = mode === 'notebook' ? 'notebook' : 'node';
        if (this.editorMode === 'notebook') {
            this.overlay.classList.add('hidden');
            this.notesSectionTitle.textContent = 'Notebook';
            this.addNoteBtn.textContent = '+ Nová stránka';
            this.ensureNotebookSeed();
            this.renderNotebookPages();
        } else {
            this.notesSectionTitle.textContent = 'Poznámky';
            this.addNoteBtn.textContent = '+ Nová poznámka';
            this.showNode(this.currentNodeNode);
        }
        this.setModeButtonState();
        this.syncStickyAppearanceControls();
    }

    toggleNotebookMode() {
        this.setEditorMode(this.editorMode === 'notebook' ? 'node' : 'notebook');
    }

    setModeButtonState() {
        this.notesModeBtn?.classList.toggle('active', this.editorMode === 'node');
        this.notebookModeBtn?.classList.toggle('active', this.editorMode === 'notebook');
    }

    ensureNotebookSeed() {
        const project = this.appManager.currentProject;
        if (!project.notebook) project.notebook = { pages: [] };
        if (!Array.isArray(project.notebook.pages)) project.notebook.pages = [];
        if (project.notebook.pages.length === 0) {
            project.notebook.pages.push({
                id: `nb_${Date.now()}`,
                title: 'Hlavní stránka',
                content: '',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                linkedNodeId: null
            });
        }
        if (!this.activeNotebookPageId) this.activeNotebookPageId = project.notebook.pages[0].id;
    }

    addNotebookPage() {
        if (!this.appManager.currentProject) return;
        this.appManager.pushHistory();
        this.ensureNotebookSeed();
        const page = {
            id: `nb_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
            title: 'Nová stránka',
            content: '',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            linkedNodeId: null
        };
        this.appManager.currentProject.notebook.pages.push(page);
        this.activeNotebookPageId = page.id;
        this.renderNotebookPages();
    }

    getActiveNotebookPage() {
        const pages = this.appManager.currentProject?.notebook?.pages || [];
        return pages.find(p => p.id === this.activeNotebookPageId) || null;
    }

    renderNotebookPages() {
        this.notesListContainer.innerHTML = '';
        this.ensureNotebookSeed();
        const pages = this.appManager.currentProject.notebook.pages;
        if (!pages.find(p => p.id === this.activeNotebookPageId)) {
            this.activeNotebookPageId = pages[0]?.id || null;
        }

        for (const page of pages) {
            const div = document.createElement('div');
            const isActive = page.id === this.activeNotebookPageId;
            div.className = `note-item ${isActive ? 'active' : ''} size-small`;
            const linkedNode = page.linkedNodeId ? this.appManager.currentProject.getNode(page.linkedNodeId) : null;
            div.innerHTML = `
                <div class="note-item-title">${page.title || 'Bez názvu'}</div>
                <div class="note-item-date">${linkedNode ? '🔗 ' + linkedNode.title : 'Notebook page'}</div>
                <div class="note-actions">
                    <button class="icon-btn del-btn" title="Smazat stránku">🗑️</button>
                </div>
            `;
            div.addEventListener('click', (e) => {
                if (e.target.closest('.note-actions')) return;
                this.activeNotebookPageId = page.id;
                this.renderNotebookPages();
            });
            div.querySelector('.del-btn').addEventListener('click', () => {
                if (pages.length <= 1) return;
                this.appManager.currentProject.notebook.pages = pages.filter(p => p.id !== page.id);
                if (this.activeNotebookPageId === page.id) {
                    this.activeNotebookPageId = this.appManager.currentProject.notebook.pages[0].id;
                }
                this.renderNotebookPages();
            });
            this.notesListContainer.appendChild(div);
        }

        const activePage = this.getActiveNotebookPage();
        this.titleInput.value = activePage ? (activePage.title || '') : '';
        if (activePage) {
            if (this.richEditor.innerHTML !== activePage.content) {
                this.richEditor.innerHTML = this.sanitizeHtml(activePage.content || '');
            }
            this.titleInput.oninput = (e) => {
                activePage.title = e.target.value;
                activePage.updatedAt = new Date().toISOString();
            };
        } else {
            this.richEditor.innerHTML = '';
        }
    }

    sanitizeHtml(html) {
        if (!html) return '';
        // Minimal XSS hardening: removes scripts/styles/iframes/object/embed and inline handlers.
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        doc.querySelectorAll('script,style,iframe,object,embed').forEach((el) => el.remove());
        doc.querySelectorAll('*').forEach((el) => {
            [...el.attributes].forEach((attr) => {
                const name = attr.name.toLowerCase();
                const value = (attr.value || '').toLowerCase();
                if (name.startsWith('on') || value.includes('javascript:')) {
                    el.removeAttribute(attr.name);
                }
            });
        });
        return doc.body.innerHTML;
    }
}
