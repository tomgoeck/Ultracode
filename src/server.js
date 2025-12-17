const http = require("http");
const path = require("path");
const fs = require("fs");

const { LLMRegistry } = require("./llmRegistry");
const { StateStore } = require("./stateStore");
const { TaskQueue } = require("./taskQueue");
const { CommandRunner } = require("./executionGuard");
const { Orchestrator } = require("./orchestrator");
const { ProjectGuard } = require("./projectGuard");
const { createProvider } = require("./providerFactory");
const { ConfigStore } = require("./configStore");
const { createPlan } = require("./planner");
const { AuditLogger } = require("./auditLogger");
const { PendingStore } = require("./pendingStore");
const { simpleDiff } = require("./diffUtil");
const { listFiles } = require("./fileTree");
const { PromptParaphraser } = require("./promptParaphraser");
const { ResourceMonitor } = require("./resourceMonitor");
const { VotingEngine } = require("./votingEngine");
const { RedFlagger } = require("./redFlagger");
const { GitCommitter } = require("./gitCommitter");
const { SnapshotStore } = require("./snapshotStore");

// Persistent config and in-memory state
const configStore = new ConfigStore(path.join(process.cwd(), "data", "config.json"));
const auditLogger = new AuditLogger(path.join(process.cwd(), "data", "audit.log"));
const pendingStore = new PendingStore(path.join(process.cwd(), "data", "pendingCommands.json"));
const llms = new LLMRegistry();
const providerConfigs = new Map(); // name -> cfg
const stateStore = new StateStore({
  projectRoot: process.cwd(),
  files: {},
  pendingCommands: [],
  tasks: [],
});
const taskQueue = new TaskQueue();
const commandRunner = new CommandRunner({
  safetyMode: configStore.getSetting("safetyMode", "ask"),
  allowlist: configStore.getSetting("allowlist", []),
  denylist: configStore.getSetting("denylist", []),
});

// Initialize MAKER components (paraphraser for error decorrelation, resource monitor for cost tracking)
const resourceMonitor = new ResourceMonitor();
const paraphraser = new PromptParaphraser(llms, "gpt-4o-mini"); // Use cheap model for paraphrasing
const gitCommitter = new GitCommitter(process.cwd()); // Auto-commit task completions
const snapshotStore = new SnapshotStore(path.join(process.cwd(), "data", "snapshots.db"));
const votingEngine = new VotingEngine({
  redFlagger: new RedFlagger(),
  paraphraser,
  resourceMonitor,
});

const orchestrator = new Orchestrator({
  llmRegistry: llms,
  stateStore,
  commandRunner,
  projectGuard: new ProjectGuard(process.cwd()),
  auditLogger,
  eventEmitter: { emit: (ev) => broadcast(ev) },
  votingEngine,
  snapshotStore,
});
const pendingCommands = new Map(pendingStore.list().map((c) => [c.id, c]));
if (pendingCommands.size) {
  stateStore.updateSection("pendingCommands", () => Array.from(pendingCommands.values()));
}
const sseClients = new Set();

// Task/Project Persistence
const TASKS_FILE = path.join(process.cwd(), "data", "tasks.json");
const projects = new Map(); // projectId -> project metadata
let taskMeta = new Map(); // taskId -> task metadata
const activeTasks = new Map(); // taskId -> full task object (in-memory only)

function saveTasks() {
  const data = {
    projects: Array.from(projects.entries()),
    tasks: Array.from(taskMeta.entries()),
  };
  fs.mkdirSync(path.dirname(TASKS_FILE), { recursive: true });
  fs.writeFileSync(TASKS_FILE, JSON.stringify(data, null, 2), "utf8");
}

function loadTasks() {
  try {
    const data = JSON.parse(fs.readFileSync(TASKS_FILE, "utf8"));
    if (data.projects) {
      projects.clear();
      data.projects.forEach(([id, proj]) => projects.set(id, proj));
    }
    if (data.tasks) {
      taskMeta.clear();
      data.tasks.forEach(([id, task]) => taskMeta.set(id, task));
    }
    console.log(`[Persistence] Loaded ${projects.size} projects, ${taskMeta.size} tasks`);
  } catch (e) {
    if (e.code !== 'ENOENT') {
      console.error('Error loading tasks file:', e);
    }
  }
}

// Load persisted tasks on startup
loadTasks();

// Load providers from config
for (const cfg of configStore.listProviders()) {
  try {
    llms.register(cfg.name, createProvider(cfg));
    providerConfigs.set(cfg.name, cfg);
  } catch (err) {
    console.error("Failed to register provider from config:", cfg.name, err.message);
  }
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function broadcast(event) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of sseClients) {
    res.write(payload);
  }
}

function addPendingCommand(entry) {
  pendingCommands.set(entry.id, entry);
  pendingStore.add(entry);
  stateStore.updateSection("pendingCommands", (prev = []) => {
    const filtered = prev.filter((c) => c.id !== entry.id);
    return [...filtered, entry];
  });
}

function removePendingCommand(id) {
  pendingCommands.delete(id);
  pendingStore.remove(id);
  stateStore.updateSection("pendingCommands", (prev = []) => prev.filter((c) => c.id !== id));
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", async () => {
    const bodyText = Buffer.concat(chunks).toString() || "{}";
    let body = {};
    try {
      body = JSON.parse(bodyText);
    } catch {
      // ignore parse error
    }

    try {
      if (url.pathname === "/api/providers" && req.method === "GET") {
        return sendJson(res, 200, {
          providers: Array.from(providerConfigs.values()),
          registered: llms.list(),
        });
      }

      if (url.pathname === "/api/providers/upsert" && req.method === "POST") {
        const { name, type, apiKey, model, baseUrl } = body;
        if (!name || !type || !model) {
          return sendJson(res, 400, { error: "name, type, model required" });
        }
        const cfg = { name, type, apiKey, model, baseUrl };
        providerConfigs.set(name, cfg);
        configStore.upsertProvider(cfg);
        llms.register(name, createProvider(cfg));
        return sendJson(res, 200, { ok: true, provider: cfg });
      }

      if (url.pathname === "/api/providers/list-models" && req.method === "POST") {
        const { name } = body;
        if (!name) return sendJson(res, 400, { error: "name required" });
        const models = await llms.listModels(name);
        return sendJson(res, 200, { models });
      }

      if (url.pathname === "/api/providers/probe-models" && req.method === "POST") {
        const { type, apiKey, baseUrl, model } = body;
        if (!type) return sendJson(res, 400, { error: "type required" });
        const cfg = {
          name: "probe",
          type,
          apiKey,
          model: model || "placeholder",
          baseUrl: baseUrl && baseUrl.trim() ? baseUrl.trim() : undefined,
        };
        const provider = createProvider(cfg);
        if (typeof provider.listModels !== "function") {
          return sendJson(res, 400, { error: "provider does not support listModels" });
        }
        const models = await provider.listModels();
        return sendJson(res, 200, { models });
      }

      if (url.pathname === "/api/settings/safety-mode" && req.method === "POST") {
        const { mode } = body;
        if (mode !== "ask" && mode !== "auto") {
          return sendJson(res, 400, { error: "mode must be ask|auto" });
        }
        commandRunner.setSafetyMode(mode);
        configStore.setSetting("safetyMode", mode);
        return sendJson(res, 200, { ok: true, mode });
      }

      if (url.pathname === "/api/settings/command-lists" && req.method === "POST") {
        const { allowlist = [], denylist = [] } = body;
        commandRunner.setLists({ allowlist, denylist });
        configStore.setSetting("allowlist", allowlist);
        configStore.setSetting("denylist", denylist);
        return sendJson(res, 200, { ok: true, allowlist, denylist });
      }

      // Config/Keys Endpoints
      if (url.pathname === "/api/config/keys" && req.method === "GET") {
        return sendJson(res, 200, { keys: configStore.getKeys() });
      }

      if (url.pathname === "/api/config/keys" && req.method === "POST") {
        const { keys } = body;
        if (!keys || typeof keys !== 'object') {
          return sendJson(res, 400, { error: "keys object required" });
        }
        // Save each key
        for (const [providerId, key] of Object.entries(keys)) {
          if (key) configStore.setKey(providerId, key);
        }
        return sendJson(res, 200, { ok: true });
      }

      // Projects Endpoints
      if (url.pathname === "/api/projects/create" && req.method === "POST") {
        const { name, agentModel, voteModel, planningModel } = body;
        if (!name) return sendJson(res, 400, { error: "name required" });

        const projectId = `project-${Date.now()}`;
        const project = {
          id: projectId,
          name,
          agentModel,
          voteModel,
          planningModel,
          createdAt: Date.now(),
          tasks: [],
        };

        projects.set(projectId, project);
        saveTasks();

        return sendJson(res, 200, { ok: true, project });
      }

      if (url.pathname === "/api/projects" && req.method === "GET") {
        return sendJson(res, 200, { projects: Array.from(projects.values()) });
      }

      if (url.pathname === "/api/tasks/run-demo" && req.method === "POST") {
        const { model, voteModel, planningModel } = body;
        if (!model) return sendJson(res, 400, { error: "model required" });
        const task = await createPlan({
          id: `task-${Date.now()}`,
          title: "Demo: greeting + write log",
          goal: "Produce a greeting line and write it to out/demo.log",
          model,
          voteModel: voteModel || model,
          planningModel: planningModel || model,
          filePath: "out/demo.log",
          llmRegistry: llms,
        });
        taskQueue.add(task);
        const { results, pending } = await runTaskSequential(task);
        return sendJson(res, 200, {
          ok: true,
          taskId: task.id,
          results,
          pendingCommands: pending,
          state: stateStore.snapshot(),
        });
      }

      if (url.pathname === "/api/tasks/create" && req.method === "POST") {
        const { title, goal, model, voteModel, planningModel, filePath, k, nSamples, maxSamples, initialSamples, temperature, redFlags, projectId } = body;
        if (!title || !goal || !model) {
          return sendJson(res, 400, { error: "title, goal, model required" });
        }

        // Parse "provider:model" format and ensure provider is registered
        const ensureProvider = (modelStr) => {
          if (!modelStr.includes(':')) return modelStr; // Already a provider name

          const [providerType, modelName] = modelStr.split(':', 2);
          const providerKey = `${providerType}:${modelName}`;

          // Check if already registered
          if (llms.has(providerKey)) return providerKey;

          // Get API key from config
          const keys = configStore.getKeys();
          const apiKey = keys[providerType];

          // Create and register provider
          const cfg = {
            name: providerKey,
            type: providerType,
            apiKey,
            model: modelName,
          };
          llms.register(providerKey, createProvider(cfg));
          return providerKey;
        };

        const agentProvider = ensureProvider(model);
        const voterProvider = voteModel ? ensureProvider(voteModel) : agentProvider;
        const plannerProvider = planningModel ? ensureProvider(planningModel) : agentProvider;

        const task = await createPlan({
          id: `task-${Date.now()}`,
          title,
          goal,
          model: agentProvider,
          voteModel: voterProvider,
          planningModel: plannerProvider,
          filePath: filePath || "out/output.txt",
          llmRegistry: llms,
          // MAKER parameters
          k: k || 2,
          nSamples: maxSamples || nSamples || 12, // acts as cap in adaptive voting
          temperature: temperature !== undefined ? temperature : undefined,
          initialSamples: initialSamples || 2,
          redFlags: redFlags || [],
        });
        task.projectId = projectId; // Associate with project
        taskQueue.add(task);

        // Save full task in activeTasks for live updates
        activeTasks.set(task.id, task);

        // Save task metadata immediately
        taskMeta.set(task.id, {
          id: task.id,
          title: task.title,
          projectId: projectId,
          planningModel: task.planningModel,
          status: "pending",
          createdAt: Date.now(),
        });

        // Add to project's task list
        if (projectId && projects.has(projectId)) {
          const project = projects.get(projectId);
          project.tasks.push(task.id);
          projects.set(projectId, project);
        }

        saveTasks();

        // Return immediately and run task in background
        setImmediate(async () => {
          try {
            await runTaskSequential(task);
          } catch (err) {
            console.error(`[Task ${task.id}] Execution failed:`, err);
            // Update task status to failed
            task.status = "failed";
            taskMeta.set(task.id, { ...taskMeta.get(task.id), status: "failed" });
            saveTasks();
            broadcast({ type: "task-failed", taskId: task.id, error: err.message });
          }
        });

        return sendJson(res, 200, {
          ok: true,
          taskId: task.id,
          steps: task.steps.map(s => ({ id: s.id, intent: s.intent, status: s.status })),
        });
      }

      if (url.pathname === "/api/tasks" && req.method === "GET") {
        return sendJson(res, 200, { tasks: Array.from(taskMeta.values()) });
      }

      if (url.pathname === "/api/tasks/details" && req.method === "GET") {
        const taskId = url.searchParams.get("taskId");
        if (!taskId) return sendJson(res, 400, { error: "taskId required" });

        // Check activeTasks first (running/recent tasks with full details)
        const activeTask = activeTasks.get(taskId);
        if (activeTask) {
          return sendJson(res, 200, { task: activeTask });
        }

        // Fall back to metadata
        const taskMetadata = taskMeta.get(taskId);
        if (!taskMetadata) return sendJson(res, 404, { error: "task not found" });
        return sendJson(res, 200, { task: taskMetadata });
      }

      if (url.pathname === "/api/workspace/tree" && req.method === "GET") {
        const taskId = url.searchParams.get("taskId");
        if (!taskId) return sendJson(res, 400, { error: "taskId required" });
        const meta = taskMeta.get(taskId);
        if (!meta || !meta.workspacePath) return sendJson(res, 404, { error: "task not found" });
        const tree = listFiles(meta.workspacePath);
        return sendJson(res, 200, { workspacePath: meta.workspacePath, tree });
      }

      if (url.pathname === "/api/state" && req.method === "GET") {
        return sendJson(res, 200, stateStore.snapshot());
      }

      if (url.pathname === "/api/logs" && req.method === "GET") {
        const limit = Number(url.searchParams.get("limit") || 50);
        return sendJson(res, 200, { recent: auditLogger.readRecent(limit) });
      }

      if (url.pathname === "/api/commands/list" && req.method === "GET") {
        return sendJson(res, 200, { pending: Array.from(pendingCommands.values()) });
      }

      if (url.pathname === "/api/commands/approve" && req.method === "POST") {
        const { id } = body;
        if (!id) return sendJson(res, 400, { error: "id required" });
        const cmd = pendingCommands.get(id);
        if (!cmd) return sendJson(res, 404, { error: "command not found" });
        const result = await commandRunner.run(cmd.command, { force: true });
        removePendingCommand(id);
        stateStore.updateSection("log", (prev = []) => [
          ...prev,
          { event: "command-approved", id, result, ts: Date.now() },
        ]);
        auditLogger.log({ event: "command-approved", id, result, ts: Date.now() });
        return sendJson(res, 200, { ok: true, result });
      }

      if (url.pathname === "/api/tasks/preview-diff" && req.method === "POST") {
        const { path: filePath, content, taskId } = body;
        if (!filePath || typeof content !== "string") {
          return sendJson(res, 400, { error: "path and content required" });
        }

        // Get workspace path from task metadata
        let workspacePath = process.cwd();
        if (taskId) {
          const meta = taskMeta.get(taskId);
          if (meta && meta.workspacePath) {
            workspacePath = meta.workspacePath;
          }
        }

        const guard = new ProjectGuard(workspacePath);
        const before = await guard.readFile(filePath).catch(() => "");
        const diff = simpleDiff(before, content);
        return sendJson(res, 200, { diff, before, after: content });
      }

      // Resource Monitoring Endpoints
      if (url.pathname === "/api/metrics/task" && req.method === "GET") {
        const taskId = url.searchParams.get("taskId");
        if (!taskId) return sendJson(res, 400, { error: "taskId required" });
        const metrics = resourceMonitor.getTaskMetrics(taskId);
        return sendJson(res, 200, metrics || { error: "not found" });
      }

      if (url.pathname === "/api/metrics/all" && req.method === "GET") {
        const metrics = resourceMonitor.getAllMetrics();
        return sendJson(res, 200, { tasks: metrics });
      }

      if (url.pathname === "/api/metrics/summary" && req.method === "GET") {
        const summary = resourceMonitor.getSummary();
        return sendJson(res, 200, summary);
      }

      sendJson(res, 404, { error: "not found" });
    } catch (err) {
      console.error("[API Error]", err);
      sendJson(res, 500, { error: err.message });
    }
  });
}

async function runTaskSequential(task) {
  task.status = "running";
  const workspacePath = path.join(process.cwd(), "workspaces", task.id);
  fs.mkdirSync(workspacePath, { recursive: true });
  task.workspacePath = workspacePath;
  const prevMeta = taskMeta.get(task.id) || {};
  taskMeta.set(task.id, {
    ...prevMeta,
    id: task.id,
    title: task.title,
    status: task.status,
    workspacePath,
    planningModel: task.planningModel,
  });
  stateStore.updateSection("workspace", () => workspacePath);
  const results = [];
  let pending = [];
  stateStore.updateSection("tasks", (prev = []) => {
    const filtered = prev.filter((t) => t.id !== task.id);
    return [...filtered, { id: task.id, title: task.title, status: task.status, workspacePath }];
  });
  const workspaceGuard = new ProjectGuard(workspacePath);

  for (const step of task.steps) {
    step.status = "running";
    console.log(`\n[Task ${task.id}] ═══ STEP ${step.id} ═══`);
    console.log(`[Task ${task.id}] Intent: ${step.intent}`);
    console.log(`[Task ${task.id}] Apply: ${step.apply?.type} → ${step.apply?.path || 'N/A'}`);

    try {
      const result = await orchestrator.runStep(task, step, workspaceGuard);
      results.push({ stepId: step.id, result });
      console.log(`[Task ${task.id}] ✓ Step ${step.id} completed successfully`);
      broadcast({ type: "step-result", taskId: task.id, stepId: step.id, result });

      if (result.commandResult && result.commandResult.status === "needs-approval") {
        const entry = {
          id: result.commandResult.id,
          command: step.command,
          severity: result.commandResult.severity,
          taskId: task.id,
          stepId: step.id,
        };
        addPendingCommand(entry);
        step.status = "paused";
        pending.push(entry);
        break; // halt until approval
      } else if (result.commandResult && result.commandResult.status === "blocked") {
        step.status = "failed";
        stateStore.updateSection("log", (prev = []) => [
          ...prev,
          { event: "command-blocked", taskId: task.id, stepId: step.id, command: step.command, ts: Date.now() },
        ]);
        pending.push({ blocked: true, command: step.command });
        break;
      }
    } catch (stepError) {
      // Step failed - log it and continue with next step
      console.error(`[Task ${task.id}] Step ${step.id} failed:`, stepError.message);
      step.status = "failed";
      results.push({ stepId: step.id, error: stepError.message });
      broadcast({ type: "step-failed", taskId: task.id, stepId: step.id, error: stepError.message });
      // Continue with next step instead of breaking
    }
  }
  if (!pending.length) task.status = "completed";

  // Auto-commit task completion to git (MAKER requirement)
  if (task.status === "completed") {
    const commitResult = await gitCommitter.commitTaskCompletion(task, results);
    if (commitResult.committed) {
      console.log(`[GitCommitter] Committed task ${task.id}: ${commitResult.changedFiles} files`);
      stateStore.updateSection("log", (prev = []) => [
        ...prev,
        { event: "git-commit", taskId: task.id, commitResult, ts: Date.now() },
      ]);
      auditLogger.log({ event: "git-commit", taskId: task.id, commitResult, ts: Date.now() });
    } else if (commitResult.reason !== "no-git-repo" && commitResult.reason !== "no-changes") {
      console.warn(`[GitCommitter] Failed to commit task ${task.id}: ${commitResult.reason || commitResult.error}`);
    }
  }

  stateStore.updateSection("tasks", (prev = []) =>
    prev.map((t) => (t.id === task.id ? { ...t, status: task.status } : t))
  );
  taskMeta.set(task.id, { ...taskMeta.get(task.id), status: task.status });
  saveTasks(); // Persist task completion
  return { results, pending };
}

function serveStatic(req, res) {
  const urlPath = req.url === "/" ? "/index.html" : req.url;
  const filePath = path.join(process.cwd(), "public", urlPath);
  if (!filePath.startsWith(path.join(process.cwd(), "public"))) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end("Not found");
    }
    const ext = path.extname(filePath);
    const type =
      ext === ".html"
        ? "text/html"
        : ext === ".js"
        ? "application/javascript"
        : ext === ".css"
        ? "text/css"
        : "text/plain";
    res.writeHead(200, { "Content-Type": type });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (req.url === "/api/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write("\n");
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
    return;
  }

  if (req.url.startsWith("/api/")) {
    return handleApi(req, res);
  }
  return serveStatic(req, res);
});

const PORT = process.env.PORT || 4173;
const HOST = process.env.HOST || "127.0.0.1";
server.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
});
