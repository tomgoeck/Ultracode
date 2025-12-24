/**
 * ResourceMonitor - Tracks token usage and estimates API costs
 *
 * Provides transparency into LLM resource consumption per task/step.
 */
class ResourceMonitor {
  constructor({ featureStore } = {}) {
    // Pricing per 1000 tokens (USD) - updated as of Dec 2024
    this.tokenPricing = {
      // OpenAI
      "gpt-4o": { input: 0.005, output: 0.015 },
      "gpt-4o-mini": { input: 0.00015, output: 0.0006 },
      "gpt-4-turbo": { input: 0.01, output: 0.03 },
      "gpt-4": { input: 0.03, output: 0.06 },
      "gpt-3.5-turbo": { input: 0.0005, output: 0.0015 },
      "o1-preview": { input: 0.015, output: 0.06 },
      "o1-mini": { input: 0.003, output: 0.012 },

      // Anthropic Claude
      "claude-3-opus-20240229": { input: 0.015, output: 0.075 },
      "claude-3-sonnet-20240229": { input: 0.003, output: 0.015 },
      "claude-3-haiku-20240307": { input: 0.00025, output: 0.00125 },
      "claude-3-5-sonnet-20241022": { input: 0.003, output: 0.015 },
      "claude-3-5-haiku-20241022": { input: 0.0008, output: 0.004 },

      // Google Gemini
      "gemini-pro": { input: 0.0005, output: 0.0015 },
      "gemini-1.5-pro": { input: 0.00125, output: 0.005 },
      "gemini-1.5-flash": { input: 0.000075, output: 0.0003 },

      // Together AI (common models)
      "meta-llama/Llama-3-70b-chat-hf": { input: 0.0009, output: 0.0009 },
      "mistralai/Mixtral-8x7B-Instruct-v0.1": { input: 0.0006, output: 0.0006 },

      // Local (zero cost)
      "echo": { input: 0, output: 0 },
      "echo-strong": { input: 0, output: 0 },
      "echo-vote": { input: 0, output: 0 },
    };

    this.taskMetrics = new Map(); // taskId -> metrics
    this.projectMetrics = new Map(); // projectId -> { models: { modelName: { tokens, cost } } }
    this.featureStore = featureStore || null;
  }

  /**
   * Estimate tokens using simple heuristic: ~4 characters per token
   * @param {string} text
   * @returns {number}
   */
  estimateTokens(text) {
    if (!text || typeof text !== "string") return 0;
    return Math.ceil(text.length / 4);
  }

  /**
   * Record a prompt call for a task/step
   * @param {string} taskId
   * @param {string} stepId
   * @param {string} model
   * @param {string} prompt
   * @param {string} output
   */
  recordPromptCall(taskId, stepId, model, prompt, output, options = {}) {
    const { usage, projectId, role } = options;
    const tokens = this.resolveUsage(prompt, output, usage);
    const inputTokens = tokens.inputTokens;
    const outputTokens = tokens.outputTokens;

    const pricing = this.tokenPricing[model] || { input: 0, output: 0 };
    const cost = ((inputTokens * pricing.input) + (outputTokens * pricing.output)) / 1000;

    if (!this.taskMetrics.has(taskId)) {
      this.taskMetrics.set(taskId, {
        taskId,
        steps: [],
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 0,
        totalCost: 0,
        models: new Set(),
        startTime: Date.now(),
      });
    }

    const metrics = this.taskMetrics.get(taskId);
    metrics.steps.push({
      stepId,
      model,
      inputTokens,
      outputTokens,
      totalTokens: tokens.totalTokens,
      cost,
      timestamp: Date.now(),
    });
    metrics.totalInputTokens += inputTokens;
    metrics.totalOutputTokens += outputTokens;
    metrics.totalTokens += tokens.totalTokens;
    metrics.totalCost += cost;
    metrics.models.add(model);

    if (projectId) {
      this.recordProjectPrompt(projectId, model, prompt, output, { usage, tokens, role });
    }
  }

  /**
   * Record command execution (no token cost, but track for completeness)
   * @param {string} taskId
   * @param {string} stepId
   * @param {string} command
   * @param {string} output
   */
  recordCommandExecution(taskId, stepId, command, output) {
    if (!this.taskMetrics.has(taskId)) {
      this.taskMetrics.set(taskId, {
        taskId,
        steps: [],
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 0,
        totalCost: 0,
        models: new Set(),
        startTime: Date.now(),
      });
    }

    const metrics = this.taskMetrics.get(taskId);
    metrics.steps.push({
      stepId,
      type: "command",
      command,
      outputLength: output?.length || 0,
      timestamp: Date.now(),
    });
  }

  /**
   * Get metrics for a specific task
   * @param {string} taskId
   * @returns {Object|null}
   */
  getTaskMetrics(taskId) {
    const metrics = this.taskMetrics.get(taskId);
    if (!metrics) return null;

    return {
      ...metrics,
      models: Array.from(metrics.models),
      duration: Date.now() - metrics.startTime,
      avgCostPerStep: metrics.steps.length ? (metrics.totalCost / metrics.steps.length) : 0,
      avgTokensPerStep: metrics.steps.length ? (metrics.totalTokens / metrics.steps.length) : 0,
    };
  }

  /**
   * Get metrics for all tasks
   * @returns {Array}
   */
  getAllMetrics() {
    return Array.from(this.taskMetrics.values()).map(m => ({
      ...m,
      models: Array.from(m.models),
      duration: Date.now() - m.startTime,
      avgCostPerStep: m.steps.length ? (m.totalCost / m.steps.length) : 0,
      avgTokensPerStep: m.steps.length ? (m.totalTokens / m.steps.length) : 0,
    }));
  }

  /**
   * Get summary stats across all tasks
   * @returns {Object}
   */
  getSummary() {
    const all = this.getAllMetrics();
    return {
      taskCount: all.length,
      totalCost: all.reduce((sum, m) => sum + m.totalCost, 0),
      totalTokens: all.reduce((sum, m) => sum + m.totalTokens, 0),
      totalInputTokens: all.reduce((sum, m) => sum + m.totalInputTokens, 0),
      totalOutputTokens: all.reduce((sum, m) => sum + m.totalOutputTokens, 0),
      uniqueModels: [...new Set(all.flatMap(m => m.models))],
    };
  }

  /**
   * Clear metrics for a task (e.g., after completion)
   * @param {string} taskId
   */
  clearTask(taskId) {
    this.taskMetrics.delete(taskId);
  }

  /**
   * Clear all metrics
   */
  clearAll() {
    this.taskMetrics.clear();
    this.projectMetrics.clear();
  }

  /**
   * Record prompt call for a project (aggregates by model)
   * @param {string} projectId
   * @param {string} model
   * @param {string} prompt
   * @param {string} output
   */
  recordProjectPrompt(projectId, model, prompt, output, options = {}) {
    const tokens = options.tokens || this.resolveUsage(prompt, output, options.usage);
    const role = options.role;
    const inputTokens = tokens.inputTokens;
    const outputTokens = tokens.outputTokens;
    const totalTokens = tokens.totalTokens;

    const pricing = this.tokenPricing[model] || { input: 0, output: 0 };
    const cost = ((inputTokens * pricing.input) + (outputTokens * pricing.output)) / 1000;

    if (!this.projectMetrics.has(projectId)) {
      this.projectMetrics.set(projectId, {
        projectId,
        models: {},
        totalTokens: 0,
        totalCost: 0,
        lastUpdated: Date.now(),
      });
    }

    const projectData = this.projectMetrics.get(projectId);

    if (!projectData.models[model]) {
      projectData.models[model] = {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cost: 0,
        calls: 0,
      };
    }

    const modelData = projectData.models[model];
    modelData.inputTokens += inputTokens;
    modelData.outputTokens += outputTokens;
    modelData.totalTokens += totalTokens;
    modelData.cost += cost;
    modelData.calls += 1;

    projectData.totalTokens += totalTokens;
    projectData.totalCost += cost;
    projectData.lastUpdated = Date.now();

    if (this.featureStore && typeof this.featureStore.recordModelUsage === "function") {
      this.featureStore.recordModelUsage({
        projectId,
        model,
        inputTokens,
        outputTokens,
        totalTokens,
      });
    }

    if (role && this.featureStore && typeof this.featureStore.recordModelUsageByRole === "function") {
      this.featureStore.recordModelUsageByRole({
        projectId,
        role,
        model,
        inputTokens,
        outputTokens,
        totalTokens,
      });
    }
  }

  /**
   * Get metrics for a specific project
   * @param {string} projectId
   * @returns {Object|null}
   */
  getProjectMetrics(projectId) {
    if (this.featureStore && typeof this.featureStore.getProjectModelUsage === "function") {
      const rows = this.featureStore.getProjectModelUsage(projectId);
      if (!rows || !rows.length) return null;
      return this.formatProjectMetrics(projectId, rows.map((row) => ({
        name: row.model,
        inputTokens: row.input_tokens || 0,
        outputTokens: row.output_tokens || 0,
        totalTokens: row.total_tokens || 0,
        calls: row.calls || 0,
        updatedAt: row.updated_at || null,
      })));
    }

    const metrics = this.projectMetrics.get(projectId);
    if (!metrics) return null;
    const models = Object.entries(metrics.models).map(([name, data]) => ({
      name,
      inputTokens: data.inputTokens || 0,
      outputTokens: data.outputTokens || 0,
      totalTokens: data.totalTokens || 0,
      cost: data.cost || 0,
      calls: data.calls || 0,
    }));
    return this.formatProjectMetrics(projectId, models, metrics.lastUpdated);
  }

  getProjectRoleUsage(projectId) {
    if (this.featureStore && typeof this.featureStore.getProjectRoleUsage === "function") {
      return this.featureStore.getProjectRoleUsage(projectId);
    }
    return [];
  }

  resolveUsage(prompt, output, usage) {
    let inputTokens = usage?.inputTokens ?? null;
    let outputTokens = usage?.outputTokens ?? null;
    let totalTokens = usage?.totalTokens ?? null;

    if (totalTokens == null && (inputTokens != null || outputTokens != null)) {
      totalTokens = (inputTokens || 0) + (outputTokens || 0);
    }

    if (totalTokens == null) {
      inputTokens = this.estimateTokens(prompt);
      outputTokens = this.estimateTokens(output);
      totalTokens = inputTokens + outputTokens;
      return { inputTokens, outputTokens, totalTokens };
    }

    if (inputTokens == null || outputTokens == null) {
      const estimatedInput = this.estimateTokens(prompt);
      if (inputTokens == null) {
        inputTokens = Math.min(estimatedInput, totalTokens);
      }
      if (outputTokens == null) {
        outputTokens = Math.max(totalTokens - inputTokens, 0);
      }
    }

    return { inputTokens, outputTokens, totalTokens };
  }

  formatProjectMetrics(projectId, models, lastUpdated = null) {
    const normalized = models.map((entry) => {
      const inputTokens = Number.isFinite(entry.inputTokens) ? entry.inputTokens : Number(entry.inputTokens) || 0;
      const outputTokens = Number.isFinite(entry.outputTokens) ? entry.outputTokens : Number(entry.outputTokens) || 0;
      const totalTokens = Number.isFinite(entry.totalTokens) ? entry.totalTokens : Number(entry.totalTokens) || (inputTokens + outputTokens);
      const pricing = this.tokenPricing[entry.name] || { input: 0, output: 0 };
      const cost = ((inputTokens * pricing.input) + (outputTokens * pricing.output)) / 1000;
      return {
        name: entry.name,
        inputTokens,
        outputTokens,
        totalTokens,
        calls: entry.calls || 0,
        cost,
        costFormatted: `$${cost.toFixed(4)}`,
        tokensFormatted: this.formatTokens(totalTokens),
        updatedAt: entry.updatedAt || null,
      };
    });

    const totalTokens = normalized.reduce((sum, m) => sum + (m.totalTokens || 0), 0);
    const totalCost = normalized.reduce((sum, m) => sum + (m.cost || 0), 0);
    const updated = lastUpdated || normalized.reduce((max, m) => Math.max(max, m.updatedAt || 0), 0) || Date.now();

    return {
      projectId,
      models: normalized,
      totalTokens,
      totalCost,
      totalCostFormatted: `$${totalCost.toFixed(4)}`,
      totalTokensFormatted: this.formatTokens(totalTokens),
      lastUpdated: updated,
    };
  }

  formatTokens(count) {
    const safe = Number.isFinite(count) ? count : 0;
    return `${safe.toLocaleString()} tokens`;
  }
}

module.exports = { ResourceMonitor };
