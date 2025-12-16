# Architektur-Skizze (MAKER-Stil)

Ziel: Coding-Agent, der jede Micro-Änderung als eigenständigen, zustandslosen LLM-Schritt ausführt. Fehlerreduktion via Voting (First-to-lead-by-k) und Red-Flagging. Sicherheitslayer für Filesystem und Commands.

## Kernkomponenten
- **LLM Manager** (`LLMRegistry`): Verwaltung mehrerer Provider (OpenAI/Anthropic/Gemini/LM Studio/custom/local). Pro Provider: `name`, `endpoint`, `model`, `headers`/Keys, Sampling-Params. Auswahl pro Task/Step; separates `voteModel` (leichtes Modell) möglich, um Voting-Kosten zu senken; `listModels()` ermöglicht UI-Auswahl.
  - Provider-Fabrik (`createProvider`) instanziert aus UI/Config: OpenAI, Claude, Gemini, LM Studio (OpenAI-kompatibler lokaler Endpoint), Echo-Stub.
- **Project Guard**: Root-Verzeichnis erzwingen; alle Dateipfade und Commands werden relativ validiert. Dry-Run für File-Diffs.
- **Task Queue** (`TaskQueue`): Add/Pause/Resume/Cancel/Prioritize. Jeder Task referenziert Modell, k, n_samples, Red-Flag-Regeln und eine Liste atomarer Steps.
- **State Store** (`StateStore`): JSON-basierter Zustand (Datei-Listing, offene Diffs, Pending Commands, letzte Testergebnisse). Jeder Step liest explizite Slices und schreibt ein Patch zurück; kein impliziter Chat-Verlauf.
- **Planner** (`planTask` Stub): erzeugt 3 MAD-Steps (Plan, Vorschlag, Write) aus UI-Eingaben (Goal/Filepath) für schnelle Demo.
- **Red-Flagger** (`RedFlagger`): Regeln wie `maxTokens`, `maxChars`, Pflicht-Regex/Schema, Parse-/Lint-Check. Flaggt Kandidaten und löst Resample aus.
- **Voting Engine** (`VotingEngine`): Sequentiales Sammeln von Kandidaten bis ein Output `k` Stimmen Vorsprung hat. Variabler Sampler (Temperatur, Prompt-Paraphrasen) zur Fehler-Dekorrelation.
- **Orchestrator** (`Orchestrator`): Führt einen Step aus: Prompt bauen aus State-Slice + atomarer Anweisung → Kandidaten generieren → Red-Flag-Filter → Voting → Gewinner anwenden (File-Patch oder Command) → State aktualisieren. Optional Planner für automatische Step-Zerlegung. Emit Events (SSE) für Live-Progress.
- **Execution Guardrail** (`CommandRunner`): Klassifiziert Commands (low/med/high risk). Safety-Mode: `auto` oder `ask`. Netzwerk/DB/dangerous commands erzwingen Bestätigung. Captured stdout/stderr ins Audit-Log. Allow-/Deny-Listen steuerbar.
- **Command Approvals**: `CommandRunner` liefert `needs-approval` inkl. ID; Server hält Pending-Queue (persistiert) + Endpoint zum Freigeben.
- **UI**: Provider/Key-Manager, Model-Listing, Task-Ausführung (Haupt/Vote-Modell), Safety-Mode, Pending-Commands, Audit-Logs, Diff-Preview.
- **Audit/Persistenz**: JSONL-Audit-Log (`audit.log`), Pending-Commands Store (`pendingCommands.json`), Provider/Settings (`config.json`).
- **Diff-Preview**: einfacher Zeilen-Diff (`simpleDiff`) zwischen aktueller Datei und vorgeschlagenem Inhalt.

## Datenstrukturen (Auszug)
- `Task`: { id, title, goal, priority, risk, model, voteModel?, k, initialSamples?, maxSamples?, redFlags[], steps[] }
- `Step`: { id, taskId, intent, stateRefs[], command?, status (pending|running|paused|completed|failed), candidates[], winner?, redFlags[], voteModel?, initialSamples?, maxSamples? }
  - `apply`: { type: "writeFile"|"appendFile"|"statePatch"|"writeFileFromState", path?, dryRun?, stateKey? }
  - Error-Events (SSE) wenn Voting/Provider scheitert.
- `Candidate`: { model, promptHash, output, redFlags[], voteCount, metrics }
- `CommandPolicy`: { severity: "low"|"med"|"high", allowNetwork?: boolean }

## Flüsse
1) Task anlegen → Planner (optional) → Steps erzeugen.
2) Step ausführen → State-Slice lesen → Kandidaten erzeugen (n) → Red-Flag filter → Voting bis lead-by-k → Gewinner anwenden → State patchen.
3) Commands: Falls Severity hoch oder Safety=ask → User Approval; sonst sand-boxed ausführen; Log sichern.
4) Fehlerpfad: Parse-/Lint-Fehler ⇒ Resample; wiederholte Flags ⇒ Eskalation/Abort.
5) UI: (a) Provider anlegen (Keys/Modelle), (b) Modelle abrufen (`listModels`), (c) Task ausführen mit Haupt-/Voting-Provider, (d) State/Logs/Audit einsehen, (e) Safety-Mode/Allow-Deny setzen, Pending-Commands freigeben, Diff-Preview anfordern.

## Offene Erweiterungen
- Insights-Agenten für Strategien; Prompt-Diversifikation zur Fehler-Dekorrelation; persistente Audit-Logs; Tauri/Electron-Frontend; Multi-root-/Mono-Repo-Support; integriertes Test-Runner-Gate.
