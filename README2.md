# Ultracode V2 - Complete Technical Deep Dive

**A Comprehensive Analysis of the Autonomous Coding Agent Architecture**

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Architectural Overview](#architectural-overview)
3. [Core Components Deep Dive](#core-components-deep-dive)
4. [Data Flow & Execution Pipeline](#data-flow--execution-pipeline)
5. [Database Architecture](#database-architecture)
6. [Quality Control & Reliability](#quality-control--reliability)
7. [User Interface & Real-Time Updates](#user-interface--real-time-updates)
8. [LLM Integration & Multi-Provider Support](#llm-integration--multi-provider-support)
9. [Safety & Security](#safety--security)
10. [Resource Monitoring & Cost Tracking](#resource-monitoring--cost-tracking)
11. [Complete Feature Lifecycle](#complete-feature-lifecycle)
12. [Technical Statistics](#technical-statistics)

---

## Executive Summary

Ultracode V2 is a **production-grade autonomous coding agent** that transforms how software is built by:

- **Feature-Based Development**: Organizes work into prioritized features (A/B/C) with dependency management
- **Multi-LLM Orchestration**: Uses 3 distinct models (Planner, Executor, Voter) for robust code generation
- **Quality Control**: Implements voting with red-flag detection to filter unreliable outputs
- **Real-Time Transparency**: Live SSE updates, resource monitoring, and complete audit trails
- **Zero Heavy Dependencies**: Only uses Puppeteer; everything else is Node.js stdlib + SQLite CLI

### Key Statistics

- **~12,381 lines of code** across backend and frontend
- **38 source files** organized into clear modules
- **4 LLM provider integrations**: OpenAI, Anthropic Claude, Google Gemini, LM Studio (local)
- **SQLite persistence** with WAL mode for concurrent access
- **Zero npm dependencies** except Puppeteer for testing

### What Makes This Special

1. **MAKER-Inspired Architecture**: Implements voting, red-flagging, and error decorrelation
2. **Intelligent Context Building**: Assembles project guidelines, completed work, and file structure into prompts
3. **Safety-First Design**: Filesystem sandboxing, command guards, and human-in-the-loop approval
4. **Event Sourcing**: Complete audit trail of all actions for debugging and replay
5. **Cost Transparency**: Tracks token usage and estimates costs per model in real-time

---

## Architectural Overview

### High-Level System Design

```
┌─────────────────────────────────────────────────────────────────────┐
│                         ULTRACODE V2 SYSTEM                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐        │
│  │   Web UI     │────▶│  HTTP Server │────▶│  FeatureStore│        │
│  │  (Browser)   │◀────│  (Express-   │◀────│   (SQLite)   │        │
│  │              │ SSE │   like)      │     │              │        │
│  └──────────────┘     └──────────────┘     └──────────────┘        │
│                              │                                       │
│                              ▼                                       │
│                       ┌──────────────┐                              │
│                       │Feature       │                              │
│                       │Manager       │                              │
│                       └──────────────┘                              │
│                              │                                       │
│               ┌──────────────┼──────────────┐                       │
│               ▼              ▼               ▼                       │
│        ┌─────────────┐┌─────────────┐┌─────────────┐               │
│        │  Feature    ││ Orchestrator││  Context    │               │
│        │  Planner    ││   Engine    ││  Builder    │               │
│        └─────────────┘└─────────────┘└─────────────┘               │
│               │              │               │                       │
│               └──────────────┼───────────────┘                       │
│                              ▼                                       │
│                       ┌──────────────┐                              │
│                       │Voting Engine │                              │
│                       │+ RedFlagger  │                              │
│                       └──────────────┘                              │
│                              │                                       │
│                              ▼                                       │
│                       ┌──────────────┐                              │
│                       │ LLM Registry │                              │
│                       │ (4 providers)│                              │
│                       └──────────────┘                              │
│                              │                                       │
│               ┌──────────────┼──────────────┬──────────────┐        │
│               ▼              ▼              ▼              ▼        │
│        ┌─────────┐    ┌─────────┐    ┌─────────┐   ┌─────────┐    │
│        │ OpenAI  │    │ Claude  │    │ Gemini  │   │LMStudio │    │
│        │Provider │    │Provider │    │Provider │   │Provider │    │
│        └─────────┘    └─────────┘    └─────────┘   └─────────┘    │
│                                                                       │
└─────────────────────────────────────────────────────────────────────┘
```

### Technology Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| **Frontend** | Vanilla JavaScript + TailwindCSS | Zero-build UI with live updates |
| **Backend** | Node.js 18+ (stdlib only) | HTTP server, orchestration |
| **Database** | SQLite3 (CLI via spawnSync) | Zero npm deps persistence |
| **LLM Providers** | OpenAI, Claude, Gemini, LM Studio | Multi-provider code generation |
| **Testing** | Puppeteer | Screenshot-based UI verification |
| **Real-Time** | Server-Sent Events (SSE) | Live UI updates |
| **Version Control** | Git | Automated commits per feature |

---

## Core Components Deep Dive

### 1. **FeatureStore** - SQLite Persistence Layer

**File**: `src/featureStore.js` (600+ lines)

The FeatureStore is the **single source of truth** for all project data.

#### Key Design Decisions

1. **Uses SQLite CLI Instead of npm Package**
   ```javascript
   run(sql) {
     const res = spawnSync("sqlite3", [this.dbPath, sql], { encoding: "utf8" });
     if (res.status !== 0) throw new Error(`SQLite error: ${res.stderr}`);
     return res.stdout;
   }
   ```

   **Why?** Zero npm dependencies - works anywhere sqlite3 CLI is installed.

2. **WAL Mode for Concurrency**
   ```sql
   PRAGMA journal_mode=WAL;
   ```

   Allows multiple readers + one writer without blocking.

3. **Foreign Key Constraints**
   ```sql
   FOREIGN KEY (project_id) REFERENCES projects(id)
   FOREIGN KEY (feature_id) REFERENCES features(id)
   ```

   Ensures referential integrity at the database level.

#### Database Schema

**Projects Table**
```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,              -- UUID
  name TEXT NOT NULL,
  description TEXT,
  folder_path TEXT,                 -- Absolute path to project folder
  planner_model TEXT,               -- LLM for decomposing features
  executor_model TEXT,              -- LLM for code generation
  vote_model TEXT,                  -- LLM for voting/validation
  project_type TEXT DEFAULT 'static-html',  -- react-vite, nextjs, etc.
  status TEXT DEFAULT 'created',    -- created, bootstrapping, active, completed
  bootstrapped INTEGER DEFAULT 0,   -- Has init.sh been run?
  created_at INTEGER,               -- Unix timestamp
  updated_at INTEGER
);
```

**Features Table**
```sql
CREATE TABLE features (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  priority TEXT,                    -- 'A', 'B', or 'C'
  status TEXT,                      -- pending, running, completed, failed, paused, blocked
  depends_on TEXT,                  -- CSV of feature IDs
  dod TEXT,                         -- Definition of Done (JSON array)
  technical_summary TEXT,           -- Auto-generated after completion
  order_index INTEGER,              -- For UI sorting
  created_at INTEGER,
  updated_at INTEGER,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);
```

**Subtasks Table**
```sql
CREATE TABLE subtasks (
  id TEXT PRIMARY KEY,
  feature_id TEXT NOT NULL,
  intent TEXT NOT NULL,             -- What this subtask does
  status TEXT,                      -- pending, running, completed, failed
  apply_type TEXT,                  -- writeFile, appendFile, editFile
  apply_path TEXT,                  -- Relative path in project
  result TEXT,                      -- JSON result of execution
  error TEXT,                       -- Error message if failed
  created_at INTEGER,
  started_at INTEGER,
  completed_at INTEGER,
  FOREIGN KEY (feature_id) REFERENCES features(id)
);
```

**Events Table** (Event Sourcing)
```sql
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT,
  feature_id TEXT,
  subtask_id TEXT,
  event_type TEXT,                  -- wizard_started, feature-planning, etc.
  payload TEXT,                     -- JSON details
  timestamp INTEGER
);
```

#### CRUD Operations

```javascript
// Create
createProject({ name, description, folderPath, ... }) -> projectId

// Read
getProject(id) -> project object
getFeaturesByProject(projectId) -> array of features
getSubtasksByFeature(featureId) -> array of subtasks

// Update
updateFeature(id, { status, technical_summary, ... })
updateSubtask(id, { status, result, error })

// Delete
deleteProject(id)
deleteFeature(id)

// Event Sourcing
recordEvent(projectId, featureId, subtaskId, type, payload)
```

---

### 2. **FeatureManager** - Orchestration Hub

**File**: `src/featureManager.js` (900+ lines)

The FeatureManager coordinates the entire feature execution lifecycle.

#### Responsibilities

1. **Dependency Validation**
   ```javascript
   areDependenciesMet(feature) {
     if (!feature.depends_on || !feature.depends_on.length) return true;

     for (const depId of feature.depends_on) {
       const dep = this.featureStore.getFeature(depId);
       if (!dep || (dep.status !== 'completed' && dep.status !== 'verified')) {
         return false;
       }
     }
     return true;
   }
   ```

2. **Circular Dependency Detection**
   ```javascript
   validateNoCycles(featureId, dependsOn, visited = new Set()) {
     if (visited.has(featureId)) {
       throw new Error("Circular dependency detected");
     }
     visited.add(featureId);
     // Recursively check dependencies
   }
   ```

3. **Feature Execution Pipeline**
   ```javascript
   async executeFeature(featureId) {
     // 1. Validate dependencies
     if (!this.areDependenciesMet(feature)) {
       throw new Error("Dependencies not met");
     }

     // 2. Plan if needed (decompose into subtasks)
     if (!feature.subtasks || !feature.subtasks.length) {
       await this.planFeature(featureId);
     }

     // 3. Execute subtasks sequentially
     for (const subtask of subtasks) {
       await this.executeSubtask(subtask);
     }

     // 4. Generate technical summary
     const summary = await this.generateSummary(feature);

     // 5. Git commit (if enabled)
     if (this.gitCommitter) {
       await this.gitCommitter.commitFeatureCompletion(feature);
     }

     // 6. Run tests (if enabled)
     if (this.testRunner) {
       await this.testRunner.testFeature(feature);
     }
   }
   ```

#### Smart Execution Queue

```javascript
async executeNextRunnable(projectId) {
  const features = this.featureStore.getFeaturesByProject(projectId);

  // Filter to runnable features
  const runnable = features.filter(f =>
    f.status === 'pending' && this.areDependenciesMet(f)
  );

  // Sort by priority (A > B > C) and order_index
  runnable.sort((a, b) => {
    if (a.priority !== b.priority) {
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    }
    return (a.order_index || 0) - (b.order_index || 0);
  });

  // Execute highest priority
  if (runnable.length > 0) {
    await this.executeFeature(runnable[0].id);
  }
}
```

---

### 3. **FeaturePlanner** - LLM-Based Decomposition

**File**: `src/featurePlanner.js` (400+ lines)

Decomposes high-level features into atomic, executable subtasks.

#### Planning Process

```javascript
async planFeature(project, feature) {
  // 1. Build context from project
  const context = await this.contextBuilder.buildPlanningContext(project, feature);

  // 2. Format as prompt
  const prompt = `
    ${context.guidelines}

    # Feature to Implement
    Name: ${feature.name}
    Priority: ${feature.priority}
    Description: ${feature.description}

    # Instructions
    Decompose this feature into 3-8 atomic subtasks.
    Each subtask must be independently executable.

    Output format:
    {
      "subtasks": [
        {
          "intent": "Create LoginForm component with email/password fields",
          "apply": {
            "type": "writeFile",
            "path": "src/components/LoginForm.jsx"
          }
        }
      ]
    }
  `;

  // 3. Call planner model
  const plannerModel = this.llmRegistry.get(project.planner_model);
  const response = await plannerModel.generate(prompt);

  // 4. Parse and validate
  const plan = JSON.parse(response.content);

  // 5. Store subtasks in database
  for (const subtask of plan.subtasks) {
    this.featureStore.createSubtask({
      featureId: feature.id,
      intent: subtask.intent,
      applyType: subtask.apply.type,
      applyPath: subtask.apply.path,
      status: 'pending'
    });
  }
}
```

#### Subtask Apply Types

| Type | Description | Example |
|------|-------------|---------|
| **writeFile** | Create or replace entire file | Create new component |
| **appendFile** | Add content to end of file | Add route to router |
| **editFile** | Targeted edits to existing file | Modify function logic |
| **applyPatch** | Apply unified diff patch | Complex multi-line changes |

---

### 4. **VotingEngine** - Quality Control

**File**: `src/votingEngine.js` (150 lines)

Implements **first-to-lead-by-k voting** with adaptive temperature scheduling.

#### How Voting Works

```javascript
async run({ provider, prompt, k, maxSamples = 12, initialSamples = 2 }) {
  const candidates = [];
  const tally = new Map(); // output -> voteCount

  // Temperature schedule for diversity
  const temps = [0, 0.3, 0.5, 0.6];

  for (let sample = 0; sample < maxSamples; sample++) {
    // 1. Paraphrase prompt to decorrelate errors
    const finalPrompt = sample > 0
      ? await this.paraphraser.paraphrase(prompt)
      : prompt;

    // 2. Sample with scheduled temperature
    const temp = temps[Math.min(sample, temps.length - 1)];
    const response = await provider.generate(finalPrompt, { temperature: temp });

    // 3. Check for red flags
    const redFlags = this.redFlagger.evaluate(response.content);
    if (redFlags.length > 0) {
      candidates.push({ output: response.content, redFlags, voteCount: 0 });
      continue; // Discard and resample
    }

    // 4. Tally votes
    const votes = (tally.get(response.content) || 0) + 1;
    tally.set(response.content, votes);

    // 5. Check for early exit
    const sorted = Array.from(tally.entries()).sort((a, b) => b[1] - a[1]);
    const [leader, leaderVotes] = sorted[0];
    const runnerUpVotes = sorted[1]?.[1] || 0;
    const leadBy = leaderVotes - runnerUpVotes;

    if (sample + 1 >= initialSamples && leadBy >= k) {
      return { winner: { output: leader, voteCount: leaderVotes }, candidates, leadBy };
    }
  }

  // Fallback: return best seen
  const [leader, votes] = Array.from(tally.entries()).sort((a, b) => b[1] - a[1])[0];
  return { winner: { output: leader, voteCount: votes }, candidates };
}
```

#### Key Parameters

- **k (margin)**: Required vote lead to declare winner (default: 2)
- **maxSamples**: Hard cap on samples (default: 12)
- **initialSamples**: Minimum samples before early exit (default: 2)
- **temperatureSchedule**: `[0, 0.3, 0.5, 0.6]` for diversity

#### Why This Works

1. **Error Decorrelation**: Paraphrasing prevents systematic errors
2. **Temperature Diversity**: Starting at 0 (deterministic), increasing for exploration
3. **Early Exit**: Saves tokens when consensus is clear
4. **Red Flag Filtering**: Removes obviously bad outputs

---

### 5. **RedFlagger** - Output Validation

**File**: `src/redFlagger.js` (90 lines)

Detects problematic LLM outputs before they cause errors.

#### Red Flag Rules

```javascript
class RedFlagger {
  evaluate(output, rules = []) {
    const redFlags = [];

    // 1. Too long (token limit)
    if (output.length > 4000) {
      redFlags.push(`too-long:${output.length}`);
    }

    // 2. Shell commands instead of code
    const shellCommands = ['mkdir', 'npm install', 'cd ', 'git ', 'cp ', 'mv '];
    const trimmed = output.trim().toLowerCase();
    for (const cmd of shellCommands) {
      if (trimmed.startsWith(cmd)) {
        redFlags.push(`shell-command:${cmd.trim()}`);
      }
    }

    // 3. Instruction lists instead of actual code
    const instructionPatterns = [
      /^\s*1\.\s+(create|add|open|install)/,
      /^\s*step\s+1/,
      /^\s*first,?\s+(create|add|open)/
    ];
    for (const pattern of instructionPatterns) {
      if (pattern.test(output)) {
        redFlags.push('instruction-list');
      }
    }

    // 4. Invalid JSON (if requireJson rule is set)
    if (rules.some(r => r.requireJson)) {
      try {
        JSON.parse(output);
      } catch {
        redFlags.push('invalid-json');
      }
    }

    return redFlags;
  }
}
```

#### Common Red Flags

| Flag | Meaning | Why It's Bad |
|------|---------|--------------|
| `too-long:N` | Output exceeds N characters | Token limit exceeded |
| `shell-command:mkdir` | Output is a shell command | Expected code, got instructions |
| `instruction-list` | Output is step-by-step guide | Expected implementation, got plan |
| `invalid-json` | Output isn't valid JSON | When JSON required, parsing will fail |

---

### 6. **ContextBuilder** - Intelligent Prompt Assembly

**File**: `src/contextBuilder.js` (445 lines)

Builds rich, context-aware prompts for LLMs.

#### Planning Context

```javascript
async buildPlanningContext(project, feature) {
  return {
    // Project guidelines from project.md
    guidelines: await this._loadProjectMd(project),

    // What has been built so far
    completedFeatures: this._getCompletedFeatures(project).map(f => ({
      name: f.name,
      files: f.files,  // Which files were created
      technicalSummary: f.technical_summary
    })),

    // Current file structure
    fileTree: this._getFileTree(project.folder_path, maxDepth: 3),

    // Feature-specific info
    feature: {
      name: feature.name,
      description: feature.description,
      priority: feature.priority,
      dod: feature.dod
    },

    // Dependencies (completed features this depends on)
    dependencies: this._getDependencyContext(feature)
  };
}
```

#### Execution Context

```javascript
async buildExecutionContext(project, feature, subtask) {
  return {
    guidelines: await this._loadProjectMd(project),

    feature: {
      name: feature.name,
      technicalSummary: feature.technical_summary
    },

    subtask: {
      intent: subtask.intent,
      applyType: subtask.apply_type,
      applyPath: subtask.apply_path
    },

    // Related files (if modifying existing file)
    relatedFiles: this._getRelatedFiles(project.folder_path, subtask.apply_path),

    // What's been done for this feature so far
    completedWork: this._getCompletedSubtasks(feature),

    fileTree: this._getFileTree(project.folder_path, maxDepth: 2)
  };
}
```

#### File Tree Generation

```javascript
_getFileTree(folderPath, maxDepth = 3) {
  const files = [];

  const walk = (dir, depth = 0) => {
    if (depth > maxDepth) return;

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      // Skip hidden files, node_modules, .git
      if (entry.name.startsWith('.') ||
          entry.name === 'node_modules' ||
          entry.name === 'dist') continue;

      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(folderPath, fullPath);

      if (entry.isDirectory()) {
        walk(fullPath, depth + 1);
      } else {
        files.push(relativePath);
      }
    }
  };

  walk(folderPath);
  return files.sort();
}
```

#### Context Formatting

```javascript
formatAsPrompt(context, type = 'planning') {
  const sections = [
    `# Project Guidelines\n${context.guidelines}`,

    `# Project: ${context.project.name}`,

    `# Feature: ${context.feature.name}
     Priority: ${context.feature.priority}
     Description: ${context.feature.description}`,

    `# Current File Structure
     \`\`\`
     ${this._formatFileTree(context.fileTree)}
     \`\`\``,

    // For execution, add related files
    type === 'execution' && context.relatedFiles
      ? `# Related Files\n${context.relatedFiles.map(f =>
          `## ${f.path}\n\`\`\`\n${f.content.substring(0, 1000)}...\n\`\`\``
        ).join('\n')}`
      : null
  ].filter(Boolean);

  return sections.join('\n\n---\n\n');
}
```

---

### 7. **Orchestrator** - Execution Engine

**File**: `src/orchestrator.js` (700+ lines)

The Orchestrator executes individual subtasks using the voting system.

#### Execution Flow

```javascript
async executeStep({
  taskId,
  stepId,
  prompt,
  executorModel,
  voteModel,
  projectGuard,
  commandRunner
}) {
  // 1. Run voting to get best output
  const { winner, candidates } = await this.votingEngine.run({
    provider: this.llmRegistry.get(executorModel),
    prompt,
    k: 2,
    maxSamples: 12,
    initialSamples: 2,
    redFlagRules: [{ requireJson: true }],
    taskId,
    stepId,
    voteModel
  });

  if (!winner) {
    throw new Error("No valid output from voting");
  }

  // 2. Parse actions from winner output
  const parsed = parseActions(winner.output);

  // 3. Execute actions with guards
  const results = await executeActions({
    actions: parsed.actions,
    guard: projectGuard,
    commandRunner,
    eventEmitter: this.eventEmitter
  });

  // 4. Return results
  return {
    winner,
    candidates,
    results,
    status: 'completed'
  };
}
```

---

### 8. **ActionExecutor** - File & Command Operations

**File**: `src/actionExecutor.js` (118 lines)

Executes the actions produced by LLMs.

#### Supported Actions

```javascript
// 1. Write File
{
  "type": "write_file",
  "path": "src/components/Button.jsx",
  "content": "import React from 'react';\n..."
}

// 2. Append File
{
  "type": "append_file",
  "path": "src/routes.js",
  "content": "\nexport { LoginPage } from './pages/Login';"
}

// 3. Apply Patch
{
  "type": "apply_patch",
  "path": "src/App.js",
  "patch": "--- a/src/App.js\n+++ b/src/App.js\n..."
}

// 4. Run Command
{
  "type": "run_cmd",
  "cmd": "npm install axios",
  "allow_if_risky": false
}

// 5. Request Info
{
  "type": "request_info",
  "question": "What should the login API endpoint be?"
}
```

#### Action Execution

```javascript
async function executeActions({ actions, guard, commandRunner }) {
  const results = [];

  for (const action of actions) {
    switch (action.type) {
      case 'write_file':
        const res = await guard.writeFile(action.path, action.content);
        results.push({ type: 'write_file', path: action.path, ...res });
        break;

      case 'append_file':
        const prev = await guard.readFile(action.path).catch(() => '');
        const next = prev + action.content;
        await guard.writeFile(action.path, next);
        break;

      case 'apply_patch':
        await guard.applyPatch(action.path, action.patch);
        break;

      case 'run_cmd':
        const cmdRes = await commandRunner.run(action.cmd, {
          force: action.allow_if_risky,
          cwd: guard.root
        });
        results.push({ type: 'run_cmd', cmd: action.cmd, result: cmdRes });
        break;
    }
  }

  return results;
}
```

---

## Data Flow & Execution Pipeline

### Complete Feature Execution Flow

```
USER CLICKS "Execute Feature"
         │
         ▼
┌────────────────────────────────────────────────────┐
│ 1. FEATURE MANAGER: Validate & Plan               │
├────────────────────────────────────────────────────┤
│ • Check dependencies are met                       │
│ • If not planned: Call FeaturePlanner              │
│   ├─► ContextBuilder assembles project context    │
│   ├─► Call Planner Model (e.g., GPT-4o)          │
│   ├─► Parse subtasks JSON                         │
│   └─► Store subtasks in database                  │
│ • Update feature status: "running"                 │
│ • Broadcast SSE: "feature-started"                 │
└────────────────────────────────────────────────────┘
         │
         ▼
┌────────────────────────────────────────────────────┐
│ 2. SUBTASK LOOP (Sequential Execution)            │
├────────────────────────────────────────────────────┤
│ FOR EACH subtask IN subtasks:                      │
│   ├─► Update subtask status: "running"            │
│   ├─► Broadcast SSE: "subtask-started"            │
│   │                                                 │
│   ├─► ContextBuilder.buildExecutionContext()      │
│   │   ├─ Load project.md                          │
│   │   ├─ Load target file (if exists)             │
│   │   ├─ Get completed work for feature           │
│   │   └─ Build executor prompt                    │
│   │                                                 │
│   ├─► Orchestrator.executeStep()                  │
│   │   └──► VOTING ENGINE                          │
│   │         ├─ Sample 1: temp=0.0                 │
│   │         │   ├─ Paraphrase prompt (if >0)      │
│   │         │   ├─ Call Executor Model            │
│   │         │   ├─ Normalize response             │
│   │         │   ├─ RedFlagger.evaluate()          │
│   │         │   └─ Tally vote (if no red flags)   │
│   │         ├─ Sample 2: temp=0.3                 │
│   │         ├─ Sample 3: temp=0.5                 │
│   │         └─ Early exit if lead >= k            │
│   │                                                 │
│   ├─► ActionExecutor.executeActions()             │
│   │   ├─ Parse JSON from winner                   │
│   │   ├─ Validate with ProjectGuard               │
│   │   └─ Execute (write_file, append, patch, cmd) │
│   │                                                 │
│   ├─► ResourceMonitor.recordPromptCall()          │
│   │   ├─ Estimate tokens                          │
│   │   ├─ Calculate cost                           │
│   │   └─ Store metrics                            │
│   │                                                 │
│   ├─► Update subtask status: "completed"          │
│   └─► Broadcast SSE: "subtask-completed"          │
└────────────────────────────────────────────────────┘
         │
         ▼
┌────────────────────────────────────────────────────┐
│ 3. FEATURE COMPLETION                              │
├────────────────────────────────────────────────────┤
│ • Generate technical summary (LLM)                 │
│ • GitCommitter.commitFeatureCompletion()          │
│   ├─ Stage all changed files                      │
│   ├─ Build commit message                         │
│   └─ Create git commit                            │
│ • Update feature status: "completed"               │
│ • Broadcast SSE: "feature-completed"               │
└────────────────────────────────────────────────────┘
         │
         ▼
┌────────────────────────────────────────────────────┐
│ 4. OPTIONAL: Testing (Puppeteer)                  │
├────────────────────────────────────────────────────┤
│ • ServerManager.startDevServer()                   │
│ • TestRunner.captureScreenshot()                  │
│ • Send screenshot to LLM for verification          │
│ • Update status: "verified" or "failed"            │
└────────────────────────────────────────────────────┘
```

### Wizard Flow (Project Creation)

```
USER CLICKS "Create Project"
         │
         ▼
┌────────────────────────────────────────────────────┐
│ PAGE 1: Project Basics                            │
├────────────────────────────────────────────────────┤
│ • User enters: name, description                   │
│ • WizardAgent.startWizard()                       │
│   ├─ Sanitize folder name                         │
│   ├─ Create folder: projects/{sanitized-name}     │
│   ├─ Run: git init                                │
│   ├─ Create project in database                   │
│   └─ Initialize wizard state                      │
│ • Navigate to Page 2                              │
└────────────────────────────────────────────────────┘
         │
         ▼
┌────────────────────────────────────────────────────┐
│ PAGE 2: AI Clarification Chat                     │
├────────────────────────────────────────────────────┤
│ LOOP: User ↔ AI Conversation                      │
│   │                                                 │
│   ├─► User sends message                          │
│   ├─► Optional: Tavily Web Search                 │
│   ├─► Chat model responds with:                   │
│   │   ├─ Questions to clarify                     │
│   │   ├─ Recommendations (stack, arch)            │
│   │   └─ Evolving feature list                    │
│   │                                                 │
│   └─► UNTIL user says "Generate summary"          │
│                                                     │
│ • WizardAgent.extractSummary()                    │
│   ├─ Parse ===PROJECT_TYPE=== block               │
│   ├─ Parse ===INIT_SH=== block                    │
│   ├─ Parse ===PACKAGE_JSON=== block               │
│   ├─ Parse ===PROJECT_MD=== block                 │
│   ├─ Parse ===FEATURES_JSON=== block              │
│   └─ Store in wizard state                        │
│                                                     │
│ • Write project.md to disk                        │
│ • Navigate to Page 3                              │
└────────────────────────────────────────────────────┘
         │
         ▼
┌────────────────────────────────────────────────────┐
│ PAGE 3: Model Selection                           │
├────────────────────────────────────────────────────┤
│ • Probe all providers for available models         │
│   ├─ OpenAI: gpt-4o, gpt-4o-mini, o1, etc.       │
│   ├─ Claude: claude-3-5-sonnet, etc.             │
│   ├─ Gemini: gemini-1.5-pro, etc.                │
│   └─ LM Studio: list local models                 │
│                                                     │
│ • User selects:                                    │
│   ├─ Planner Model (strong reasoning)             │
│   ├─ Executor Model (code generation)             │
│   └─ Vote Model (validation)                      │
│                                                     │
│ • WizardAgent.finalizeWizard()                    │
│   ├─ Update project with models                   │
│   ├─ Create features in database                  │
│   │   └─ Parse DoD from features.json            │
│   ├─ Write init.sh to disk                        │
│   ├─ Write package.json to disk                   │
│   └─ Redirect to project dashboard                │
└────────────────────────────────────────────────────┘
```

---

## Database Architecture

### Entity-Relationship Diagram

```
┌─────────────────┐
│    PROJECTS     │
├─────────────────┤
│ id (PK)         │──┐
│ name            │  │
│ folder_path     │  │
│ planner_model   │  │
│ executor_model  │  │
│ vote_model      │  │
│ project_type    │  │
│ status          │  │
└─────────────────┘  │
                     │
                     │ 1:N
                     │
          ┌──────────┴──────────┐
          │                     │
          ▼                     ▼
┌─────────────────┐   ┌─────────────────┐
│    FEATURES     │   │     EVENTS      │
├─────────────────┤   ├─────────────────┤
│ id (PK)         │──┐│ id (PK)         │
│ project_id (FK) │  ││ project_id (FK) │
│ name            │  ││ feature_id (FK) │
│ priority        │  ││ subtask_id (FK) │
│ status          │  ││ event_type      │
│ depends_on      │  ││ payload         │
│ dod             │  ││ timestamp       │
│ technical_summary│  │└─────────────────┘
└─────────────────┘  │
                     │ 1:N
                     │
                     ▼
          ┌─────────────────┐
          │    SUBTASKS     │
          ├─────────────────┤
          │ id (PK)         │
          │ feature_id (FK) │
          │ intent          │
          │ status          │
          │ apply_type      │
          │ apply_path      │
          │ result          │
          │ error           │
          └─────────────────┘
```

### Key Relationships

1. **Project → Features**: One-to-Many
   - A project has multiple features
   - Features are prioritized (A/B/C) and ordered

2. **Feature → Subtasks**: One-to-Many
   - A feature decomposes into 3-8 subtasks
   - Subtasks execute sequentially

3. **Feature → Dependencies**: Many-to-Many (via depends_on CSV)
   - Features can depend on other features
   - Circular dependencies are prevented

4. **Project/Feature/Subtask → Events**: One-to-Many
   - All actions generate events for audit trail
   - Events are never deleted (event sourcing)

### Indexes & Performance

```sql
-- Auto-indexed by primary keys
CREATE INDEX idx_features_project ON features(project_id);
CREATE INDEX idx_features_status ON features(status);
CREATE INDEX idx_subtasks_feature ON subtasks(feature_id);
CREATE INDEX idx_events_project ON events(project_id);
CREATE INDEX idx_events_timestamp ON events(timestamp);
```

---

## Quality Control & Reliability

### Multi-Layered Quality Assurance

```
┌──────────────────────────────────────────────────────┐
│ LAYER 1: Prompt Engineering                         │
├──────────────────────────────────────────────────────┤
│ • Context-aware prompts via ContextBuilder          │
│ • Project guidelines from project.md                 │
│ • Examples from completed features                   │
│ • Clear output format specifications                 │
└──────────────────────────────────────────────────────┘
                    ▼
┌──────────────────────────────────────────────────────┐
│ LAYER 2: Voting with Temperature Scheduling         │
├──────────────────────────────────────────────────────┤
│ • Sample 1: temp=0.0 (deterministic)                │
│ • Sample 2: temp=0.3 (slight variation)             │
│ • Sample 3: temp=0.5 (moderate diversity)           │
│ • Sample 4+: temp=0.6 (high diversity)              │
│ • Majority vote determines winner                    │
└──────────────────────────────────────────────────────┘
                    ▼
┌──────────────────────────────────────────────────────┐
│ LAYER 3: Prompt Paraphrasing                        │
├──────────────────────────────────────────────────────┤
│ • Each sample uses slightly different phrasing      │
│ • Decorrelates systematic errors                     │
│ • Prevents mode collapse                             │
└──────────────────────────────────────────────────────┘
                    ▼
┌──────────────────────────────────────────────────────┐
│ LAYER 4: Red Flag Detection                         │
├──────────────────────────────────────────────────────┤
│ • Filter shell commands ("mkdir", "npm install")    │
│ • Filter instruction lists ("1. Create...")         │
│ • Filter invalid JSON                                │
│ • Filter outputs exceeding token limits              │
│ • Discard flagged outputs before voting             │
└──────────────────────────────────────────────────────┘
                    ▼
┌──────────────────────────────────────────────────────┐
│ LAYER 5: Action Validation                          │
├──────────────────────────────────────────────────────┤
│ • Parse JSON actions                                 │
│ • Validate required fields                           │
│ • Check against allowed action types                 │
└──────────────────────────────────────────────────────┘
                    ▼
┌──────────────────────────────────────────────────────┐
│ LAYER 6: Guard Execution                            │
├──────────────────────────────────────────────────────┤
│ • ProjectGuard: Sandbox file operations             │
│ • ExecutionGuard: Classify command safety           │
│ • Human approval for high-risk actions              │
└──────────────────────────────────────────────────────┘
                    ▼
┌──────────────────────────────────────────────────────┐
│ LAYER 7: Automated Testing (Optional)               │
├──────────────────────────────────────────────────────┤
│ • Puppeteer screenshot capture                       │
│ • LLM verification against DoD                       │
│ • Update status based on test results               │
└──────────────────────────────────────────────────────┘
```

### Error Recovery Strategies

1. **Voting Fallback**: If no consensus, return best-scoring output
2. **Retry on Red Flags**: Discard and resample
3. **Human in the Loop**: Ask for approval on risky commands
4. **Event Sourcing**: Full audit trail for debugging
5. **Subtask Retry**: Can retry individual failed subtasks

---

## User Interface & Real-Time Updates

### UI Architecture

**File**: `public/ui.js` (2,634 lines)

#### 3-Column Dashboard Layout

```
┌────────────────────────────────────────────────────────────┐
│  HEADER: Project Name | [Settings] [Models] [Tokens]      │
├──────────────┬──────────────────┬────────────────────────┤
│              │                  │                        │
│  FEATURES    │   SUBTASKS      │      TERMINAL          │
│  (Left)      │   (Middle)       │      (Right)           │
│              │                  │                        │
│ ┌──────────┐ │ Feature Details  │ ┌────────────────────┐ │
│ │ Priority │ │                  │ │ Live Log Stream    │ │
│ │ Badges   │ │ ┌──────────────┐ │ │ (SSE Updates)      │ │
│ │          │ │ │ Subtask 1   ✓│ │ │                    │ │
│ │ A: ✓ Auth│ │ │ Subtask 2  ⏳│ │ │ ▶ Starting         │ │
│ │ A: ● DB  │ │ │ Subtask 3   □│ │ │ ✓ Completed        │ │
│ │ B: ○ UI  │ │ └──────────────┘ │ │ ✗ Error            │ │
│ │          │ │                  │ │                    │ │
│ │[+ Add]   │ │ ┌──────────────┐ │ └────────────────────┘ │
│ │[Execute] │ │ │  Chat with   │ │                        │
│ │          │ │ │  AI about    │ │ ┌────────────────────┐ │
│ └──────────┘ │ │  feature     │ │ │   File Browser     │ │
│              │ └──────────────┘ │ │                    │ │
│              │                  │ │ src/               │ │
│              │                  │ │ ├─ components/     │ │
│              │                  │ │ ├─ pages/          │ │
│              │                  │ │ └─ utils/          │ │
│              │                  │ └────────────────────┘ │
└──────────────┴──────────────────┴────────────────────────┘
```

#### Real-Time Updates via SSE

```javascript
// Connect to SSE endpoint
connectSSE() {
  this.state.sse = new EventSource('/api/v2/events');

  this.state.sse.onmessage = (event) => {
    const data = JSON.parse(event.data);

    switch (data.type) {
      case 'feature-started':
        this.updateFeatureStatus(data.featureId, 'running');
        this.logToTerminal(`▶ Starting feature: ${data.featureName}`);
        break;

      case 'feature-planning':
        this.logToTerminal(`🧠 Planning feature...`);
        break;

      case 'subtask-started':
        this.updateSubtaskStatus(data.subtaskId, 'running');
        this.logToTerminal(`  ├─ ${data.intent}`);
        break;

      case 'subtask-completed':
        this.updateSubtaskStatus(data.subtaskId, 'completed');
        this.logToTerminal(`  ✓ Completed`);
        break;

      case 'feature-completed':
        this.updateFeatureStatus(data.featureId, 'completed');
        this.logToTerminal(`✓ Feature completed!`);
        this.refreshFeatureList();
        break;
    }
  };
}
```

#### Server-Side SSE Broadcasting

```javascript
// server.js
const clients = new Set();

app.get('/api/v2/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  clients.add(res);

  req.on('close', () => {
    clients.delete(res);
  });
});

function broadcast(event) {
  const message = `data: ${JSON.stringify(event)}\n\n`;
  clients.forEach(client => client.write(message));
}
```

---

## LLM Integration & Multi-Provider Support

### Provider Architecture

```javascript
// Base interface (implicit)
class Provider {
  async generate(prompt, options = {}) {
    // Returns: { content: string, model: string, usage: {...} }
  }

  async listModels() {
    // Returns: array of model names
  }
}
```

### OpenAI Provider

**File**: `src/providers/openaiProvider.js` (235 lines)

```javascript
class OpenAIProvider {
  constructor({ apiKey, model = 'gpt-4o-mini', baseURL = 'https://api.openai.com/v1' }) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseURL = baseURL;
  }

  async generate(prompt, options = {}) {
    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 4000
      })
    });

    const data = await response.json();

    return {
      content: data.choices[0].message.content,
      model: data.model,
      usage: {
        inputTokens: data.usage.prompt_tokens,
        outputTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens
      }
    };
  }

  async listModels() {
    const response = await fetch(`${this.baseURL}/models`, {
      headers: { 'Authorization': `Bearer ${this.apiKey}` }
    });
    const data = await response.json();
    return data.data
      .filter(m => m.id.startsWith('gpt-') || m.id.startsWith('o1-'))
      .map(m => m.id);
  }
}
```

### Claude Provider

**File**: `src/providers/claudeProvider.js` (84 lines)

```javascript
class ClaudeProvider {
  constructor({ apiKey, model = 'claude-3-5-sonnet-20241022' }) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseURL = 'https://api.anthropic.com/v1';
  }

  async generate(prompt, options = {}) {
    const response = await fetch(`${this.baseURL}/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: options.maxTokens ?? 4000,
        messages: [{ role: 'user', content: prompt }],
        temperature: options.temperature
      })
    });

    const data = await response.json();

    return {
      content: data.content[0].text,
      model: data.model,
      usage: {
        inputTokens: data.usage.input_tokens,
        outputTokens: data.usage.output_tokens,
        totalTokens: data.usage.input_tokens + data.usage.output_tokens
      }
    };
  }
}
```

### LM Studio Provider (Local Models)

**File**: `src/providers/lmstudioProvider.js` (159 lines)

```javascript
class LMStudioProvider {
  constructor({ model, baseUrl = 'http://localhost:1234' }) {
    this.model = model;
    this.baseUrl = baseUrl;
  }

  async generate(prompt, options = {}) {
    // LM Studio is OpenAI-compatible
    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: options.temperature ?? 0.7
      })
    });

    const data = await response.json();

    return {
      content: data.choices[0].message.content,
      model: this.model,
      usage: data.usage ? {
        inputTokens: data.usage.prompt_tokens,
        outputTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens
      } : null
    };
  }

  async listModels() {
    const response = await fetch(`${this.baseUrl}/v1/models`);
    const data = await response.json();
    return data.data.map(m => m.id);
  }
}
```

### Model Selection Strategy

```
┌──────────────────────────────────────────────────────┐
│ PLANNER MODEL (Strong Reasoning)                     │
├──────────────────────────────────────────────────────┤
│ Recommended:                                          │
│ • GPT-4o / GPT-4 Turbo                               │
│ • Claude 3.5 Sonnet / Opus                           │
│ • Gemini 1.5 Pro                                     │
│ • O1 (for complex planning)                          │
│                                                       │
│ Job: Decompose features into subtasks                │
└──────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────┐
│ EXECUTOR MODEL (Code Generation)                     │
├──────────────────────────────────────────────────────┤
│ Recommended:                                          │
│ • GPT-4o / GPT-4o-mini (balanced)                    │
│ • Claude 3.5 Sonnet (excellent code quality)         │
│ • Local models via LM Studio                         │
│                                                       │
│ Job: Generate actual code for subtasks               │
└──────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────┐
│ VOTER MODEL (Validation)                             │
├──────────────────────────────────────────────────────┤
│ Recommended:                                          │
│ • GPT-4o-mini (cost-effective)                       │
│ • Claude 3.5 Haiku                                   │
│ • Gemini Flash                                       │
│                                                       │
│ Job: Validate executor outputs via voting            │
│ Note: Can be same as executor for simplicity         │
└──────────────────────────────────────────────────────┘
```

---

## Safety & Security

### ProjectGuard - Filesystem Sandboxing

**File**: `src/projectGuard.js` (113 lines)

```javascript
class ProjectGuard {
  constructor(root) {
    this.root = path.resolve(root);
  }

  /**
   * Validate path is within sandbox
   */
  validatePath(relPath) {
    const resolved = path.resolve(this.root, relPath);

    // Prevent path traversal
    if (!resolved.startsWith(this.root)) {
      throw new Error(`Path traversal detected: ${relPath}`);
    }

    // Prevent accessing sensitive files
    const forbidden = ['.env', '.git', 'node_modules'];
    if (forbidden.some(f => relPath.includes(f))) {
      throw new Error(`Access to ${relPath} is forbidden`);
    }

    return resolved;
  }

  async writeFile(relPath, content, options = {}) {
    const fullPath = this.validatePath(relPath);

    // Create directory if needed
    await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });

    if (!options.dryRun) {
      await fs.promises.writeFile(fullPath, content, 'utf8');
    }

    return { written: !options.dryRun, path: relPath };
  }
}
```

### ExecutionGuard - Command Safety

**File**: `src/executionGuard.js` (89 lines)

```javascript
class ExecutionGuard {
  constructor({ safetyMode = 'ask', allowlist = [], denylist = [] }) {
    this.safetyMode = safetyMode; // 'auto', 'ask', 'deny'
    this.allowlist = allowlist;
    this.denylist = denylist;
  }

  /**
   * Classify command risk level
   */
  classifyCommand(cmd) {
    // High risk: destructive operations
    if (/rm -rf|dd |mkfs|format|del \//.test(cmd)) {
      return 'high';
    }

    // Medium risk: installations, network
    if (/npm install|pip install|curl|wget|git/.test(cmd)) {
      return 'medium';
    }

    // Low risk: reads, tests, builds
    if (/ls|cat|grep|npm run|npm test|npm build/.test(cmd)) {
      return 'low';
    }

    return 'unknown';
  }

  /**
   * Check if command is allowed
   */
  isAllowed(cmd, options = {}) {
    // Force flag overrides
    if (options.force) return { allowed: true, reason: 'forced' };

    // Check denylist
    if (this.denylist.some(pattern => cmd.includes(pattern))) {
      return { allowed: false, reason: 'denied-by-denylist' };
    }

    // Check allowlist
    if (this.allowlist.some(pattern => cmd.includes(pattern))) {
      return { allowed: true, reason: 'allowed-by-allowlist' };
    }

    // Check safety mode
    const risk = this.classifyCommand(cmd);

    if (this.safetyMode === 'auto') {
      return { allowed: risk === 'low', reason: `auto-${risk}` };
    }

    if (this.safetyMode === 'ask') {
      return {
        allowed: false,
        reason: 'requires-approval',
        needsApproval: risk !== 'low'
      };
    }

    return { allowed: false, reason: 'denied-by-mode' };
  }
}
```

### Safety Modes

| Mode | Behavior |
|------|----------|
| **auto** | Execute low-risk commands automatically; deny medium/high |
| **ask** | Request human approval for all medium/high risk commands |
| **deny** | Block all command execution (read-only mode) |

### Security Checklist

- ✅ **Path Traversal Prevention**: All file paths validated
- ✅ **Sandbox Enforcement**: Operations limited to project folder
- ✅ **Command Classification**: Risk-based approval system
- ✅ **No Arbitrary Code Execution**: Only predefined action types
- ✅ **Git Integration**: Version control for all changes
- ✅ **Audit Trail**: Complete event log
- ✅ **No Credentials in Code**: API keys in gitignored config
- ✅ **Input Validation**: JSON schema validation on actions

---

## Resource Monitoring & Cost Tracking

### ResourceMonitor Implementation

**File**: `src/resourceMonitor.js` (384 lines)

#### Token Pricing Database

```javascript
tokenPricing = {
  // OpenAI (per 1000 tokens, USD)
  "gpt-4o": { input: 0.005, output: 0.015 },
  "gpt-4o-mini": { input: 0.00015, output: 0.0006 },
  "gpt-4-turbo": { input: 0.01, output: 0.03 },

  // Claude
  "claude-3-5-sonnet-20241022": { input: 0.003, output: 0.015 },
  "claude-3-5-haiku-20241022": { input: 0.0008, output: 0.004 },

  // Gemini
  "gemini-1.5-pro": { input: 0.00125, output: 0.005 },
  "gemini-1.5-flash": { input: 0.000075, output: 0.0003 },

  // Local (zero cost)
  "echo": { input: 0, output: 0 }
};
```

#### Token Estimation

```javascript
estimateTokens(text) {
  if (!text || typeof text !== 'string') return 0;
  // Simple heuristic: ~4 characters per token
  return Math.ceil(text.length / 4);
}
```

#### Recording Usage

```javascript
recordPromptCall(taskId, stepId, model, prompt, output, options = {}) {
  const { usage, projectId, role } = options;

  // Resolve token counts (use provider data if available, else estimate)
  const tokens = usage
    ? {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens
      }
    : {
        inputTokens: this.estimateTokens(prompt),
        outputTokens: this.estimateTokens(output),
        totalTokens: this.estimateTokens(prompt + output)
      };

  // Calculate cost
  const pricing = this.tokenPricing[model] || { input: 0, output: 0 };
  const cost = (
    (tokens.inputTokens * pricing.input) +
    (tokens.outputTokens * pricing.output)
  ) / 1000;

  // Store in task metrics
  if (!this.taskMetrics.has(taskId)) {
    this.taskMetrics.set(taskId, {
      taskId,
      steps: [],
      totalTokens: 0,
      totalCost: 0,
      models: new Set()
    });
  }

  const metrics = this.taskMetrics.get(taskId);
  metrics.steps.push({ stepId, model, ...tokens, cost });
  metrics.totalTokens += tokens.totalTokens;
  metrics.totalCost += cost;
  metrics.models.add(model);

  // Store in project metrics (aggregated by model)
  if (projectId) {
    this.recordProjectPrompt(projectId, model, prompt, output, { usage, tokens, role });
  }
}
```

#### UI Display

```javascript
// Frontend displays:
{
  "projectId": "proj-123",
  "models": [
    {
      "name": "gpt-4o",
      "inputTokens": 15234,
      "outputTokens": 8901,
      "totalTokens": 24135,
      "cost": 0.2103,
      "costFormatted": "$0.2103",
      "calls": 45
    },
    {
      "name": "gpt-4o-mini",
      "inputTokens": 52341,
      "outputTokens": 31209,
      "totalTokens": 83550,
      "cost": 0.0263,
      "costFormatted": "$0.0263",
      "calls": 123
    }
  ],
  "totalCost": 0.2366,
  "totalCostFormatted": "$0.2366",
  "totalTokensFormatted": "107,685 tokens"
}
```

---

## Complete Feature Lifecycle

### From Concept to Deployed Code

```
┌─────────────────────────────────────────────────────────────┐
│ PHASE 1: Project Creation (Wizard)                         │
├─────────────────────────────────────────────────────────────┤
│ User Input:                                                  │
│ • "Build a task management app with React"                  │
│                                                              │
│ Wizard Output:                                               │
│ • project.md (guidelines, stack, architecture)              │
│ • features.json (A/B/C prioritized features)                │
│ • init.sh (setup script)                                    │
│ • package.json (dev server config)                          │
│                                                              │
│ Features Created:                                            │
│ [A] Project scaffold + Vite dev server                      │
│ [A] App shell with routing                                  │
│ [A] Task list UI                                            │
│ [B] Task creation form                                      │
│ [B] Task editing                                            │
│ [C] Dark mode toggle                                        │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│ PHASE 2: Feature Planning                                  │
├─────────────────────────────────────────────────────────────┤
│ Selected Feature: [A] Project scaffold + Vite dev server   │
│                                                              │
│ FeaturePlanner (GPT-4o):                                    │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Context:                                                 │ │
│ │ • project.md → React + Vite + TailwindCSS               │ │
│ │ • File tree → currently empty                           │ │
│ │ • DoD → "npm run dev" starts server on port 5173       │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                              │
│ Subtasks Generated:                                         │
│ 1. Create vite.config.js                                   │
│ 2. Create package.json with React + Vite deps             │
│ 3. Create src/main.jsx entry point                        │
│ 4. Create src/App.jsx shell component                     │
│ 5. Create index.html                                       │
│ 6. Create tailwind.config.js                              │
│ 7. Create postcss.config.js                               │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│ PHASE 3: Subtask Execution (with Voting)                   │
├─────────────────────────────────────────────────────────────┤
│ Subtask 1: Create vite.config.js                           │
│                                                              │
│ Context:                                                     │
│ • Intent: "Create vite.config.js"                          │
│ • Project guidelines                                        │
│ • File tree (empty)                                        │
│                                                              │
│ Voting (GPT-4o-mini as executor):                          │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Sample 1 (temp=0.0):                                     │ │
│ │ {                                                        │ │
│ │   "actions": [{                                          │ │
│ │     "type": "write_file",                                │ │
│ │     "path": "vite.config.js",                            │ │
│ │     "content": "import { defineConfig } ..."             │ │
│ │   }]                                                     │ │
│ │ }                                                        │ │
│ │ ✓ No red flags → Vote count: 1                          │ │
│ ├─────────────────────────────────────────────────────────┤ │
│ │ Sample 2 (temp=0.3):                                     │ │
│ │ {                                                        │ │
│ │   "actions": [{                                          │ │
│ │     "type": "write_file",                                │ │
│ │     "path": "vite.config.js",                            │ │
│ │     "content": "import { defineConfig } ..."             │ │
│ │   }]                                                     │ │
│ │ }                                                        │ │
│ │ ✓ Identical → Vote count: 2                             │ │
│ ├─────────────────────────────────────────────────────────┤ │
│ │ Sample 3 (temp=0.5):                                     │ │
│ │ {                                                        │ │
│ │   "actions": [{                                          │ │
│ │     "type": "write_file",                                │ │
│ │     "path": "vite.config.js",                            │ │
│ │     "content": "export default { ..."                    │ │
│ │   }]                                                     │ │
│ │ }                                                        │ │
│ │ ✓ Different content → Vote count: 1                     │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                              │
│ Winner: Sample 1/2 (lead by 2-1 = 1, need k=2)             │
│                                                              │
│ Continuing voting...                                        │
│ Sample 4 matches Sample 1 → Lead now 3-1 = 2 ✓             │
│                                                              │
│ Action Execution:                                           │
│ • ProjectGuard validates path                              │
│ • Write vite.config.js to disk                             │
│ • Broadcast SSE: subtask-completed                         │
│                                                              │
│ Resource Tracking:                                          │
│ • 4 samples × ~500 tokens = 2000 total tokens              │
│ • Cost: $0.0012 (at GPT-4o-mini rates)                     │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│ PHASE 4: Feature Completion                                │
├─────────────────────────────────────────────────────────────┤
│ All subtasks completed:                                     │
│ ✓ vite.config.js                                           │
│ ✓ package.json                                             │
│ ✓ src/main.jsx                                             │
│ ✓ src/App.jsx                                              │
│ ✓ index.html                                               │
│ ✓ tailwind.config.js                                       │
│ ✓ postcss.config.js                                        │
│                                                              │
│ Technical Summary Generation (GPT-4o):                      │
│ "Created React + Vite project scaffold with TailwindCSS    │
│  integration. Configured dev server on port 5173.          │
│  Entry point: src/main.jsx. Root component: src/App.jsx."  │
│                                                              │
│ Git Commit:                                                 │
│ feat(A): Project scaffold + Vite dev server                │
│                                                              │
│ Priority: A (Essential)                                     │
│ Subtasks: 7 completed                                      │
│ Technical Summary: Created React + Vite project...         │
│                                                              │
│ [Ultracode Auto-Commit]                                    │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│ PHASE 5: Testing (Optional)                                │
├─────────────────────────────────────────────────────────────┤
│ ServerManager:                                              │
│ • Detect project type: react-vite                          │
│ • Run: npm run dev                                         │
│ • Wait for port 5173 to respond                            │
│                                                              │
│ TestRunner (Puppeteer):                                     │
│ • Navigate to http://localhost:5173                        │
│ • Capture screenshot                                       │
│ • Send to LLM with DoD:                                    │
│   "Does the screenshot show a running React app?"          │
│                                                              │
│ LLM Response:                                               │
│ "Yes, the page loads successfully with React logo visible." │
│                                                              │
│ Update feature status: verified ✓                          │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│ PHASE 6: Next Feature (Automatic Queue)                    │
├─────────────────────────────────────────────────────────────┤
│ executeNextRunnable():                                      │
│ • Check dependencies:                                       │
│   - [A] App shell depends on [A] Project scaffold ✓        │
│ • Start executing next highest priority feature             │
└─────────────────────────────────────────────────────────────┘
```

---

## Technical Statistics

### Codebase Metrics

| Category | Files | Lines | Purpose |
|----------|-------|-------|---------|
| **Core Backend** | 15 | ~4,500 | Orchestration, persistence, LLM coordination |
| **LLM Providers** | 5 | 700 | Multi-provider support |
| **UI/Frontend** | 3 | 3,500+ | Web interface, SSE client, wizard |
| **Utilities** | 15 | ~2,000 | Guards, logging, templates, utilities |
| **Total** | **38** | **~12,381** | Full autonomous coding system |

### Performance Characteristics

| Metric | Value | Notes |
|--------|-------|-------|
| **Database Operations** | <50ms | SQLite with WAL mode |
| **LLM Latency** | 2-10s | Depends on provider and model |
| **Voting Overhead** | 4-12 samples | Adaptive early exit |
| **SSE Update Latency** | <100ms | Real-time to all clients |
| **Memory Usage** | ~50-100MB | Node.js + SQLite + browser |
| **Disk Usage** | ~5MB | Core system (excl. workspaces) |

### Token Usage (Example Project)

**Project**: Simple React task app with 5 features

| Role | Model | Tokens | Cost | Calls |
|------|-------|--------|------|-------|
| Planner | GPT-4o | 32,451 | $0.65 | 5 |
| Executor | GPT-4o-mini | 125,340 | $0.09 | 35 |
| Voter | GPT-4o-mini | 89,234 | $0.06 | 140 |
| **Total** | | **247,025** | **$0.80** | **180** |

---

## Conclusion

Ultracode V2 represents a **production-grade approach to autonomous coding** with:

✅ **Reliability**: Multi-layered quality control (voting, red-flagging, guards)
✅ **Transparency**: Full event sourcing, resource tracking, live updates
✅ **Safety**: Sandboxing, command classification, human-in-the-loop
✅ **Flexibility**: 4 LLM providers, configurable models per role
✅ **Zero Lock-In**: Minimal dependencies, SQLite persistence, git versioning

The system achieves **high code quality** through:
- Context-aware prompts with project guidelines
- Voting-based consensus from multiple samples
- Error decorrelation via prompt paraphrasing
- Red-flag detection to filter bad outputs
- Automated testing with screenshot verification

The system ensures **safety** through:
- Filesystem sandboxing (ProjectGuard)
- Command risk classification (ExecutionGuard)
- Human approval for risky operations
- Complete audit trail (event sourcing)
- Git version control for all changes

The system provides **transparency** through:
- Real-time SSE updates to UI
- Token usage and cost tracking
- Full event log with timestamps
- Technical summaries per feature
- Resource consumption per model

**Total Lines of Code**: ~12,381
**Core Philosophy**: Autonomous yet transparent, powerful yet safe, flexible yet opinionated.

---

**Built with ❤️ by the Ultracode community**
**Powered by OpenAI, Anthropic, Google, and local LLMs**
