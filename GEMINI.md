# Ultracode - GEMINI Context

## Project Overview
Ultracode is a "MAKER-style" autonomous coding agent designed with a focus on radical statelessness per step, voting mechanisms with red-flagging, and strict command/filesystem guardrails. It operates without external dependencies (vanilla Node.js).

**Core Philosophy:**
*   **Stateless Steps:** Each action is an independent step reading from a state slice.
*   **Safety:** `ProjectGuard` restricts filesystem access to the root/workspaces. `ExecutionGuard` classifies and intercepts shell commands based on risk (low/med/high) and user settings (`auto`/`ask`).
*   **Reliability:** Uses a "Voting Engine" (First-to-lead-by-k) and "Red-Flagger" to validate LLM outputs before execution.
*   **Architecture:** Backend-only logic in `src/` with a vanilla JS frontend served by `src/server.js`.

## Key Components (`src/`)
*   **`orchestrator.js`:** Manages the execution flow: Prompt -> Candidates -> Red-Flag -> Voting -> Apply -> State Update.
*   **`providerFactory.js` & `llmRegistry.js`:** Manages LLM providers (OpenAI, Gemini, Claude, LM Studio, Echo Stub).
*   **`executionGuard.js`:** Sandbox for shell commands. Handles approvals and allowed/denied lists.
*   **`projectGuard.js`:** Ensures file operations remain within the project root or specific workspaces.
*   **`votingEngine.js`:** Implements the consensus logic for selecting the best LLM response.
*   **`server.js`:** HTTP server hosting the UI and API endpoints (`/api/tasks`, `/api/providers`, `/api/events` SSE).

## Building and Running

This project uses standard Node.js with no build step required.

### Prerequisites
*   Node.js (v18+ recommended)

### CLI Demo
Runs a predefined demo sequence with stub "Echo" providers.
```bash
node src/index.js
```

### Server & UI
Starts the backend server and serves the web UI.
```bash
PORT=4173 node src/server.js
```
*   Access UI at: `http://localhost:4173`
*   Data stored in: `data/` (config, audit logs, pending commands).
*   Workspaces created in: `workspaces/` (e.g., `workspaces/task-<timestamp>/`).

## Development Conventions

*   **No External Dependencies:** The core logic uses standard Node.js modules (`fs`, `http`, `path`, `crypto`).
*   **Type Safety:** Types are documented via JSDoc (see `src/types.js`).
*   **Configuration:** Persistent configuration (providers, keys) is stored in `data/config.json`.
*   **State Management:** Runtime state is held in-memory by `StateStore`, with snapshots available via API.
*   **Workspaces:** Each task runs in an isolated subdirectory under `workspaces/` to prevent accidental overwrites of the main codebase.

## Directory Structure
*   `src/`: Core application logic.
*   `public/`: Frontend assets (HTML, JS) served by the server.
*   `data/`: Runtime data storage (ignored by git usually).
*   `workspaces/`: Sandbox directories for agent tasks.
*   `docs/`: Documentation (architecture, etc.).
