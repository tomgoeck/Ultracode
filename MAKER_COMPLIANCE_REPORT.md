# MAKER Compliance Report: Ultracode

**Datum:** 2025-12-16
**Projekt:** Ultracode - MAKER-style Coding Agent
**Analysiert von:** Claude Code

---

## Executive Summary

Das Ultracode-Projekt implementiert bereits die **drei Kernprinzipien des MAKER-Papers** (Maximal Agentic Decomposition, First-to-lead-by-k Voting, Red-Flagging). Die Architektur ist solide und folgt dem MDAP-Paradigm. Es gibt jedoch wichtige Lücken bei erweiterten Features, die im Anforderungskatalog beschrieben sind.

**Status:** ✅ Kern-MAKER implementiert | ⚠️ Erweiterte Features fehlen teilweise

---

## 1. Debugging-Ergebnis

### Problem
`src/server.js` war beschädigt/unvollständig (227 Zeilen statt 374 Zeilen). Die Funktion `ensure` und große Teile der API-Handler fehlten.

### Lösung
```bash
git checkout HEAD -- src/server.js
```

Die Datei wurde aus Git wiederhergestellt. Der Server läuft jetzt fehlerfrei:
```
Server running at http://127.0.0.1:4173
```

---

## 2. MAKER Core-Prinzipien: Compliance-Check

### 2.1 Maximal Agentic Decomposition (MAD) ✅ IMPLEMENTIERT

**Anforderung:** Aufgaben in atomare Schritte zerlegen, jeder Schritt = ein LLM-Call mit minimalem State.

**Status:** ✅ Vollständig implementiert

**Nachweise:**
- **`src/planner.js`**: Dynamische Zerlegung von Tasks in atomare Steps
  ```javascript
  // Zeilen 20-59: Planner-Prompt zerlegt Goal in JSON-Steps
  // Zeilen 80-92: Mapping zu internen Step-Strukturen
  ```
- **`src/orchestrator.js:31-41`**: Prompt-Building pro Step
  ```javascript
  buildPrompt(task, step, state) {
    const stateSlice = (step.stateRefs || [])
      .map((ref) => `${ref}: ${JSON.stringify(state[ref], null, 2)}`)
      .join("\n");
    return [
      `Task: ${task.title}`,
      `Goal: ${task.goal}`,
      `Step Intent: ${step.intent}`,
      `State:\n${stateSlice || "(empty)"}`,
      `Instruction: Return the minimal code/action needed for this single step only.`
    ].join("\n\n");
  }
  ```
- **Radikale Zustandslosigkeit:** Jeder Step liest nur explizite `stateRefs`, kein Chat-Verlauf (docs/architecture.md:10)

**Stärken:**
- Planner kann automatisch 3-Step-Plans (Plan, Vorschlag, Write) generieren
- State-Slices verhindern Context-Drift
- Mikro-Agent-Zyklus: "wake up → state → minimal action → write new state → die"

**Lücken:**
- ❌ **Insights-Agenten fehlen:** Keine dedizierten strategischen Agenten (MAKER-Erweiterungsvorschlag)
- ❌ **Prompt-Paraphrasierung fehlt:** Keine Varianz zwischen Voting-Samples zur Fehler-Dekorrelation

---

### 2.2 First-to-ahead-by-k Voting ✅ IMPLEMENTIERT

**Anforderung:** Multiple Samples generieren, erste Antwort mit k-Stimmen-Vorsprung gewinnt.

**Status:** ✅ Vollständig implementiert

**Nachweise:**
- **`src/votingEngine.js:17-76`**: Komplette Voting-Engine
  ```javascript
  async run({ provider, prompt, k, nSamples, redFlagRules = [] }) {
    // ...
    for (let round = 0; round < this.maxRounds; round += 1) {
      for (let sample = 0; sample < nSamples; sample += 1) {
        const output = await provider.generate(prompt);
        const redFlags = this.redFlagger.evaluate(output, redFlagRules);

        if (redFlags.length) continue; // discard and resample

        const votes = (tally.get(output) || 0) + 1;
        tally.set(output, votes);

        const [leader, leaderVotes] = sorted[0];
        const runnerUpVotes = sorted[1]?.[1] || 0;
        leadBy = leaderVotes - runnerUpVotes;

        if (leadBy >= k) {
          return { winner, candidates, leadBy };
        }
      }
    }
  }
  ```
- **Konfigurierbar:** `k` und `nSamples` sind per Task/Step einstellbar (src/types.js:30-31)
- **Max Rounds:** 5 Runden Fallback (votingEngine.js:10)

**Stärken:**
- Exakte Implementierung des MAKER-Algorithmus
- Sequentielle Kandidaten-Sammlung bis k-Margin
- Fallback bei Nicht-Konvergenz (beste Antwort wählen)

**Lücken:**
- ❌ **Sampling-Temperatur nicht konfigurierbar:** Keine UI/API zur Anpassung von Temperature/Top-P
- ❌ **Keine Prompt-Paraphrasierung:** Samples sind identisch (sollten variiert werden für Fehler-Dekorrelation)
- ❌ **Keine Parallelisierung:** Voting läuft sequentiell, nicht parallel (Anforderung: "Voting-Rounds parallelisieren")

---

### 2.3 Red-Flagging ✅ IMPLEMENTIERT

**Anforderung:** Unreliable Outputs (zu lang, falsch formatiert) verwerfen und neu samplen.

**Status:** ✅ Implementiert, aber ausbaufähig

**Nachweise:**
- **`src/redFlagger.js:17-44`**: Red-Flag-Evaluierung
  ```javascript
  evaluate(output, rules = []) {
    const combinedRules = [{ maxChars: DEFAULT_MAX_CHARS }, this.defaultRule, ...rules];
    const redFlags = [];

    for (const rule of combinedRules) {
      if (rule.maxChars && output.length > rule.maxChars) {
        redFlags.push(`too-long:${output.length}`);
      }
      if (rule.maxTokens) { /* ... */ }
      if (rule.requiredRegex && !rule.requiredRegex.test(output)) {
        redFlags.push("missing-required-regex");
      }
      if (rule.requireJson) { /* ... */ }
    }
    return redFlags;
  }
  ```
- **Regeln:** maxChars (default 4000), maxTokens, requiredRegex, requireJson (src/types.js:4-9)
- **Discard & Resample:** votingEngine.js:36-38 verwirft Red-Flagged Candidates

**Stärken:**
- Flexible Regel-Definition per Task/Step
- Default Max-Chars (4000) verhindert zu lange Outputs

**Lücken:**
- ⚠️ **UI fehlt für Red-Flag-Parameter:** Keine Einstellungen in `public/index.html` (Anforderung: "Red-Flag-Parameter im UI anpassbar")
- ❌ **Keine erweiterten Checks:** z.B. syntaktische Code-Validierung, Lint-Check (MAKER-Erweiterung)
- ❌ **Keine Metriken:** Anteil verworfener Samples wird nicht getrackt

---

## 3. Anforderungskatalog: Feature-Compliance

### 3.1 Modellauswahl & API-Management ✅ IMPLEMENTIERT

**Anforderung:** Mehrere LLM-Backends, API-Keys verwalten, lokale Modelle (LM Studio).

**Status:** ✅ Vollständig implementiert

**Nachweise:**
- **Provider:** OpenAI, Claude, Gemini, LM Studio, Echo-Stub (src/providers/*.js)
- **Registry:** `src/llmRegistry.js` verwaltet mehrere Provider
- **Persistenz:** `data/config.json` speichert Provider/Keys (src/server.js:28)
- **UI:** `public/index.html` hat Provider-Management (Zeilen 42-43: Settings-Button)
- **Model Listing:** `listModels()` für UI-Dropdowns (README.md:45-46)

**Lücken:**
- ❌ **Together AI fehlt:** Nicht in `providerFactory.js` (nur OpenAI, Claude, Gemini, LM Studio, Echo)
- ⚠️ **Key-Sicherheit:** Keys werden in Klartext in `data/config.json` gespeichert (keine Verschlüsselung)

---

### 3.2 Projekt- und Arbeitsbereichsmanagement ✅ IMPLEMENTIERT

**Anforderung:** Projektordner-Sandbox, Task-Queue mit Priorität/Pause/Cancel.

**Status:** ✅ Kern implementiert, Task-Priorisierung fehlt

**Nachweise:**
- **ProjectGuard:** `src/projectGuard.js:13-18` validiert Pfade gegen Root
  ```javascript
  resolveSafe(relPath) {
    const full = path.resolve(this.root, relPath);
    if (!full.startsWith(this.root)) {
      throw new Error(`Path escapes project root: ${relPath}`);
    }
    return full;
  }
  ```
- **Workspaces:** Jeder Task bekommt `workspaces/<task-id>/` (src/server.js:114)
- **Task-Queue:** `src/taskQueue.js` (Glob-Ergebnis vorhanden)

**Lücken:**
- ❌ **Task-Priorisierung fehlt:** Queue hat keine `prioritize()` API (Anforderung: "Tasks können priorisiert werden")
- ❌ **Kein UI für Projektordner-Auswahl:** Workspaces werden automatisch erstellt, User kann Ordner nicht wählen
- ⚠️ **Pause/Resume:** Nur bei Command-Approval, kein manuelles Pause (docs/architecture.md:9)

---

### 3.3 Terminal-Ausführung mit Sicherheits-Toggle ✅ IMPLEMENTIERT

**Anforderung:** Commands ausführen, kritische Befehle benötigen Approval, On/Off-Schalter.

**Status:** ✅ Vollständig implementiert

**Nachweise:**
- **CommandRunner:** `src/executionGuard.js:24-40` klassifiziert Commands
  ```javascript
  classify(command) {
    if (this.denylist.some((pattern) => lower.includes(pattern.toLowerCase()))) {
      return { severity: "high", blocked: true };
    }
    if (lower.includes("rm ") || lower.includes("sudo") || lower.includes("drop database")) {
      return { severity: "high" };
    }
    if (lower.startsWith("curl") || lower.startsWith("wget") || lower.includes("http")) {
      return { severity: "med", allowNetwork: true };
    }
    return { severity: "low" };
  }
  ```
- **Safety-Mode:** `ask` (Bestätigung für med/high) vs `auto` (alles ausführen) (src/executionGuard.js:9)
- **Pending-Commands:** `data/pendingCommands.json` persistiert (src/server.js:30)
- **Allow/Deny-Listen:** Konfigurierbar (src/executionGuard.js:11-12, 19-22)

**Stärken:**
- UI-Schalter für Safety-Mode (`/api/settings/safety-mode`)
- Granulare Severity-Klassifikation (low/med/high)
- Persistente Pending-Queue

**Lücken:**
- ⚠️ **Netzwerk-Toggle fehlt:** Kein separater Schalter für `allowNetwork` (Anforderung nicht explizit umgesetzt)

---

### 3.4 Protokollierung & Audit ✅ IMPLEMENTIERT

**Anforderung:** LLM-Calls, Voting, Commands loggen; UI-Darstellung.

**Status:** ✅ Implementiert

**Nachweise:**
- **Audit-Logger:** `src/auditLogger.js` schreibt JSONL zu `data/audit.log` (src/server.js:29)
- **Logging:** Orchestrator loggt Steps/Voting/Commands (src/orchestrator.js:142-148)
- **API:** `/api/logs` liefert Audit-Daten (src/server.js via git show)
- **SSE:** Live-Events über `/api/events` (src/server.js:205-214)

**Lücken:**
- ❌ **Prompts nicht geloggt:** Audit-Log enthält keine vollständigen Prompts (nur Outputs)
- ⚠️ **UI-Audit-View fehlt:** Keine dedizierte Logs-Ansicht in `public/index.html` (nur State/Log-API)

---

### 3.5 Versionierung (Git) ❌ NICHT IMPLEMENTIERT

**Anforderung:** Git-Init pro Projekt, Auto-Commits nach Tasks.

**Status:** ❌ Nicht implementiert

**Nachweise:**
- Keine Git-Integration in `src/orchestrator.js` oder `src/server.js`
- Kein Auto-Commit nach Task-Completion

**Empfehlung:**
```javascript
// In orchestrator.js nach runStep completion:
if (task.status === "completed" && task.autoCommit) {
  await this.gitCommit(task.workspacePath, `Task ${task.id}: ${task.title}`);
}
```

---

### 3.6 Parameter-Tuning ⚠️ TEILWEISE IMPLEMENTIERT

**Anforderung:** Temperature, nSamples, k, Red-Flag-Grenzen im UI.

**Status:** ⚠️ Backend unterstützt, UI fehlt

**Nachweise:**
- **Backend:** `k`, `nSamples`, `redFlags` sind per Task/Step konfigurierbar (src/types.js:30-31, 46-47)
- **UI:** Keine Eingabefelder für diese Parameter in `public/index.html`

**Lücken:**
- ❌ **Kein UI für Tuning:** User kann k/nSamples nicht über UI setzen
- ❌ **Temperature fehlt:** Provider haben keine Sampling-Temperatur-API

---

### 3.7 Parallelisierung ❌ NICHT IMPLEMENTIERT

**Anforderung:** Multiple Mikro-Agenten parallel ausführen.

**Status:** ❌ Nicht implementiert

**Nachweise:**
- `runTaskSequential` (src/server.js:112) führt Steps sequentiell aus:
  ```javascript
  for (const step of task.steps) {
    step.status = "running";
    const result = await orchestrator.runStep(task, step, workspaceGuard);
    // ...
  }
  ```

**Empfehlung:**
```javascript
// Parallel execution für unabhängige Steps:
const independentSteps = task.steps.filter(s => !s.dependsOn);
await Promise.all(independentSteps.map(s => orchestrator.runStep(task, s, workspaceGuard)));
```

---

### 3.8 User-Feedback-Loop ❌ NICHT IMPLEMENTIERT

**Anforderung:** Code-Review-Kommentare als neue Tasks in Queue.

**Status:** ❌ Nicht implementiert

**Nachweise:**
- Keine API/UI für Feedback-Eingabe

---

### 3.9 Ressourcen-Monitoring ❌ NICHT IMPLEMENTIERT

**Anforderung:** API-Kosten, Token-Verbrauch, CPU/RAM bei lokalen Modellen.

**Status:** ❌ Nicht implementiert

**Nachweise:**
- Keine Token-Zählung in Providern
- Keine Kosten-Schätzung

---

## 4. Zusätzliche Architektur-Stärken

### 4.1 SSE Live-Events ✅
- Real-Time Updates über `/api/events` (src/server.js:205-214)
- Event-Types: `step-start`, `step-completed`, `command-output`, etc.

### 4.2 Dry-Run für File-Writes ✅
- `ProjectGuard.writeFile(..., { dryRun: true })` (src/projectGuard.js:37)
- Diff-Preview via `/api/tasks/preview-diff`

### 4.3 Modular Provider-Architektur ✅
- Factory-Pattern (`providerFactory.js`)
- Einfache Erweiterung um neue LLMs

### 4.4 Persistenz ✅
- Config, Audit-Logs, Pending-Commands, Tasks überleben Restarts
- `data/config.json`, `data/audit.log`, `data/pendingCommands.json`, `data/tasks.json`

---

## 5. Kritische Empfehlungen (Priorität)

### Hoch (Must-Have für Production)
1. **UI für Parameter-Tuning:** Eingabefelder für `k`, `nSamples`, Temperature, Red-Flag-Regeln
2. **Prompt-Paraphrasierung:** Varianz in Voting-Samples für Fehler-Dekorrelation (MAKER-Kernempfehlung)
3. **Versionierung:** Git-Integration für Auto-Commits nach Tasks
4. **Ressourcen-Monitoring:** Token-Zählung und Kosten-Schätzung
5. **Key-Verschlüsselung:** API-Keys nicht in Klartext speichern

### Mittel (Nice-to-Have)
6. **Parallelisierung:** Unabhängige Steps parallel ausführen
7. **Insights-Agenten:** Strategische Agenten für komplexe Entscheidungen
8. **User-Feedback-Loop:** Code-Review → neue Tasks
9. **UI-Audit-View:** Dedizierte Logs/History-Ansicht
10. **Together AI Provider:** Erweiterung der Provider-Liste

### Niedrig (Optimierungen)
11. **Red-Flag-Metriken:** Anteil verworfener Samples tracken
12. **Extended Red-Flagging:** Syntaktische Code-Validierung (Linter)
13. **Task-Priorisierung:** UI/API für Queue-Reordering
14. **Netzwerk-Toggle:** Separater Schalter für Network-Commands

---

## 6. MAKER-Paper Alignment: Score

| Kriterium | Implementiert | Score |
|-----------|---------------|-------|
| **MAD (Maximal Agentic Decomposition)** | ✅ Ja | 9/10 |
| **First-to-lead-by-k Voting** | ✅ Ja | 8/10 |
| **Red-Flagging** | ✅ Ja, ausbaufähig | 7/10 |
| **Zustandslosigkeit** | ✅ Ja | 10/10 |
| **Fehler-Dekorrelation (Paraphrasierung)** | ❌ Nein | 0/10 |
| **Modularität (Provider/Guard)** | ✅ Ja | 10/10 |
| **Logging/Audit** | ✅ Ja | 8/10 |
| **Sicherheit (Sandbox/Commands)** | ✅ Ja | 9/10 |
| **UI-Konfigurierbarkeit** | ⚠️ Teilweise | 4/10 |
| **Erweiterte Features (Git, Monitoring)** | ❌ Nein | 2/10 |

**Gesamt-Score: 67/100**

---

## 7. Fazit

**Ultracode erfüllt die Kern-MAKER-Prinzipien hervorragend:**
- ✅ Radikale Zerlegung in atomare Steps
- ✅ Voting-Engine mit k-Margin
- ✅ Red-Flagging und Discard-&-Resample
- ✅ Zustandslose Mikro-Agenten
- ✅ Robuste Sicherheits-Guardrails

**Kritische Lücken für Production-Reife:**
1. Prompt-Paraphrasierung fehlt (Kernempfehlung aus MAKER-Paper)
2. Kein UI für Parameter-Tuning (k, nSamples, Temperature)
3. Keine Git-Versionierung
4. Keine Ressourcen-/Kosten-Überwachung
5. API-Keys unverschlüsselt

**Empfehlung:** Das Projekt hat ein solides Fundament. Mit den oben genannten High-Priority-Features wird es ein vollständiges, produktionsreifes MAKER-Tool.

---

**Ende des Reports**
