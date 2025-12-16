# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Ultracode is a MAKER-style autonomous coding agent built on vanilla Node.js (no external dependencies). It executes tasks as atomic, stateless steps with LLM voting (First-to-lead-by-k), red-flag validation, and strict filesystem/command sandboxing.

**Core Philosophy:**
- **Stateless Steps**: Each step reads explicit state slices, never implicit chat history
- **Voting + Red-Flagging**: Multiple LLM samples vote on outputs; red-flags trigger resampling
- **Safety First**: `ProjectGuard` restricts filesystem writes to workspace directories; `CommandRunner` classifies commands by risk (low/med/high) and enforces approval flow

## Development Commands

**Run the demo task (stub providers):**
```bash
node src/index.js
```
Executes a 3-step demo with echo providers, writes to `out/demo.log`.

**Start the HTTP server + UI:**
```bash
PORT=4173 node src/server.js
```
- UI available at `http://localhost:4173`
- Default port: 4173 (override with `PORT`), bind address: 127.0.0.1 (override with `HOST`)
- Server provides REST API (`/api/*`) and SSE events (`/api/events`)

**No build/test commands:**
This project has no package manager or formal test suite. Validate changes by running the demo and server.

## High-Level Architecture

### Request Flow
1. **Task Creation** → `Planner` decomposes goal into atomic steps (or user provides steps manually)
2. **Step Execution** (via `Orchestrator`):
   - Build prompt from state slice + step intent
   - Generate `n` candidates via LLM provider
   - Red-flag filter rejects invalid outputs
   - Voting counts identical outputs until one leads by `k` votes
   - Winner applied: file write (via `ProjectGuard`) or command (via `CommandRunner`)
   - State updated with result
3. **UI/API** → SSE stream broadcasts live progress events

### Core Components

**`orchestrator.js`** (src/orchestrator.js:6)
- Coordinates single-step execution: prompt → candidates → voting → apply
- Builds prompts from task metadata and state slices (src/orchestrator.js:31)
- Applies winner via `ProjectGuard` for files or `CommandRunner` for commands (src/orchestrator.js:150)
- Emits SSE events for live UI updates

**`votingEngine.js`** (src/votingEngine.js:4)
- Implements First-to-lead-by-k consensus
- Samples until one output achieves `k`-vote margin over runner-up
- Red-flagged candidates are discarded and resampled (src/votingEngine.js:36)
- Fallback: returns best output if max rounds exhausted without margin

**`planner.js`** (src/planner.js:13)
- Decomposes user goal into JSON plan of atomic steps
- LLM generates steps with `intent`, `apply` action (writeFile/appendFile/command), and optional red-flag rules
- Fallback plan if JSON parse fails (src/planner.js:72)

**`executionGuard.js` (CommandRunner)** (src/executionGuard.js:4)
- Classifies commands by severity (low/med/high) based on content (src/executionGuard.js:24)
- Safety modes: `auto` (executes all), `ask` (requires approval for med/high)
- Allow/deny lists override classification (src/executionGuard.js:11)
- Returns `needs-approval` status for pending commands (src/executionGuard.js:50)

**`projectGuard.js`** (src/projectGuard.js:5)
- Restricts file operations to a single root directory (src/projectGuard.js:13)
- Rejects paths escaping root (src/projectGuard.js:15)
- Dry-run mode for preview before write (src/projectGuard.js:37)

**`llmRegistry.js`** + `providerFactory.js`**
- Registry manages multiple LLM providers (OpenAI, Claude, Gemini, LM Studio, Echo stub)
- Each provider implements `generate(prompt)` and `listModels()`
- Providers created via factory: `createProvider({ type, name, model, apiKey?, baseUrl? })`
- LM Studio: OpenAI-compatible, default `http://localhost:1234/v1`

**`server.js`** (src/server.js:204)
- HTTP server serves `public/` static files + REST API
- SSE endpoint `/api/events` broadcasts real-time task/step progress (src/server.js:205)
- Persists providers/settings to `data/config.json`, audit logs to `data/audit.log`, pending commands to `data/pendingCommands.json`, tasks to `data/tasks.json`
- Each task gets isolated workspace: `workspaces/<task-id>/` (src/server.js:114)

### Data Flow

**Task Object:**
```js
{
  id, title, goal, model, voteModel?,
  k: 2,              // margin for voting
  nSamples: 3,       // samples per round
  steps: [...]       // array of Step objects
}
```

**Step Object:**
```js
{
  id, taskId, intent,
  stateRefs: [],     // keys to pull from state
  apply: {
    type: "writeFile" | "appendFile" | "statePatch" | "writeFileFromState",
    path?: "...",    // for file operations
  },
  status: "pending" | "running" | "completed" | "failed",
  candidates: [],    // LLM outputs with vote counts
  winner?: {...}
}
```

**Candidate:**
```js
{
  model, output, redFlags: [], voteCount, metrics: { round, sample }
}
```

### State Management

`StateStore` holds in-memory state:
- `workspace`: current task workspace path
- `appliedOutputs`: history of step winners
- `pendingCommands`: commands awaiting approval
- `tasks`: array of task metadata
- Custom keys written by steps via `statePatch`

State updates are atomic per step; no shared mutable state between steps.

### Provider Integration

**Registering a provider:**
```js
const { LLMRegistry } = require("./src/llmRegistry");
const { OpenAIProvider } = require("./src/providers/openaiProvider");

const llms = new LLMRegistry();
llms.register("openai-main", new OpenAIProvider({
  apiKey: process.env.OPENAI_KEY,
  model: "gpt-4"
}));
```

**Listing models (for UI dropdowns):**
```js
const models = await llms.listModels("openai-main");
```

**LM Studio setup:**
1. Start LM Studio server (default `http://localhost:1234/v1`)
2. Use `LMStudioProvider` with `listModels()` to load installed models
3. Register selected model in UI

### Safety & Sandboxing

**Filesystem:**
- All file writes go through `ProjectGuard.writeFile(relPath, content, { dryRun })`
- Paths are validated against workspace root; escaping throws error
- Preview diffs before applying: `simpleDiff(beforeContent, afterContent)` (diffUtil.js)

**Commands:**
- Commands classified on execution: `rm`, `sudo`, `drop database` → high severity
- `curl`, `wget`, HTTP → med severity (network flag)
- Allow/deny lists in `data/config.json` override default classification
- Pending approvals stored in `data/pendingCommands.json`, survives restarts

**Audit Logs:**
- All events written to `data/audit.log` (JSONL format)
- Includes prompts, candidates, votes, red-flags, command outputs

## Key Patterns

**Adding a new LLM provider:**
1. Create `src/providers/myProvider.js` implementing `generate(prompt)` and `listModels()`
2. Add case in `providerFactory.js:createProvider()`
3. Register in UI or programmatically via `LLMRegistry.register(name, instance)`

**Modifying step execution:**
- Edit `Orchestrator.runStep()` for new apply types
- Add red-flag rules in `redFlagger.js` for validation logic
- Voting parameters (`k`, `nSamples`) are per-task/step configurable

**Custom planner logic:**
- Planner prompt lives in `planner.js:20-59`
- Customize JSON schema for step generation
- Fallback plan at `planner.js:72` if LLM fails

**SSE event integration:**
- `Orchestrator` emits events via `eventEmitter.emit(event)`
- `server.js` broadcasts to connected SSE clients (src/server.js:56)
- Event types: `step-start`, `step-completed`, `step-error`, `command-output`, `task-completed`

## Persistence

- `data/config.json`: Provider configs, safety mode, allow/deny lists
- `data/audit.log`: JSONL event stream (prompts, outputs, commands)
- `data/pendingCommands.json`: Commands awaiting approval
- `data/tasks.json`: Task metadata and full task objects with steps
- `workspaces/<task-id>/`: Per-task output files (e.g., generated HTML, logs)

**Important:** Never commit `data/` directory (contains API keys). File is created on first run.

## Workspaces

Each task runs in `workspaces/<task-id>/`:
- Created automatically on task start (src/server.js:114)
- `ProjectGuard` initialized with workspace path restricts writes to this directory
- Demo flow uses `out/` instead of workspace for legacy reasons
- Generated artifacts (HTML, code, logs) land in workspace subdirectories

## Common Gotchas

- **Provider not found:** Ensure provider is registered before task execution. Check `llmRegistry.get(name)` doesn't return null.
- **Path escape errors:** `ProjectGuard` rejects `../` or absolute paths outside root. Always use relative paths from workspace.
- **Command hanging:** High-severity commands default to `needs-approval` in `ask` mode. Check pending commands in UI or `data/pendingCommands.json`.
- **Voting never converges:** If red-flags reject all candidates or outputs are too diverse, voting may exhaust max rounds (5) without achieving `k`-margin. Check red-flag rules or increase `nSamples`.
- **LM Studio connection fails:** Verify server is running at `baseUrl` (default `http://localhost:1234/v1`). Test with `listModels()` before task execution.
- **Task state lost on restart:** State is in-memory only. Task metadata and full task objects are persisted to `data/tasks.json` but in-progress steps must be restarted.
