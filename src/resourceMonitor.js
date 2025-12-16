/**
 * ResourceMonitor - Tracks token usage and estimates API costs
 *
 * Provides transparency into LLM resource consumption per task/step.
 */
class ResourceMonitor {
  constructor() {
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
  recordPromptCall(taskId, stepId, model, prompt, output) {
    const inputTokens = this.estimateTokens(prompt);
    const outputTokens = this.estimateTokens(output);

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
      totalTokens: inputTokens + outputTokens,
      cost,
      timestamp: Date.now(),
    });
    metrics.totalInputTokens += inputTokens;
    metrics.totalOutputTokens += outputTokens;
    metrics.totalTokens += inputTokens + outputTokens;
    metrics.totalCost += cost;
    metrics.models.add(model);
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
  }
}

module.exports = { ResourceMonitor };
