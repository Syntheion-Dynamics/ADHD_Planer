# AI Map: Change Log Rules

## Required format for each change
- **Why:** user-facing or technical reason.
- **Where:** exact touched files.
- **Risk:** what can regress.
- **Verify:** quick manual checks.

## Scope discipline
- Keep one logical change per commit section.
- If more than 5 files are touched, explain dependency chain.
- If serialization changes, always mention migration/default behavior.

## AI Anchors
For every new task, define:
- Primary files (2-4)
- Secondary files (optional)
- Out-of-scope files (explicitly excluded)
