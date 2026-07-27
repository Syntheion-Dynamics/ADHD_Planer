# Electron Readiness

## Current state (0.1.0)
- Frontend: static `index.html` + `js/*`.
- Backend: local Python server `server.py` (sidecar).
- Desktop shell: `electron/main.js` + `electron/preload.js`.
- Persistence: OS `userData` via `PLANER_DATA_DIR` (Electron); repo folders when running `python server.py` alone.

## Architecture
1. Electron main finds a free port, spawns Python sidecar with `PORT`, `PLANER_STATIC_DIR`, `PLANER_DATA_DIR`.
2. Waits for `GET /api/ping`, then loads `http://127.0.0.1:<port>/`.
3. On quit, kills the sidecar process tree.

## Dev
```bash
npm install
npm start          # Electron + system Python
python server.py   # browser-only, port 8080
```

## Portable build (Windows)
```bash
npm run prepare:python   # embeddable Python + pypdf → python-runtime/
npm run dist             # electron-builder portable
```

## Hardening checklist
- [x] `contextIsolation: true`, `nodeIntegration: false`
- [x] HTML sanitization in editor / master doc paths
- [x] Data storage in OS app-data (`userData`)
- [ ] Crash reporting and update mechanism (post-v1)
- [x] `schemaVersion` in project JSON
- [x] Keep `/api/*` contracts stable
