// Anthropic Claude provider: messages + model listing.
class ClaudeProvider {
  /**
   * @param {{ apiKey: string, model: string, baseUrl?: string }} opts
   */
  constructor({ apiKey, model, baseUrl = "https://api.anthropic.com" }) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.name = "claude";
  }

  async generate(prompt, options = {}) {
    if (!this.apiKey) throw new Error("Anthropic API key missing");
    const body = {
      model: this.model,
      max_tokens: options.maxTokens ?? 512,
      temperature: options.temperature ?? 0.2,
      messages: [{ role: "user", content: prompt }],
    };
    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Claude generate failed: ${res.status} ${text}`);
    }
    const json = await res.json();
    const content = json.content?.[0]?.text || "";
    const usage = json.usage ? {
      inputTokens: json.usage.input_tokens ?? null,
      outputTokens: json.usage.output_tokens ?? null,
      totalTokens: json.usage.total_tokens ?? null,
    } : null;
    return {
      content,
      usage,
      model: json.model || this.model,
      raw: json,
    };
  }

  async listModels() {
    if (!this.apiKey) throw new Error("Anthropic API key missing");
    const res = await fetch(`${this.baseUrl}/v1/models`, {
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Claude listModels failed: ${res.status} ${text}`);
    }
    const json = await res.json();
    return (json.data || []).map((m) => m.id);
  }
}

module.exports = { ClaudeProvider };
