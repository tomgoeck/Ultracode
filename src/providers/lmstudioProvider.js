// LM Studio provider: OpenAI-compatible local endpoint, typically http://localhost:1234/v1
const { logLLMRequest, logLLMResponse } = require("../llmLogger");
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
    // Cap at a safe value to avoid LM Studio context overflows on smaller models.
    // Allow overriding via LMSTUDIO_MAX_TOKENS env var when larger outputs are needed.
    const requested = options.maxTokens ?? 30000;
    const capEnv = Number.parseInt(process.env.LMSTUDIO_MAX_TOKENS || "", 10);
    const cap = Number.isFinite(capEnv) && capEnv > 0 ? capEnv : 8000;
    const maxTokens = Math.min(requested, cap);

    let lastError = null;

    // Prefer chat/completions (most local chat models expect this)
    const chatBody = {
      model: this.model,
      messages: [{ role: "user", content: prompt }],
      temperature: temp,
      max_tokens: maxTokens,
    };
    logLLMRequest({
      provider: "lmstudio",
      model: this.model,
      prompt,
      options: { temperature: temp, maxTokens },
      meta: { endpoint: "/chat/completions" },
    });
    const chatRes = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(chatBody),
    }).catch((err) => {
      lastError = err;
      return null;
    });
    if (chatRes && chatRes.ok) {
      const json = await chatRes.json().catch(() => ({}));
      const text = json.choices?.[0]?.message?.content || json.choices?.[0]?.text;
      if (typeof text === "string") {
        const cleaned = sanitizeOutput(text);
        logLLMResponse({
          provider: "lmstudio",
          model: this.model,
          content: cleaned,
          raw: json,
          meta: { endpoint: "/chat/completions" },
        });
        return cleaned;
      }
      lastError = new Error("LM Studio chat returned empty response");
    } else if (chatRes) {
      const text = await chatRes.text();
      lastError = new Error(`LM Studio chat failed: ${chatRes.status} ${text}`);
    }

    // Fallback to completions endpoint (some LM Studio builds expect /completions)
    const completionBody = {
      model: this.model,
      prompt,
      temperature: temp,
      max_tokens: maxTokens,
    };
    logLLMRequest({
      provider: "lmstudio",
      model: this.model,
      prompt,
      options: { temperature: temp, maxTokens },
      meta: { endpoint: "/completions" },
    });
    const completionRes = await fetch(`${this.baseUrl}/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(completionBody),
    }).catch((err) => {
      lastError = err;
      return null;
    });
    if (completionRes && completionRes.ok) {
      const json = await completionRes.json().catch(() => ({}));
      const text = json.choices?.[0]?.text;
      if (typeof text === "string") {
        const cleaned = sanitizeOutput(text);
        logLLMResponse({
          provider: "lmstudio",
          model: this.model,
          content: cleaned,
          raw: json,
          meta: { endpoint: "/completions" },
        });
        return cleaned;
      }
      lastError = new Error("LM Studio completions returned empty response");
    } else if (completionRes) {
      const text = await completionRes.text();
      lastError = new Error(`LM Studio completion failed: ${completionRes.status} ${text}`);
    }

    throw lastError || new Error("LM Studio generate failed");
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

function sanitizeOutput(text) {
  if (!text || typeof text !== "string") return text;
  let cleaned = text;

  const finalMatch = cleaned.match(/<\|channel\|>\s*final<\|message\|>([\s\S]*)$/);
  if (finalMatch && finalMatch[1]) {
    cleaned = finalMatch[1];
  } else {
    const parts = cleaned.split(/<\|start\|>assistant/);
    if (parts.length > 1) {
      cleaned = parts[parts.length - 1];
    }
  }

  cleaned = cleaned.replace(/<\|[^>]*\|>/g, "");
  return cleaned.trim();
}
