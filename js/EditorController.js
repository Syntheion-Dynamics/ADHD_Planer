import { EDGE_COLORS, ProjectNode } from './ProjectNode.js';

export class EditorController {
    constructor(appManager) {
        this.appManager = appManager;
        
        this.overlay = document.getElementById('no-node-overlay');
        this.titleInput = document.getElementById('node-title-input');
        
        this.notesListContainer = document.getElementById('notes-list');
        this.addNoteBtn = document.getElementById('add-note-btn');
        
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
        this.pinBtn = document.getElementById('node-pin-btn');
        this.connectBtn = document.getElementById('connect-node-btn');
        this.edgesContainer = document.getElementById('edges-container');
        this.edgesList = document.getElementById('edges-list');

        // V2.0 — Node image
        this.nodeImageBtn = document.getElementById('node-image-btn');
        this.nodeImageInput = document.getElementById('node-image-input');

        this.currentNodeNode = null;
        this.activeNoteId = null;
        this.editingPropNoteId = null;

        this.setupEventListeners();
        this.setupToolbar();
    }

    setupEventListeners() {
        this.titleInput.addEventListener('input', (e) => {
            if (this.currentNodeNode) {
                // Not pushing history on every character, but maybe on focus/blur?
                // For now, simple update is fine.
                this.currentNodeNode.title = e.target.value;
            }
        });

        this.richEditor.addEventListener('input', () => {
            if (this.currentNodeNode && this.activeNoteId) {
                const note = this.currentNodeNode.notes.find(n => n.id === this.activeNoteId);
                if (note) {
                    note.content = this.richEditor.innerHTML;
                    note.updatedAt = new Date().toISOString();
                }
            }
        });

        this.addNoteBtn.addEventListener('click', () => {
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

        this.pinBtn.addEventListener('click', () => {
            if (this.currentNodeNode) {
                this.currentNodeNode.isPinned = !this.currentNodeNode.isPinned;
                this.showNode(this.currentNodeNode);
                this.appManager.getActiveRenderer().draw();
            }
        });

        this.connectBtn.addEventListener('click', () => {
            if (this.currentNodeNode) {
                this.appManager.isConnecting = true;
                document.getElementById('connect-overlay').classList.remove('hidden');
            }
        });

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
                        if (res.ok) {
                            const data = await res.json();
                            this.currentNodeNode.nodeImage = data.url;
                            this.showNode(this.currentNodeNode);
                            this.appManager.getActiveRenderer().draw();
                            if (this.appManager.toast) this.appManager.toast.success('Obrázek uzlu nastaven!');
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
                    if (res.ok) {
                        const data = await res.json();
                        this.richEditor.focus();
                        document.execCommand('insertImage', false, data.url);
                        
                        if (this.currentNodeNode && this.activeNoteId) {
                            const note = this.currentNodeNode.notes.find(n => n.id === this.activeNoteId);
                            if (note) note.updatedAt = new Date().toISOString();
                        }
                    } else {
                        if (this.appManager.toast) this.appManager.toast.error("Nepodařilo se nahrát obrázek.");
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
    }

    setupToolbar() {
        const buttons = document.querySelectorAll('.format-btn:not(#image-upload-btn)');
        buttons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const cmd = btn.getAttribute('data-cmd');
                document.execCommand(cmd, false, null);
                this.richEditor.focus();
            });
        });

        const select = document.getElementById('format-select');
        select.addEventListener('change', (e) => {
            e.preventDefault();
            const format = e.target.value;
            document.execCommand('formatBlock', false, format);
            select.value = 'p'; 
            this.richEditor.focus();
        });
    }

    showNode(node) {
        this.currentNodeNode = node;
        if (!node) {
            this.overlay.classList.remove('hidden');
            this.notesListContainer.innerHTML = '';
            this.richEditor.innerHTML = '';
            this.edgesList.innerHTML = '';
            return;
        }

        this.overlay.classList.add('hidden');
        this.titleInput.value = node.title;
        
        // V1.3 UI Update
        this.statusSelect.value = node.status || 'none';
        this.statInput.value = node.statValue || '';
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
        
        if (!node.notes || node.notes.length === 0) node.addNote();
        
        const exists = node.notes.find(n => n.id === this.activeNoteId);
        if (!exists) this.activeNoteId = node.notes[0].id;

        this.renderNotesList();
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
                 this.richEditor.innerHTML = activeNoteObj.content || '';
            }
        } else {
            this.richEditor.innerHTML = '';
        }
    }
}
