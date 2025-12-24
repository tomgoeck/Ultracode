/**
 * Normalize provider responses so callers can handle string or structured payloads.
 * @param {string|{content?: string, text?: string, output?: string, usage?: Object, model?: string, raw?: any}} response
 * @param {Object} provider
 * @returns {{ content: string, usage: Object|null, model: string, raw: any }}
 */
function normalizeLLMResponse(response, provider) {
  if (response && typeof response === "object") {
    const content = typeof response.content === "string"
      ? response.content
      : typeof response.text === "string"
        ? response.text
        : typeof response.output === "string"
          ? response.output
          : "";
    const usage = response.usage && typeof response.usage === "object" ? response.usage : null;
    const model = response.model || provider?.model || provider?.name || "unknown";
    return {
      content,
      usage,
      model,
      raw: response.raw || response,
    };
  }

  const content = typeof response === "string" ? response : "";
  return {
    content,
    usage: null,
    model: provider?.model || provider?.name || "unknown",
    raw: response,
  };
}

module.exports = { normalizeLLMResponse };
