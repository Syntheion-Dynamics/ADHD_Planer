# Release Checklist

## Product
- [x] Version bump and changelog update completed (`0.1.0`).
- [ ] Smoke test: create/edit/delete nodes, sticky notes, notebook pages.
- [ ] Save/load compatibility test on old project JSON files.
- [x] Onboarding modal on first start.
- [x] Simulation marked experimental.

## Security
- [x] Verify HTML sanitization in editor content paths (EditorController + MasterDoc).
- [x] Verify API payload limits and rejection behavior.
- [x] UI toast on 413/400 for save/upload.
- [ ] Verify image upload size limits end-to-end once more before itch upload.

## Packaging readiness
- [x] Desktop target: Electron + Python sidecar.
- [x] App data storage path: `PLANER_DATA_DIR` → Electron `userData`.
- [ ] Run `npm run prepare:python` then `npm run dist` and smoke-test portable build.
- [ ] Crash reporting / telemetry: none in v1 (explicit).

## Distribution
- [x] License file included.
- [x] Third-party notices prepared (`THIRD_PARTY_NOTICES.md`).
- [ ] Signed binaries: post-v1.
- [ ] itch.io page + screenshots (`docs/itch-page-draft.md`, `docs/screenshots/`).
- [x] User guide: `USER.md`.
