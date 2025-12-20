# Repository Guidelines (Current)

## Key Changes & Current Behavior
- **Features source**: Features live only in the SQLite DB (`features.db`). The wizard no longer writes `features.json`; features are created directly in the DB at finalize. Do not rely on `features.json`.
- **Wizard token budget**: `wizardAgent` uses `maxTokens: 50,000` for chat and summary extraction.
- **Feature execution**:
  - “Execute Next” resumes paused features first if dependencies are met.
  - Automated tests are currently disabled.
  - `editFile` apply is supported; it fails if `old_string` is not found (no full-file overwrite).
- **Dev server**: `ServerManager` starts on ports beginning at 42000 with random jumps; UI has Play/Stop buttons that also open the server URL in a new tab.
- **UI**:
  - Feature list has Edit/Delete; edit modal updates name/description via v2 API.
  - Columns (Features/Subtasks/Terminal) are resizable via drag handles.
  - Model modal uses v2 models endpoint; Play/Stop for dev server in header.
- **Git commits**: Optional; guarded—no crash if `commitFeatureCompletion` is missing.
- **Ignore projects**: `.gitignore` excludes `projects/`, `workspaces/`, `data/`, `out/`, `node_modules/`.

## Project Structure & Modules
- `src/` holds backend: `server.js` (API + SSE + persistence), `orchestrator.js`, `planner.js`, `executionGuard.js`, `projectGuard.js`, `llmRegistry.js`, and providers in `src/providers/`.
- `public/` serves the UI (`index.html`, `ui.js`); assets are read-only at runtime.
- `data/` is runtime for config, audit logs, pending commands, tasks (`config.json`, `audit.log`, `pendingCommands.json`, `tasks.json`, `features.db`, `snapshots.db`).
- `workspaces/<task-id>/` contain per-task artifacts; `out/` used by the demo flow.
- `docs/` and `GEMINI.md` hold notes; `README.md` summarizes usage.

## Build, Run, Development
- `node src/index.js` — demo task with echo providers; writes `out/demo.log`.
- `PORT=4173 node src/server.js` — starts HTTP API + SSE + serves `public/`; `HOST` overrides bind.
- No package manager deps beyond what’s committed; avoid adding unless agreed.

## Coding Style & Naming
- JavaScript (CommonJS), 2-space indent, double quotes where present.
- Small, pure functions; side effects at edges.
- Clear names: `taskId`, `stepId`, `workspacePath`; providers shaped `{ type, name, model, apiKey?, baseUrl? }`.
- Brief JSDoc for new modules/public methods.

## Testing
- No formal harness; validate via `node src/index.js` and `node src/server.js`.
- For providers, test `/api/providers/probe-models`.
- Auto-tests are disabled in feature execution.

## Commit & PR
- Focused, descriptive commits (present tense).
- Note what was tested (`node src/index.js`, `node src/server.js`).
- Describe user-visible changes (API/UI, files written to `data/` or `workspaces/`).
- Never commit secrets; `data/config.json` is local-only. Document new config fields and defaults.

## Security & Config
- API keys via `/api/config/keys`, persisted to `data/config.json`; do not log them.
- File writes go through `ProjectGuard`; avoid raw `fs` outside guarded paths.
- Pending commands and audit events are persisted; keep intact when touching execution flow.
