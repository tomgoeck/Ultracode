const DEFAULT_LOG_MODE = "full";
const LOG_MODE = (process.env.ULTRACODE_LLM_LOG || process.env.LLM_LOG || DEFAULT_LOG_MODE).toLowerCase();
const MAX_CHARS = Number.parseInt(
  process.env.ULTRACODE_LLM_LOG_MAX_CHARS || process.env.LLM_LOG_MAX_CHARS || "",
  10
);
const PREVIEW_CHARS = Number.parseInt(
  process.env.ULTRACODE_LLM_LOG_PREVIEW_CHARS || "400",
  10
);

function isEnabled() {
  return LOG_MODE !== "off";
}

function clip(text) {
  if (typeof text !== "string") return "";
  let output = text;
  if (LOG_MODE === "preview" && Number.isFinite(PREVIEW_CHARS) && PREVIEW_CHARS > 0) {
    if (output.length > PREVIEW_CHARS) {
      output = `${output.slice(0, PREVIEW_CHARS)}...`;
    }
  }
  if (Number.isFinite(MAX_CHARS) && MAX_CHARS > 0 && output.length > MAX_CHARS) {
    output = `${output.slice(0, MAX_CHARS)}...`;
  }
  return output;
}

function formatUsage(usage) {
  if (!usage || typeof usage !== "object") return null;
  const parts = [];
  if (usage.inputTokens != null) parts.push(`in=${usage.inputTokens}`);
  if (usage.outputTokens != null) parts.push(`out=${usage.outputTokens}`);
  if (usage.totalTokens != null) parts.push(`total=${usage.totalTokens}`);
  return parts.length ? parts.join(", ") : null;
}

function buildHeader(prefix, provider, parts = []) {
  const cleanParts = parts.filter(Boolean);
  const suffix = cleanParts.length ? ` (${cleanParts.join(", ")})` : "";
  return `[${prefix}] ${provider || "unknown"}${suffix}`;
}

/**
 * Log an LLM request in the terminal.
 * @param {{ provider?: string, model?: string, prompt?: string, options?: { temperature?: number, maxTokens?: number }, meta?: { endpoint?: string, note?: string } }} params
 */
function logLLMRequest({ provider, model, prompt, options, meta } = {}) {
  if (!isEnabled()) return;
  const parts = [];
  if (model) parts.push(`model=${model}`);
  if (options && options.temperature !== undefined) parts.push(`temp=${options.temperature}`);
  if (options && options.maxTokens !== undefined) parts.push(`maxTokens=${options.maxTokens}`);
  if (meta?.endpoint) parts.push(`endpoint=${meta.endpoint}`);
  console.log(buildHeader("LLM REQUEST", provider, parts));
  if (meta?.note) console.log(meta.note);
  if (typeof prompt === "string") {
    console.log(clip(prompt));
  }
}

/**
 * Log an LLM response in the terminal.
 * @param {{ provider?: string, model?: string, content?: string, usage?: Object, raw?: any, meta?: { endpoint?: string, note?: string } }} params
 */
function logLLMResponse({ provider, model, content, usage, raw, meta } = {}) {
  if (!isEnabled()) return;
  const parts = [];
  if (model) parts.push(`model=${model}`);
  const usageLabel = formatUsage(usage);
  if (usageLabel) parts.push(`tokens=${usageLabel}`);
  if (meta?.endpoint) parts.push(`endpoint=${meta.endpoint}`);
  console.log(buildHeader("LLM RESPONSE", provider, parts));
  if (meta?.note) console.log(meta.note);
  if (typeof content === "string" && content.length > 0) {
    console.log(clip(content));
  } else if (raw !== undefined) {
    console.log(clip(JSON.stringify(raw, null, 2)));
  } else {
    console.log("(empty response)");
  }
}

module.exports = {
  logLLMRequest,
  logLLMResponse,
};
