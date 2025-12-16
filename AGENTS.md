# Repository Guidelines

## Project Structure & Modules
- `src/` holds the backend: `server.js` (API + SSE + persistence), `orchestrator.js`, `planner.js`, `executionGuard.js`, `projectGuard.js`, `llmRegistry.js` plus provider implementations in `src/providers/`.
- `public/` serves the lightweight UI (`index.html`, `ui.js`); assets are read-only at runtime.
- `data/` is created at runtime for config, audit logs, pending commands, and task persistence (`config.json`, `audit.log`, `pendingCommands.json`, `tasks.json`).
- `workspaces/<task-id>/` contain per-task artifacts produced by steps; `out/` is used by the demo flow.
- `docs/` and `GEMINI.md` house narrative notes; `README.md` summarizes usage.

## Build, Run, and Development Commands
- `node src/index.js` — runs the demo task with echo providers and writes `out/demo.log`.
- `PORT=4173 node src/server.js` — starts the HTTP API + SSE server and serves `public/`; set `HOST` to override bind address.
- There is no package manager setup; code uses built-in Node APIs. Keep contributions dependency-free unless discussed.

## Coding Style & Naming
- JavaScript (CommonJS) with 2-space indentation, single quotes acceptable but current files use double quotes; stay consistent per file.
- Prefer small, pure functions; keep side effects near edges (I/O, network, file writes).
- Use clear names for steps/tasks (`taskId`, `stepId`, `workspacePath`). Keep provider configs in `{ type, name, model, apiKey?, baseUrl? }` shapes.
- Add brief JSDoc when adding new modules or public methods to document expected shapes (e.g., task/step objects).

## Testing Guidelines
- No formal test harness exists. Validate changes by running `node src/index.js` (demo) and `node src/server.js` (UI/API) to ensure providers load and tasks complete without errors.
- For provider changes, exercise `/api/providers/probe-models` via the UI or a small curl to confirm listModels works.
- When adding logic, include lightweight sanity checks or assertions in the code paths you touch.

## Commit & PR Expectations
- Keep commits focused and descriptive (present-tense summaries, e.g., “add task persistence map update”).
- Include what was tested (`node src/index.js`, `node src/server.js`) in PR notes.
- Describe user-visible changes (API endpoints, UI behavior) and any new files written to `data/` or `workspaces/`.
- Never commit secrets; `data/config.json` should remain local-only. If adding config fields, document them and default behavior.

## Security & Configuration Tips
- API keys are stored locally via `/api/config/keys` and persisted to `data/config.json`; avoid logging them and never commit `data/`.
- File writes should go through `ProjectGuard` to stay within the allowed workspace; avoid direct `fs` writes outside guarded paths.
- Pending commands and audit events are persisted; keep these behaviors intact when modifying command execution flow.

## Projektstand (kurz)
- Voting adaptiv (first-to-ahead-by-k) mit Temperatur-Ramp und hartem Sample-Cap; Voting-Summary im Console-Log.
- Agent-Outputs als Actions-JSON (write/append/apply_patch/replace_range/run_cmd/request_info), validiert und über ProjectGuard/CommandRunner ausgeführt; Codefences werden vor dem Schreiben entfernt.
- Snapshots pro Step in `data/snapshots.db` (SQLite via CLI): runs, steps, votes, actions; Filesystem bleibt Quelle der Wahrheit.
- UI/API via `src/server.js` + `public/`; Workspaces unter `workspaces/<task-id>` enthalten Artefakte.
- Tests: `node tests/integration.test.js`; keine npm-Abhängigkeiten im Repo.
