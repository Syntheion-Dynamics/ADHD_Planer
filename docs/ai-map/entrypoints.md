# AI Map: Feature Entrypoints

## Add or change canvas behavior
1. Start in `js/CanvasRenderer.js`.
2. Wire creation/action triggers in `js/main.js` (`handleContextAction`, shortcuts).
3. Persist new fields in `js/Project.js` / `js/ProjectNode.js`.

## Change editor workflows
1. Start in `js/EditorController.js`.
2. Confirm matching UI ids in `index.html`.
3. Update styles in `style.css`.

## Change persistence or API payloads
1. Update frontend save/load callers in `js/main.js`.
2. Update schema defaults/migrations in `js/Project.js`.
3. Validate payloads and storage behavior in `server.py`.

## Timeline-related changes
1. `js/TimelineRenderer.js` for drawing.
2. `js/main.js` (`setupTimeline`, project settings).
3. `index.html` timeline modals and controls.
