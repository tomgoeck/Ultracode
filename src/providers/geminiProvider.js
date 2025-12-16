// Google Gemini provider: generateContent + model listing.
class GeminiProvider {
  /**
   * @param {{ apiKey: string, model: string, baseUrl?: string }} opts
   */
  constructor({ apiKey, model, baseUrl = "https://generativelanguage.googleapis.com" }) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.name = "gemini";
  }

  async generate(prompt, options = {}) {
    if (!this.apiKey) throw new Error("Gemini API key missing");
    const body = {
      contents: [{ parts: [{ text: prompt }], role: "user" }],
      generationConfig: {
        temperature: options.temperature ?? 0.2,
        maxOutputTokens: options.maxTokens ?? 512,
      },
    };
    const res = await fetch(
      `${this.baseUrl}/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Gemini generate failed: ${res.status} ${text}`);
    }
    const json = await res.json();
    const parts = json.candidates?.[0]?.content?.parts || [];
    return parts.map((p) => p.text || "").join("\n");
  }

  async listModels() {
    if (!this.apiKey) throw new Error("Gemini API key missing");
    const res = await fetch(
      `${this.baseUrl}/v1beta/models?key=${this.apiKey}&pageSize=200`
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Gemini listModels failed: ${res.status} ${text}`);
    }
    const json = await res.json();
    return (json.models || [])
        .filter(m => {
            const name = m.name.toLowerCase();
            const isVersioned = /-00\d$/.test(name) || /-latest$/.test(name);
            return name.includes("gemini") && !name.includes("embedding") && !isVersioned;
        })
        .map((m) => m.name.replace("models/", "")) // remove 'models/' prefix for cleaner UI
        .sort();
  }
}

module.exports = { GeminiProvider };
