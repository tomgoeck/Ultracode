const { OpenAIProvider } = require("./providers/openaiProvider");
const { ClaudeProvider } = require("./providers/claudeProvider");
const { GeminiProvider } = require("./providers/geminiProvider");
const { LMStudioProvider } = require("./providers/lmstudioProvider");
const { EchoProvider } = require("./llmRegistry");

/**
 * Creates provider instances based on a config object.
 * @param {{ type: string, name: string, apiKey?: string, model: string, baseUrl?: string }} cfg
 */
function createProvider(cfg) {
  const common = { model: cfg.model, baseUrl: cfg.baseUrl };
  switch (cfg.type) {
    case "openai":
      return new OpenAIProvider({ apiKey: cfg.apiKey || "", ...common });
    case "claude":
      return new ClaudeProvider({ apiKey: cfg.apiKey || "", ...common });
    case "gemini":
      return new GeminiProvider({ apiKey: cfg.apiKey || "", ...common });
    case "lmstudio":
      return new LMStudioProvider(common);
    case "echo":
      return new EchoProvider({ model: cfg.model || "echo-stub", noisy: true });
    default:
      throw new Error(`Unknown provider type: ${cfg.type}`);
  }
}

module.exports = { createProvider };
