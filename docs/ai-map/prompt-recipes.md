# AI Map: Prompt Recipes

## Small UI tweak
Use when only one area changes.

`Goal: <change>. Read only these files first: <2-4 paths>. Keep existing behavior unchanged outside scope.`

## New node/canvas feature
`Implement <feature> with persistence. Start with js/CanvasRenderer.js + js/main.js + js/Project.js + js/ProjectNode.js. Add migration-safe defaults.`

## Editor feature
`Implement <feature> in right panel. Touch only js/EditorController.js, index.html, style.css unless persistence is needed.`

## API hardening pass
`Audit and improve request validation in server.py and adjust frontend payload assumptions in js/main.js/js/Project.js.`

## Token-budget workflow
1. Read `docs/ai-map/architecture.md`.
2. Select max 4 target files from `entrypoints.md`.
3. Only expand scope when a concrete symbol dependency appears.
