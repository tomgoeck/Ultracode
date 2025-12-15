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
const { planTask } = require("./planner");
const { AuditLogger } = require("./auditLogger");
const { PendingStore } = require("./pendingStore");
const { simpleDiff } = require("./diffUtil");
const { listFiles } = require("./fileTree");

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
const taskMeta = new Map();
const taskQueue = new TaskQueue();
const commandRunner = new CommandRunner({
  safetyMode: configStore.getSetting("safetyMode", "ask"),
  allowlist: configStore.getSetting("allowlist", []),
  denylist: configStore.getSetting("denylist", []),
});
const orchestrator = new Orchestrator({
  llmRegistry: llms,
  stateStore,
  commandRunner,
  projectGuard: new ProjectGuard(process.cwd()),
  auditLogger,
  eventEmitter: { emit: (ev) => broadcast(ev) },
});
const pendingCommands = new Map(pendingStore.list().map((c) => [c.id, c]));
if (pendingCommands.size) {
  stateStore.updateSection("pendingCommands", () => Array.from(pendingCommands.values()));
}
const sseClients = new Set();

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

      if (url.pathname === "/api/tasks/run-demo" && req.method === "POST") {
        const { model, voteModel } = body;
        if (!model) return sendJson(res, 400, { error: "model required" });
        const task = planTask({
          id: `task-${Date.now()}`,
          title: "Demo: greeting + write log",
          goal: "Produce a greeting line and write it to out/demo.log",
          model,
          voteModel: voteModel || model,
          filePath: "out/demo.log",
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
        const { title, goal, model, voteModel, filePath } = body;
        if (!title || !goal || !model) {
          return sendJson(res, 400, { error: "title, goal, model required" });
        }
        const task = planTask({
          id: `task-${Date.now()}`,
          title,
          goal,
          model,
          voteModel: voteModel || model,
          filePath: filePath || "out/output.txt",
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

      if (url.pathname === "/api/tasks" && req.method === "GET") {
        return sendJson(res, 200, { tasks: Array.from(taskMeta.values()) });
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
        const { path: filePath, content } = body;
        if (!filePath || typeof content !== "string") {
          return sendJson(res, 400, { error: "path and content required" });
        }
        const guard = new ProjectGuard(process.cwd());
        const before = await guard.readFile(filePath).catch(() => "");
        const diff = simpleDiff(before, content);
        return sendJson(res, 200, { diff, before, after: content });
      }

      sendJson(res, 404, { error: "not found" });
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
  });
}

async function runTaskSequential(task) {
  task.status = "running";
  const workspacePath = path.join(process.cwd(), "workspaces", task.id);
  fs.mkdirSync(workspacePath, { recursive: true });
  task.workspacePath = workspacePath;
  taskMeta.set(task.id, {
    id: task.id,
    title: task.title,
    status: task.status,
    workspacePath,
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
    const result = await orchestrator.runStep(task, step, workspaceGuard);
    results.push({ stepId: step.id, result });
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
  }
  if (!pending.length) task.status = "completed";
  stateStore.updateSection("tasks", (prev = []) =>
    prev.map((t) => (t.id === task.id ? { ...t, status: task.status } : t))
  );
  taskMeta.set(task.id, { ...taskMeta.get(task.id), status: task.status });
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
