// LM Studio provider: OpenAI-compatible local endpoint, typically http://localhost:1234/v1
class LMStudioProvider {
  /**
   * @param {{ model: string, baseUrl?: string }} opts
   */
  constructor({ model, baseUrl }) {
    this.model = model;
    const sanitizedBase = sanitizeBase(baseUrl);
    this.baseUrl = sanitizedBase;
    this.name = "lmstudio";
  }

  async generate(prompt, options = {}) {
    const temp = options.temperature ?? 0.2;
    const maxTokens = options.maxTokens ?? 512;

    // Try completions endpoint first (some LM Studio builds expect /completions)
    const completionBody = {
      model: this.model,
      prompt,
      temperature: temp,
      max_tokens: maxTokens,
    };
    const completionRes = await fetch(`${this.baseUrl}/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(completionBody),
    });
    if (completionRes.ok) {
      const json = await completionRes.json().catch(() => ({}));
      const text = json.choices?.[0]?.text;
      if (typeof text === "string") return text;
    }

    // Fallback to chat/completions
    const chatBody = {
      model: this.model,
      messages: [{ role: "user", content: prompt }],
      temperature: temp,
      max_tokens: maxTokens,
    };
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(chatBody),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`LM Studio generate failed: ${res.status} ${text}`);
    }
    const json = await res.json();
    return json.choices?.[0]?.message?.content || json.choices?.[0]?.text || "";
  }

  async listModels() {
    let res = await fetch(`${this.baseUrl}/models`);
    if (!res.ok) {
      // Try chat-style path if baseUrl didn't include /v1
      res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/v1/models`);
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`LM Studio listModels failed: ${res.status} ${text}`);
    }
    const json = await res.json();
    return (json.data || []).map((m) => m.id || m.model || m.name);
  }
}

module.exports = { LMStudioProvider };

function sanitizeBase(input) {
  let base = (input || "").trim();
  if (!base) base = "http://localhost:1234";
  // if missing protocol, prefix http://
  if (!/^https?:\/\//i.test(base)) {
    base = `http://${base}`;
  }
  // ensure /v1 suffix
  if (!/\/v1$/.test(base)) {
    base = `${base.replace(/\/$/, "")}/v1`;
  }
  return base;
}
