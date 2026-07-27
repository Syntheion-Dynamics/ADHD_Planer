# AI Map: Architecture

## Core Runtime
- `js/main.js`: app orchestration, project switching, context menu actions, keyboard shortcuts, persistence calls.
- `js/Project.js`: project-level state, JSON serialization, migration defaults.
- `js/ProjectNode.js`: node data model, notes, edges, geometry helpers.

## Rendering
- `js/CanvasRenderer.js`: data-mode canvas rendering, node/edge interactions, minimap.
- `js/SimulationRenderer.js`: simulation-mode rendering and animation.
- `js/TimelineRenderer.js`: timeline panel rendering.

## Editor and UX
- `js/EditorController.js`: right panel editing logic for node notes and notebook mode.
- `index.html`: UI shell and feature entrypoints.
- `style.css`: visual system and component styling.

## Backend
- `server.py`: localhost API (`/api/load-projects`, `/api/save-project`, `/api/delete-project`, `/api/upload-image`), static serving.
