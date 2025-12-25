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
const { FeatureStore } = require("./featureStore");
const { WizardAgent } = require("./wizardAgent");
const { TavilyProvider } = require("./providers/tavilyProvider");
const { FeatureManager } = require("./featureManager");
const { planFeature } = require("./featurePlanner");
const { ServerManager } = require("./serverManager");
const { TestRunner } = require("./testRunner");
const { getAllTemplates, getTemplate } = require("./templates");
const { normalizeLLMResponse } = require("./llmUtils");

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

const gitCommitter = new GitCommitter(process.cwd()); // Auto-commit task completions
const snapshotStore = new SnapshotStore(path.join(process.cwd(), "data", "snapshots.db"));
const featureStore = new FeatureStore(path.join(process.cwd(), "data", "features.db"));
// Initialize MAKER components (paraphraser for error decorrelation, resource monitor for cost tracking)
const resourceMonitor = new ResourceMonitor({ featureStore });
const paraphraser = new PromptParaphraser(llms, "gpt-4o-mini", resourceMonitor); // Use cheap model for paraphrasing
// Clear any stale "running" features from abrupt shutdowns
featureStore.resetRunningFeatures("failed");

// Initialize Tavily provider for web search (if API key is configured)
const tavilyApiKey = configStore.getKey("tavily");
const tavilyProvider = tavilyApiKey ? new TavilyProvider({ apiKey: tavilyApiKey }) : null;

// Initialize Wizard Agent
const wizardAgent = new WizardAgent({
  featureStore,
  llmRegistry: llms,
  tavilyProvider,
  resourceMonitor,
});

// Initialize ServerManager and TestRunner for automated testing
const serverManager = new ServerManager(featureStore);
const testRunner = new TestRunner(llms);

// Cleanup on exit
process.on('SIGINT', () => {
  console.log('\n[Server] Shutting down...');
  serverManager.stopAllServers();
  testRunner.close().then(() => process.exit(0));
});

// Note: FeatureManager is initialized after orchestrator (see below)
let featureManager = null;

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

// Initialize FeatureManager (after orchestrator)
featureManager = new FeatureManager({
  featureStore,
  orchestrator,
  llmRegistry: llms,
  planFeature,
  broadcast,
  gitCommitter,
  serverManager,
  testRunner,
  configStore,
  resourceMonitor,
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

function getWorkspacePathFromId(id) {
  if (!id) return null;

  // Active/planned tasks
  const meta = taskMeta.get(id);
  if (meta?.workspacePath) return meta.workspacePath;

  // FeatureStore project
  const project = featureStore.getProject(id);
  if (project?.folder_path) return project.folder_path;

  // Legacy projects map (if any)
  const legacy = projects.get(id);
  if (legacy?.folderPath) return legacy.folderPath;

  return null;
}

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

function normalizeModelKey(name) {
  if (!name || typeof name !== "string") return name;
  const parts = name.split(":");
  if (parts.length <= 1) return name;
  return parts.slice(1).join(":");
}

function canonicalizeModelName(name) {
  if (!name || typeof name !== "string") return name;
  let normalized = normalizeModelKey(name);
  normalized = normalized.replace(/-\d{4}-\d{2}-\d{2}$/, "");
  normalized = normalized.replace(/-\d{4}$/, "");
  return normalized;
}

function formatTokensCount(count) {
  const safe = Number.isFinite(count) ? count : 0;
  return `${safe.toLocaleString()} tokens`;
}

function buildRoleMetrics(project, metrics, roleUsage = []) {
  if (!project) return [];
  const modelStats = new Map((metrics?.models || []).map((m) => [m.name, m]));
  const canonicalStats = new Map();
  for (const entry of metrics?.models || []) {
    const key = canonicalizeModelName(entry.name);
    if (!key) continue;
    const existing = canonicalStats.get(key) || {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      calls: 0,
      cost: 0,
      costFormatted: "$0.0000",
      tokensFormatted: "0 tokens",
    };
    canonicalStats.set(key, {
      inputTokens: existing.inputTokens + (entry.inputTokens || 0),
      outputTokens: existing.outputTokens + (entry.outputTokens || 0),
      totalTokens: existing.totalTokens + (entry.totalTokens || 0),
      calls: existing.calls + (entry.calls || 0),
      cost: existing.cost + (entry.cost || 0),
      costFormatted: `$${(existing.cost + (entry.cost || 0)).toFixed(4)}`,
      tokensFormatted: entry.tokensFormatted || existing.tokensFormatted,
    });
  }
  const roleStats = new Map();
  const roleStatsCanonical = new Map();
  for (const entry of roleUsage) {
    const roleKey = entry.role?.toLowerCase() || "unknown";
    const key = `${roleKey}|${entry.model}`;
    const canonicalKey = `${roleKey}|${canonicalizeModelName(entry.model)}`;
    const existing = roleStats.get(key) || {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      calls: 0,
      cost: 0,
      costFormatted: "$0.0000",
    };
    roleStats.set(key, {
      inputTokens: existing.inputTokens + (entry.input_tokens || 0),
      outputTokens: existing.outputTokens + (entry.output_tokens || 0),
      totalTokens: existing.totalTokens + (entry.total_tokens || 0),
      calls: existing.calls + (entry.calls || 0),
      cost: existing.cost,
      costFormatted: existing.costFormatted,
    });

    const canonicalExisting = roleStatsCanonical.get(canonicalKey) || {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      calls: 0,
      cost: 0,
      costFormatted: "$0.0000",
    };
    roleStatsCanonical.set(canonicalKey, {
      inputTokens: canonicalExisting.inputTokens + (entry.input_tokens || 0),
      outputTokens: canonicalExisting.outputTokens + (entry.output_tokens || 0),
      totalTokens: canonicalExisting.totalTokens + (entry.total_tokens || 0),
      calls: canonicalExisting.calls + (entry.calls || 0),
      cost: canonicalExisting.cost,
      costFormatted: canonicalExisting.costFormatted,
    });
  }

  const roles = [
    { role: "Planner", model: project.planner_model },
    { role: "Subtask", model: project.executor_model },
    { role: "Voter", model: project.vote_model || project.executor_model },
  ];

  return roles
    .filter((entry) => entry.model)
    .map((entry) => {
      const direct = modelStats.get(entry.model);
      const normalized = modelStats.get(normalizeModelKey(entry.model));
      const canonical = canonicalStats.get(canonicalizeModelName(entry.model));
      const roleKey = `${entry.role.toLowerCase()}|${entry.model}`;
      const roleKeyNormalized = `${entry.role.toLowerCase()}|${normalizeModelKey(entry.model)}`;
      const roleKeyCanonical = `${entry.role.toLowerCase()}|${canonicalizeModelName(entry.model)}`;
      const roleData = roleStats.get(roleKey) ||
        roleStats.get(roleKeyNormalized) ||
        roleStatsCanonical.get(roleKeyCanonical);
      const data = roleData || direct || normalized || canonical;
      return {
        role: entry.role,
        model: entry.model,
        inputTokens: data?.inputTokens || 0,
        outputTokens: data?.outputTokens || 0,
        totalTokens: data?.totalTokens || 0,
        calls: data?.calls || 0,
        cost: data?.cost || 0,
        costFormatted: data?.costFormatted || "$0.0000",
        tokensFormatted: data?.tokensFormatted || formatTokensCount(data?.totalTokens || 0),
      };
    });
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
          resourceMonitor,
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
          projectId,
          resourceMonitor,
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
        const workspacePath = getWorkspacePathFromId(taskId);
        if (!workspacePath) return sendJson(res, 404, { error: "workspace not found" });
        const tree = listFiles(workspacePath);
        return sendJson(res, 200, { workspacePath, tree });
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
        let workspacePath = taskId ? getWorkspacePathFromId(taskId) : null;
        if (!workspacePath) workspacePath = process.cwd();

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

      if (url.pathname === "/api/metrics/project" && req.method === "GET") {
        const projectId = url.searchParams.get("projectId");
        if (!projectId) return sendJson(res, 400, { error: "projectId required" });
        const metrics = resourceMonitor.getProjectMetrics(projectId);
        const project = featureStore.getProject(projectId);
        const roleUsage = resourceMonitor.getProjectRoleUsage(projectId);
        const roles = buildRoleMetrics(project, metrics, roleUsage);
        return sendJson(res, 200, metrics ? { ...metrics, roles } : {
          models: [],
          roles,
          totalTokens: 0,
          totalCost: 0,
          totalCostFormatted: "$0.0000",
          totalTokensFormatted: "0 tokens",
        });
      }

      // ==================== WIZARD ENDPOINTS ====================

      // Get available templates
      if (url.pathname === "/api/templates" && req.method === "GET") {
        const templates = getAllTemplates();
        return sendJson(res, 200, { templates });
      }

      // Get specific template
      if (url.pathname.match(/^\/api\/templates\/[^/]+$/) && req.method === "GET") {
        const templateId = url.pathname.split("/")[3];
        const template = getTemplate(templateId);
        if (!template) {
          return sendJson(res, 404, { error: "Template not found" });
        }
        return sendJson(res, 200, { template });
      }

      // Start wizard (Page 1: Basics)
      if (url.pathname === "/api/wizard/start" && req.method === "POST") {
        const { name, description, basePath, templateId } = body;
        if (!name) return sendJson(res, 400, { error: "name required" });

        const projectsBasePath = basePath || path.join(process.cwd(), "projects");
        fs.mkdirSync(projectsBasePath, { recursive: true });

        const result = wizardAgent.startWizard({
          name,
          description,
          basePath: projectsBasePath,
        });

        // If template selected, initialize wizard with template
        if (templateId) {
          const template = getTemplate(templateId);
          if (template) {
            wizardAgent.initializeFromTemplate(result.projectId, template);
          }
        }

        return sendJson(res, 200, {
          ok: true,
          ...result,
          templateApplied: !!templateId,
        });
      }

      // Get wizard state
      if (url.pathname === "/api/wizard/status" && req.method === "GET") {
        const projectId = url.searchParams.get("projectId");
        if (!projectId) return sendJson(res, 400, { error: "projectId required" });

        const state = wizardAgent.getWizardState(projectId);
        if (!state) {
          // Try to resume from database
          const resumed = wizardAgent.resumeWizard(projectId);
          if (!resumed) return sendJson(res, 404, { error: "no active wizard for this project" });
          return sendJson(res, 200, { ok: true, ...resumed, resumed: true });
        }

        const project = featureStore.getProject(projectId);
        return sendJson(res, 200, {
          ok: true,
          project,
          ...state,
        });
      }

      // Chat in wizard (Page 2: Clarification)
      if (url.pathname === "/api/wizard/chat" && req.method === "POST") {
        const { sessionId, projectId, message, chatModel, model } = body;
        const id = sessionId || projectId;

        if (!id || !message) {
          return sendJson(res, 400, { error: "sessionId/projectId and message required" });
        }

        // Use provided model (chatModel or model) or default to first available
        const modelStr = chatModel || model || llms.list()[0];
        if (!modelStr) {
          return sendJson(res, 400, { error: "no LLM model available" });
        }

        // Ensure provider is registered (dynamic registration if needed)
        const ensureProvider = (modelStr) => {
          if (!modelStr.includes(':')) {
            // Simple name, assume already registered
            return modelStr;
          }

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

        const modelToUse = ensureProvider(modelStr);
        const result = await wizardAgent.processChat(id, message, modelToUse);
        return sendJson(res, 200, { ok: true, ...result });
      }

      // Get initial greeting for wizard chat
      if (url.pathname === "/api/wizard/greeting" && req.method === "GET") {
        const projectId = url.searchParams.get("projectId");
        if (!projectId) return sendJson(res, 400, { error: "projectId required" });

        const project = featureStore.getProject(projectId);
        if (!project) return sendJson(res, 404, { error: "project not found" });

        const greeting = wizardAgent.getInitialGreeting(project.name, project.description);
        return sendJson(res, 200, { ok: true, greeting });
      }

      // Web search in wizard
      if (url.pathname === "/api/wizard/web-search" && req.method === "POST") {
        const { projectId, query } = body;
        if (!projectId || !query) {
          return sendJson(res, 400, { error: "projectId and query required" });
        }

        if (!tavilyProvider) {
          return sendJson(res, 400, {
            error: "Web search not configured. Please add a Tavily API key in settings.",
          });
        }

        const result = await wizardAgent.webSearch(projectId, query);
        return sendJson(res, 200, { ok: true, ...result });
      }

      // Extract summary from conversation
      if (url.pathname === "/api/wizard/extract-summary" && req.method === "POST") {
        const { sessionId, projectId, chatModel, model } = body;
        const id = sessionId || projectId;

        if (!id) return sendJson(res, 400, { error: "sessionId/projectId required" });

        const modelStr = chatModel || model || llms.list()[0];
        if (!modelStr) return sendJson(res, 400, { error: "no LLM model available" });

        // Ensure provider is registered (dynamic registration if needed)
        const ensureProvider = (modelStr) => {
          if (!modelStr.includes(':')) {
            return modelStr;
          }

          const [providerType, modelName] = modelStr.split(':', 2);
          const providerKey = `${providerType}:${modelName}`;

          if (llms.has(providerKey)) return providerKey;

          const keys = configStore.getKeys();
          const apiKey = keys[providerType];

          const cfg = {
            name: providerKey,
            type: providerType,
            apiKey,
            model: modelName,
          };
          llms.register(providerKey, createProvider(cfg));
          return providerKey;
        };

        const modelToUse = ensureProvider(modelStr);
        try {
          const result = await wizardAgent.extractSummary(id, modelToUse);
          const status = result.success ? 200 : 400;
          if (!result.success) {
            console.warn("[Wizard] Summary extraction incomplete:", result.warnings);
          }
          return sendJson(res, status, {
            ok: result.success,
            error: result.success ? undefined : "Summary incomplete. See warnings.",
            warnings: result.warnings,
            projectType: result.projectType,
            initSh: result.initSh,
            packageJson: result.packageJson,
            projectMd: result.projectMd,
            featuresJson: result.featuresJson,
            rawPreview: result.raw?.slice(0, 2000),
          });
        } catch (extractErr) {
          console.error("[Wizard] Extract summary failed:", extractErr.message);
          return sendJson(res, 400, {
            ok: false,
            error: extractErr.message,
            warnings: [],
          });
        }
      }

      // Update features manually
      if (url.pathname === "/api/wizard/features" && req.method === "PUT") {
        const { projectId, features } = body;
        if (!projectId || !features) {
          return sendJson(res, 400, { error: "projectId and features required" });
        }

        wizardAgent.updateFeatures(projectId, features);
        return sendJson(res, 200, { ok: true });
      }

      // Finalize wizard (Page 3: Model Selection)
      if (url.pathname === "/api/wizard/finalize" && req.method === "POST") {
        const { projectId, plannerModel, executorModel, voteModel, summary, projectMd, featuresJson, projectType, initSh, packageJson } = body;
        if (!projectId) return sendJson(res, 400, { error: "projectId required" });
        if (!plannerModel || !executorModel) {
          return sendJson(res, 400, { error: "plannerModel and executorModel required" });
        }

        try {
          const result = await wizardAgent.finalizeWizard(projectId, {
            plannerModel,
            executorModel,
            voteModel: voteModel || executorModel,
            summary,
            projectMd,
            featuresJson,
            projectType,
            initSh,
            packageJson,
          });
          const project = featureStore.getProject(projectId);
          return sendJson(res, 200, { ok: true, ...result, project });
        } catch (err) {
          console.error("[Wizard finalize] Failed:", err);
          return sendJson(res, 500, { error: err.message || "finalize failed" });
        }
      }

      // Cancel wizard
      if (url.pathname === "/api/wizard/cancel" && req.method === "POST") {
        const { projectId, deleteProject } = body;
        if (!projectId) return sendJson(res, 400, { error: "projectId required" });

        wizardAgent.cancelWizard(projectId, deleteProject);
        return sendJson(res, 200, { ok: true });
      }

      // ==================== FEATURE STORE ENDPOINTS ====================

      // Get all projects (from FeatureStore)
      if (url.pathname === "/api/v2/projects" && req.method === "GET") {
        const allProjects = featureStore.getAllProjects();
        return sendJson(res, 200, { projects: allProjects });
      }

      // Get project details
      if (url.pathname.match(/^\/api\/v2\/projects\/[^/]+$/) && req.method === "GET") {
        const projectId = url.pathname.split("/").pop();
        const project = featureStore.getProject(projectId);
        if (!project) return sendJson(res, 404, { error: "project not found" });

        const features = featureStore.getFeaturesByProject(projectId);
        const stats = featureStore.getProjectStats(projectId);
        return sendJson(res, 200, { project, features, stats });
      }

      // Dev server controls
      if (url.pathname.match(/^\/api\/v2\/projects\/[^/]+\/dev-server\/start$/) && req.method === "POST") {
        const projectId = url.pathname.split("/")[4];
        const project = featureStore.getProject(projectId);
        if (!project) return sendJson(res, 404, { error: "project not found" });
        try {
          const info = await serverManager.startServer(project.folder_path, projectId);
          return sendJson(res, 200, { ok: true, ...info });
        } catch (err) {
          return sendJson(res, 500, { error: err.message });
        }
      }

      if (url.pathname.match(/^\/api\/v2\/projects\/[^/]+\/dev-server\/stop$/) && req.method === "POST") {
        const projectId = url.pathname.split("/")[4];
        serverManager.stopServer(projectId);
        return sendJson(res, 200, { ok: true });
      }

      if (url.pathname.match(/^\/api\/v2\/projects\/[^/]+\/dev-server$/) && req.method === "GET") {
        const projectId = url.pathname.split("/")[4];
        const info = serverManager.getServerInfo(projectId);
        return sendJson(res, 200, { running: !!info, info });
      }

      // Update project models
      if (url.pathname.match(/^\/api\/v2\/projects\/[^/]+\/models$/) && req.method === "POST") {
        const parts = url.pathname.split("/");
        const projectId = parts[4];
        const { plannerModel, executorModel, voteModel } = body;
        const project = featureStore.getProject(projectId);
        if (!project) return sendJson(res, 404, { error: "project not found" });
        if (!plannerModel || !executorModel) {
          return sendJson(res, 400, { error: "plannerModel and executorModel are required" });
        }
        featureStore.updateProject(projectId, {
          plannerModel,
          executorModel,
          voteModel: voteModel || executorModel,
        });
        const updated = featureStore.getProject(projectId);
        return sendJson(res, 200, { ok: true, project: updated });
      }

      // Delete project
      if (url.pathname.match(/^\/api\/v2\/projects\/[^/]+$/) && req.method === "DELETE") {
        const projectId = url.pathname.split("/").pop();
        const project = featureStore.getProject(projectId);
        if (!project) return sendJson(res, 404, { error: "project not found" });

        try {
          // 1. Stop any running server for this project
          serverManager.stopServer(projectId);

          // 2. Delete from database (removes features, subtasks, events, wizard messages)
          featureStore.deleteProject(projectId);

          // 3. Delete workspace folder from filesystem
          if (project.folder_path && fs.existsSync(project.folder_path)) {
            fs.rmSync(project.folder_path, { recursive: true, force: true });
            console.log(`[DeleteProject] Deleted workspace folder: ${project.folder_path}`);
          }

          console.log(`[DeleteProject] Successfully deleted project ${projectId} (${project.name})`);
          broadcast({ type: "project-deleted", projectId, name: project.name });

          return sendJson(res, 200, { ok: true, message: `Project "${project.name}" deleted successfully` });
        } catch (err) {
          console.error(`[DeleteProject] Failed to delete project ${projectId}:`, err);
          return sendJson(res, 500, { error: `Failed to delete project: ${err.message}` });
        }
      }

      // Get features for a project
      if (url.pathname === "/api/v2/features" && req.method === "GET") {
        const projectId = url.searchParams.get("projectId");
        if (!projectId) return sendJson(res, 400, { error: "projectId required" });

        const features = featureStore.getFeaturesByProject(projectId);
        return sendJson(res, 200, { features });
      }

      // Get single feature by id
      if (url.pathname.match(/^\/api\/v2\/features\/[^/]+$/) && req.method === "GET") {
        const featureId = url.pathname.split("/").pop();
        const feature = featureStore.getFeature(featureId);
        if (!feature) return sendJson(res, 404, { error: "feature not found" });
        return sendJson(res, 200, { feature });
      }

      // Get next runnable feature
      if (url.pathname === "/api/v2/features/next-runnable" && req.method === "GET") {
        const projectId = url.searchParams.get("projectId");
        if (!projectId) return sendJson(res, 400, { error: "projectId required" });

        const feature = featureStore.getNextRunnableFeature(projectId);
        return sendJson(res, 200, { feature });
      }

      // Create feature
      if (url.pathname === "/api/v2/features" && req.method === "POST") {
        const { projectId, name, description, priority, dependsOn, dod } = body;
        if (!projectId || !name) {
          return sendJson(res, 400, { error: "projectId and name required" });
        }

        // Validate dependencies if provided
        if (dependsOn && dependsOn.length > 0) {
          const features = featureStore.getFeaturesByProject(projectId);
          const maxOrder = Math.max(...features.map((f) => f.order_index || 0), 0);
          const tempId = `temp-${Date.now()}`;
          const validation = featureStore.validateDependencies(tempId, dependsOn);
          if (!validation.valid) {
            return sendJson(res, 400, { error: validation.error });
          }
        }

        const featureId = featureStore.createFeature({
          projectId,
          name,
          description,
          priority: priority || "B",
          dependsOn: dependsOn || [],
          dod,
        });

        const feature = featureStore.getFeature(featureId);
        return sendJson(res, 200, { ok: true, featureId, feature });
      }

      // Update feature
      if (url.pathname.match(/^\/api\/v2\/features\/[^/]+$/) && req.method === "PUT") {
        const featureId = url.pathname.split("/").pop();
        const { name, description, priority, status, dependsOn, dod, technicalSummary, orderIndex } = body;

        // Validate dependencies if updating
        if (dependsOn !== undefined) {
          const validation = featureStore.validateDependencies(featureId, dependsOn);
          if (!validation.valid) {
            return sendJson(res, 400, { error: validation.error });
          }
        }

        featureStore.updateFeature(featureId, {
          name,
          description,
          priority,
          status,
          dependsOn,
          dod,
          technicalSummary,
          orderIndex,
        });

        // If core fields changed, clear subtasks to force re-plan on next execution
        const shouldReset = name !== undefined || description !== undefined || priority !== undefined || dependsOn !== undefined || dod !== undefined;
        if (shouldReset) {
          const subs = featureStore.getSubtasksByFeature(featureId);
          for (const st of subs) {
            featureStore.deleteSubtask(st.id);
          }
          // Reset feature status to pending so it can be replanned
          featureStore.updateFeature(featureId, { status: "pending", technicalSummary: null });
        }

        return sendJson(res, 200, { ok: true });
      }

      // Delete feature
      if (url.pathname.match(/^\/api\/v2\/features\/[^/]+$/) && req.method === "DELETE") {
        const featureId = url.pathname.split("/").pop();
        featureStore.deleteFeature(featureId);
        return sendJson(res, 200, { ok: true });
      }

      // Reorder features
      if (url.pathname === "/api/v2/features/reorder" && req.method === "POST") {
        const { projectId, ordering } = body;
        if (!projectId || !ordering) {
          return sendJson(res, 400, { error: "projectId and ordering required" });
        }

        featureStore.reorderFeatures(projectId, ordering);
        return sendJson(res, 200, { ok: true });
      }

      // Get subtasks for a feature
      if (url.pathname === "/api/v2/subtasks" && req.method === "GET") {
        const featureId = url.searchParams.get("featureId");
        if (!featureId) return sendJson(res, 400, { error: "featureId required" });

        const subtasks = featureStore.getSubtasksByFeature(featureId);
        return sendJson(res, 200, { subtasks });
      }

      // Retry a failed subtask
      if (url.pathname.match(/^\/api\/v2\/subtasks\/[^/]+\/retry$/) && req.method === "POST") {
        const subtaskId = url.pathname.split("/")[4];

        try {
          const result = await featureManager.retrySubtask(subtaskId);
          return sendJson(res, 200, { ok: true, ...result });
        } catch (err) {
          return sendJson(res, 400, { error: err.message });
        }
      }

      // Get events for a project
      if (url.pathname === "/api/v2/events" && req.method === "GET") {
        const projectId = url.searchParams.get("projectId");
        const featureId = url.searchParams.get("featureId");
        const eventType = url.searchParams.get("eventType");
        const limit = parseInt(url.searchParams.get("limit") || "100");

        if (!projectId) return sendJson(res, 400, { error: "projectId required" });

        const events = featureStore.getEvents(projectId, { featureId, eventType, limit });
        return sendJson(res, 200, { events });
      }

      // ==================== FEATURE EXECUTION ENDPOINTS ====================

      // Execute a specific feature
      if (url.pathname.match(/^\/api\/v2\/features\/[^/]+\/execute$/) && req.method === "POST") {
        const featureId = url.pathname.split("/")[4];

        try {
          const result = await featureManager.executeFeature(featureId);
          return sendJson(res, 200, { ok: true, ...result });
        } catch (err) {
          return sendJson(res, 400, { error: err.message });
        }
      }

      // Execute next runnable feature for a project
      if (url.pathname.match(/^\/api\/v2\/projects\/[^/]+\/execute-next$/) && req.method === "POST") {
        const projectId = url.pathname.split("/")[4];
        try {
          const result = await featureManager.executeNextRunnable(projectId);
          if (!result) {
            const blocked = featureManager.getBlockedFeatures(projectId) || [];
            const blockedNames = blocked.map((b) => ({
              id: b.id,
              name: b.name,
              dependsOn: b.depends_on || [],
              status: b.status,
            }));
            return sendJson(res, 200, {
              ok: false,
              message: "No runnable features available",
              blocked: blockedNames,
            });
          }
          return sendJson(res, 200, { ok: true, ...result });
        } catch (err) {
          console.error("[ExecuteNext] Failed:", err);
          return sendJson(res, 500, { ok: false, error: err.message || "execute-next failed" });
        }
      }

      // Pause a running feature
      if (url.pathname.match(/^\/api\/v2\/features\/[^/]+\/pause$/) && req.method === "POST") {
        const featureId = url.pathname.split("/")[4];
        const paused = featureManager.requestPause(featureId);
        return sendJson(res, 200, { ok: paused, message: paused ? "Pause requested" : "Feature not running" });
      }

      // Abort a running feature
      if (url.pathname.match(/^\/api\/v2\/features\/[^/]+\/abort$/) && req.method === "POST") {
        const featureId = url.pathname.split("/")[4];
        const aborted = featureManager.abortFeature(featureId);
        return sendJson(res, 200, { ok: aborted, message: aborted ? "Aborted" : "Feature not running" });
      }

      // Resume a paused feature
      if (url.pathname.match(/^\/api\/v2\/features\/[^/]+\/resume$/) && req.method === "POST") {
        const featureId = url.pathname.split("/")[4];

        try {
          const result = await featureManager.resumeFeature(featureId);
          return sendJson(res, 200, { ok: true, ...result });
        } catch (err) {
          return sendJson(res, 400, { error: err.message });
        }
      }

      // Retry a failed feature (reset to pending and clear subtasks)
      if (url.pathname.match(/^\/api\/v2\/features\/[^/]+\/retry$/) && req.method === "POST") {
        const featureId = url.pathname.split("/")[4];

        try {
          const feature = featureStore.getFeature(featureId);
          if (!feature) {
            return sendJson(res, 404, { error: "Feature not found" });
          }

          // Reset existing subtasks to pending (continue from last failed)
          const subtasks = featureStore.getSubtasksByFeature(featureId);
          for (const subtask of subtasks) {
            const newStatus = subtask.status === "completed" ? "completed" : "pending";
            featureStore.updateSubtask(subtask.id, {
              status: newStatus,
              result: null,
              error: null,
            });
          }

          // Reset feature to pending
          featureStore.updateFeature(featureId, {
            status: 'pending',
            technicalSummary: null
          });

          featureStore.recordEvent(feature.project_id, featureId, null, "feature_retried", {
            previousStatus: feature.status,
            subtasksReset: subtasks.length
          });

          broadcast({ type: "feature-retried", featureId, featureName: feature.name });

          return sendJson(res, 200, {
            ok: true,
            message: `Feature "${feature.name}" reset to pending. Ready for re-execution.`,
            subtasksReset: subtasks.length
          });
        } catch (err) {
          console.error("[Retry Feature] Failed:", err);
          return sendJson(res, 500, { error: err.message });
        }
      }

      // Mark feature as completed (human-in-the-loop approval)
      if (url.pathname.match(/^\/api\/v2\/features\/[^/]+\/mark-completed$/) && req.method === "POST") {
        const featureId = url.pathname.split("/")[4];

        try {
          const updatedFeature = featureManager.markAsCompleted(featureId);
          return sendJson(res, 200, { ok: true, feature: updatedFeature });
        } catch (err) {
          return sendJson(res, 400, { error: err.message });
        }
      }

      // Get execution status for a feature
      if (url.pathname.match(/^\/api\/v2\/features\/[^/]+\/status$/) && req.method === "GET") {
        const featureId = url.pathname.split("/")[4];
        const status = featureManager.getExecutionStatus(featureId);
        if (!status) {
          return sendJson(res, 404, { error: "Feature not found" });
        }
        return sendJson(res, 200, status);
      }

      // Chat with feature (human-in-the-loop conversation)
      if (url.pathname.match(/^\/api\/v2\/features\/[^/]+\/chat$/) && req.method === "POST") {
        const featureId = url.pathname.split("/")[4];
        const { message } = body;

        if (!message) {
          return sendJson(res, 400, { error: "message is required" });
        }

        const feature = featureStore.getFeature(featureId);
        if (!feature) {
          return sendJson(res, 404, { error: "Feature not found" });
        }

        const project = featureStore.getProject(feature.project_id);
        const plannerModel = project?.planner_model;

        if (!plannerModel) {
          return sendJson(res, 400, { error: "No planner model configured for project" });
        }

        try {
          // Ensure provider is registered
          const providerKey = featureManager._ensureProvider(plannerModel);
          const provider = llms.get(providerKey);

          if (!provider) {
            return sendJson(res, 400, { error: `Provider not found: ${plannerModel}` });
          }

          // Get context
          const subtasks = featureStore.getSubtasksByFeature(featureId);
          const completedCount = subtasks.filter(st => st.status === 'completed').length;

          const prompt = `You are an AI assistant helping with feature development in Ultracode.

**Feature:** ${feature.name}
**Description:** ${feature.description || 'No description'}
**Priority:** ${feature.priority} (A=Essential, B=Important, C=Nice-to-have)
**Status:** ${feature.status}
**Progress:** ${completedCount}/${subtasks.length} subtasks completed

**User Message:** ${message}

Provide a helpful response. If the user is asking about the feature status or next steps, be specific. If they're reporting an issue, acknowledge it and suggest potential solutions.

Keep responses concise and actionable.`;

          const response = await provider.generate(prompt);
          const normalized = normalizeLLMResponse(response, provider);
          if (resourceMonitor && project?.id) {
            resourceMonitor.recordProjectPrompt(project.id, normalized.model, prompt, normalized.content, {
              usage: normalized.usage,
            });
          }

          // Record chat event
          featureStore.recordEvent(project.id, featureId, null, "feature_chat", {
            userMessage: message.substring(0, 100),
            responsePreview: normalized.content.substring(0, 100),
          });

          return sendJson(res, 200, { ok: true, response: normalized.content });
        } catch (err) {
          console.error("[Feature Chat] Error:", err);
          return sendJson(res, 500, { error: err.message });
        }
      }

      // Add subtask via chat (for feature adjustments)
      if (url.pathname.match(/^\/api\/v2\/features\/[^/]+\/add-requirement$/) && req.method === "POST") {
        const featureId = url.pathname.split("/")[4];
        const { requirement, model } = body;

        if (!requirement) {
          return sendJson(res, 400, { error: "requirement is required" });
        }

        const feature = featureStore.getFeature(featureId);
        if (!feature) {
          return sendJson(res, 404, { error: "Feature not found" });
        }

        const project = featureStore.getProject(feature.project_id);
        const plannerModel = model || project?.planner_model || llms.list()[0];

        if (!plannerModel) {
          return sendJson(res, 400, { error: "No planner model available" });
        }

        // Load context
        const projectMdPath = path.join(project.folder_path, "project.md");
        let projectMd = "";
        try {
          projectMd = fs.readFileSync(projectMdPath, "utf8");
        } catch {}

        const existingSubtasks = featureStore.getSubtasksByFeature(featureId);

        const { addSubtasksFromRequirement } = require("./featurePlanner");
        const newSubtasks = await addSubtasksFromRequirement({
          feature,
          requirement,
          existingSubtasks,
          context: { projectMd },
          llmRegistry: llms,
          plannerModel,
          configStore,
          resourceMonitor,
        });

        // Create new subtasks
        const createdIds = [];
        for (const st of newSubtasks) {
          const id = featureStore.createSubtask({
            featureId,
            intent: st.intent,
            applyType: st.apply?.type,
            applyPath: st.apply?.path,
          });
          createdIds.push(id);
        }

        featureStore.recordEvent(project.id, featureId, null, "subtasks_added_from_requirement", {
          requirement: requirement.substring(0, 100),
          count: createdIds.length,
        });

        return sendJson(res, 200, {
          ok: true,
          subtasksAdded: createdIds.length,
          subtaskIds: createdIds,
        });
      }

      // Get project.md content
      if (url.pathname === "/api/v2/project-md" && req.method === "GET") {
        const projectId = url.searchParams.get("projectId");
        if (!projectId) return sendJson(res, 400, { error: "projectId required" });

        const project = featureStore.getProject(projectId);
        if (!project) return sendJson(res, 404, { error: "project not found" });

        const projectMdPath = path.join(project.folder_path, "project.md");
        let content = "";
        try {
          content = fs.readFileSync(projectMdPath, "utf8");
        } catch {
          content = "";
        }

        return sendJson(res, 200, { content, path: projectMdPath });
      }

      // Update project.md content
      if (url.pathname === "/api/v2/project-md" && req.method === "PUT") {
        const { projectId, content } = body;
        if (!projectId || content === undefined) {
          return sendJson(res, 400, { error: "projectId and content required" });
        }

        const project = featureStore.getProject(projectId);
        if (!project) return sendJson(res, 404, { error: "project not found" });

        const projectMdPath = path.join(project.folder_path, "project.md");
        fs.writeFileSync(projectMdPath, content, "utf8");

        featureStore.recordEvent(projectId, null, null, "project_md_updated", {
          length: content.length,
        });

        return sendJson(res, 200, { ok: true });
      }

      // ==================== TESTING ENDPOINTS ====================

      // Get server status for a project
      if (url.pathname.match(/^\/api\/test\/server\/[^/]+$/) && req.method === "GET") {
        const projectId = url.pathname.split("/")[4];
        const serverInfo = serverManager.getServerInfo(projectId);

        if (!serverInfo) {
          return sendJson(res, 200, { running: false });
        }

        return sendJson(res, 200, { running: true, ...serverInfo });
      }

      // Start dev server for a project
      if (url.pathname.match(/^\/api\/test\/server\/[^/]+\/start$/) && req.method === "POST") {
        const projectId = url.pathname.split("/")[4];

        const project = featureStore.getProject(projectId);
        if (!project) return sendJson(res, 404, { error: "project not found" });

        try {
          const { url: serverUrl, port } = await serverManager.startServer(project.folder_path, projectId);
          return sendJson(res, 200, { ok: true, url: serverUrl, port });
        } catch (err) {
          return sendJson(res, 500, { error: err.message });
        }
      }

      // Stop dev server for a project
      if (url.pathname.match(/^\/api\/test\/server\/[^/]+\/stop$/) && req.method === "POST") {
        const projectId = url.pathname.split("/")[4];

        serverManager.stopServer(projectId);
        return sendJson(res, 200, { ok: true });
      }

      // Test a specific feature
      if (url.pathname.match(/^\/api\/test\/feature\/[^/]+$/) && req.method === "POST") {
        const featureId = url.pathname.split("/")[4];

        const feature = featureStore.getFeature(featureId);
        if (!feature) return sendJson(res, 404, { error: "feature not found" });

        const project = featureStore.getProject(feature.project_id);
        if (!project) return sendJson(res, 404, { error: "project not found" });

        try {
          // Start server
          const { url: serverUrl } = await serverManager.startServer(project.folder_path, project.id);

          // Prepare screenshot path
          const screenshotDir = path.join(project.folder_path, ".ultracode", "screenshots");
          fs.mkdirSync(screenshotDir, { recursive: true });
          const screenshotPath = path.join(screenshotDir, `${featureId}-${Date.now()}.png`);

          // Run test
          const testResult = await testRunner.testFeature({
            url: serverUrl,
            featureName: feature.name,
            featureDescription: feature.description || "",
            dod: feature.dod || "Feature works as described",
            voteModel: project.vote_model || project.executor_model,
            screenshotPath,
          });

          // Generate manual test instructions if needed
          const manualInstructions = testRunner.generateManualTestInstructions(feature);

          return sendJson(res, 200, {
            ok: true,
            testResult,
            manualInstructions
          });
        } catch (err) {
          return sendJson(res, 500, { error: err.message });
        }
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
