# MAKER-style Coding Agent (skeleton)

Erster Wurf eines MAKER-inspirierten Coding-Agents. Fokus: radikale Zustandslosigkeit pro Schritt, Voting mit Red-Flagging, command guardrails und Projekt-Sandbox.

## Aktueller Stand
- Minimale Skeleton-Implementierung ohne externe Dependencies.
- Kernmodule in `src/`: Task-Queue, State-Store, Orchestrator, Voting/Red-Flagger, LLM-Provider-Registry, Execution-Guard (Commands), Project-Guard (Root-limited FS).
- Kein UI/Frontend, nur Backend-Schnittstellen und eine Demo-Sequenz in `src/index.js`.

## Schnellstart
```
node src/index.js
```
Die Demo nutzt Stub-LLMs (`EchoProvider`): ein "stärkeres" Modell für den Task (`echo-strong`) und ein kleineres für das Voting (`echo-vote`). Planner erzeugt drei Schritte: (1) Plan notieren, (2) Datei-Inhalt vorschlagen, (3) Datei `out/demo.log` schreiben via Project-Guard, plus ein Low-Risk-Command-Dry-Run. Voting (First-to-lead-by-k) + Red-Flagging sind aktiv. Typinformationen sind via JSDoc hinterlegt, kein Build-Step nötig.

## Server + UI
```
PORT=4173 node src/server.js
# UI unter http://localhost:4173 (Port via ENV PORT überschreibbar)
```
Features der UI:
- Provider anlegen (OpenAI, Claude, Gemini, LM Studio, Echo-Stub) inkl. API-Key/Endpoint/Modell und Dropdown-Auswahl für Task/Voting.
- Modelle des Providers abrufen (listModels) für UI-Auswahl; LM Studio wird auto-gescannt (Base-URL optional, default `http://localhost:1234/v1`).
- Demo-Task ausführen mit Haupt- und Voting-Provider (leichteres Modell).
- State/Log inspizieren.
- Safety-Mode setzen (`ask` = Bestätigung für med/high; `auto` = alles ausführen), Pending-Commands einsehen und freigeben.
- Custom Task anlegen (Title/Goal/Filepath/Model/VoteModel). Planner zerlegt in 3 atomare Steps (Plan, Vorschlag, Write).
- Allow/Deny-Listen für Commands setzen, Audit-Logs abrufen, Diff-Preview gegen bestehende Datei anzeigen.
- Workspaces: Jeder Task erhält einen eigenen Ordner unter `workspaces/<task-id>`; ProjectGuard beschränkt Schreibrechte darauf.
- Live-Events: SSE-Stream (`/api/events`) wird in der UI angezeigt (Step-Start/Ende, Commands, Logs).
  - Artefakte (z. B. HTML, Backend-Stubs, README) landen innerhalb des jeweiligen `workspaces/<task-id>/...`.
- Allow/Deny-Listen für Commands setzen; Audit-Logs abrufen; Diff-Preview (gegen aktuelle Datei) ausführen; Tasks werden persistiert im State, Commands in Pending-Store.

## Provider (OpenAI / Gemini / Claude / LM Studio)
- Siehe `src/providers/*.js` für Implementierungen. Alle bieten `generate(prompt)` und `listModels()`.
- Keys werden beim Instanziieren übergeben (z. B. aus ENV oder UI-Formular). Beispiel:
  ```js
  const { OpenAIProvider } = require("./src/providers/openaiProvider");
  const { LLMRegistry } = require("./src/llmRegistry");
  const llms = new LLMRegistry();
  llms.register("openai-vote", new OpenAIProvider({ apiKey: process.env.OPENAI_KEY, model: "gpt-4.1-mini" }));
  ```
- Modelle abfragen (für UI-Auswahl):
  ```js
  const models = await llms.listModels("openai-vote");
  ```
- LM Studio: OpenAI-kompatibel, default Endpoint `http://localhost:1234/v1`; nutze `LMStudioProvider` und `listModels()` zum Import installierter Modelle, dann wähle eines und registriere es.

## Persistenz
- Provider/Settings werden in `data/config.json` abgelegt (automatisch erzeugt).
- Audit-Logs landen in `data/audit.log` (JSONL).
- Pending Commands werden in `data/pendingCommands.json` gespeichert und beim Start geladen.
- State liegt in-memory; State-API gibt aktuellen Snapshot zurück.

## Kurzanleitung: Beispiel-Task „Baue mir eine Einhornwebsite“
1) Server starten: `PORT=4173 node src/server.js` und UI öffnen (`http://localhost:4173`).
2) Provider anlegen:
   - Typ wählen (z. B. OpenAI).
   - API Key eingeben (nicht nötig für LM Studio/Echo).
   - Optional Base URL (LM Studio: `http://localhost:1234/v1`).
   - „Modelle automatisch laden“ klicken → Dropdown füllt sich; wähle Modell.
   - Label vergeben (z. B. `openai-main`) und speichern.
   - Für Voting optional einen zweiten (günstigen) Provider anlegen.
3) Safety einstellen (ask/auto; ggf. Allow/Deny-Listen).
4) Custom Task ausführen:
   - Title: `Einhornwebsite`
   - Goal: `Baue mir eine Einhornwebsite in HTML/CSS, einfache Seite mit Hero, Features und CTA.`
   - Filepath: `out/unicorn.html`
   - Haupt- und Voting-Provider über Dropdown wählen (Voting leer = gleich wie Haupt).
   - „Task ausführen“ klicken.
5) Ergebnis prüfen:
   - Logs/State ansehen; Datei `out/unicorn.html` prüfen.
   - Optional Diff-Preview nutzen, Pending Commands freigeben, Audit-Logs ansehen.

## Nächste Schritte (Vorschlag)
1) Provider an echte Modelle anbinden (OpenAI/Anthropic/Together/local HTTP) und Keys sicher speichern.
2) Einfaches UI (Tauri/Electron/Next) mit: Task-Liste, Logs pro Step, Vote/Red-Flag-Details, Command-Bestätigungen, k/n_samples Controls.
3) Planner ergänzen, der Aufgaben in atomare Steps zerlegt (MAD) und State-Slices für Prompts bereitstellt.
4) Command-Policy verfeinern (Severity, allow/deny-Listen, Netzwerk-Toggle) und Sandbox-Einschränkungen erzwingen.
5) Persistente State-/Audit-Logs (JSONL) mit Prompts, Diffs, Votes, Red-Flags, Command-Runs.
