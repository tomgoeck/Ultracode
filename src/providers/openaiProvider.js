// OpenAI provider: chat completions + model listing.
class OpenAIProvider {
  /**
   * @param {{ apiKey: string, model: string, baseUrl?: string }} opts
   */
  constructor({ apiKey, model, baseUrl = "https://api.openai.com/v1" }) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.name = "openai";
  }

  async generate(prompt, options = {}) {
    if (!this.apiKey) throw new Error("OpenAI API key missing");
    const body = {
      model: this.model,
      messages: [{ role: "user", content: prompt }],
      temperature: options.temperature ?? 0.2,
      max_tokens: options.maxTokens ?? 512,
    };
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenAI generate failed: ${res.status} ${text}`);
    }
    const json = await res.json();
    return json.choices?.[0]?.message?.content || "";
  }

  async listModels() {
    if (!this.apiKey) throw new Error("OpenAI API key missing");
    const res = await fetch(`${this.baseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenAI listModels failed: ${res.status} ${text}`);
    }
    const json = await res.json();
    return (json.data || []).map((m) => m.id);
  }
}

module.exports = { OpenAIProvider };
