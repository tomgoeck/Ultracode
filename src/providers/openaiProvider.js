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

    const isReasoningModel = this.model.startsWith("o1") || this.model.startsWith("o3");
    // Models that only support temperature=1
    const fixedTemperature = isReasoningModel ||
                            this.model.includes("gpt-4.1") ||
                            this.model.includes("gpt-5");
    // New models (gpt-4o, gpt-4.1, gpt-5, gpt-4-turbo) use max_completion_tokens
    const usesCompletionTokens = isReasoningModel ||
                                  this.model.includes("gpt-4o") ||
                                  this.model.includes("gpt-4.1") ||
                                  this.model.includes("gpt-5") ||
                                  this.model.includes("gpt-4-turbo");

    const body = {
      model: this.model,
      messages: [{ role: "user", content: prompt }],
    };

    console.log(`[OpenAI →] REQUEST: ${this.model} | prompt: ${prompt.substring(0, 80)}...`);

    if (fixedTemperature) {
        // Models with fixed temperature=1 (reasoning models, gpt-4.1, gpt-5)
        if (options.maxTokens && usesCompletionTokens) {
          body.max_completion_tokens = options.maxTokens;
        } else if (options.maxTokens) {
          body.max_tokens = options.maxTokens;
        }
        body.temperature = 1;
    } else if (usesCompletionTokens) {
        // Newer models (gpt-4o, gpt-4o-mini, gpt-4-turbo) use max_completion_tokens
        if (options.maxTokens) {
          body.max_completion_tokens = options.maxTokens;
        }
        if (options.temperature !== undefined) {
          body.temperature = options.temperature;
        }
    } else {
        // Older models (gpt-3.5-turbo, gpt-4, gpt-4-32k) use max_tokens
        if (options.maxTokens) {
          body.max_tokens = options.maxTokens;
        }
        if (options.temperature !== undefined) {
          body.temperature = options.temperature;
        }
    }

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
    const content = json.choices?.[0]?.message?.content || "";
    const usage = json.usage ? {
      inputTokens: json.usage.prompt_tokens ?? null,
      outputTokens: json.usage.completion_tokens ?? null,
      totalTokens: json.usage.total_tokens ?? null,
    } : null;

    // Debug logging
    if (!content) {
      console.error("[OpenAI ✗] RESPONSE: Empty!");
      console.error("[OpenAI] Full response:", JSON.stringify(json, null, 2));
    } else {
      const preview = content.substring(0, 100).replace(/\n/g, ' ');
      console.log(`[OpenAI ←] RESPONSE: ${content.length} chars | "${preview}..."`);
    }

    return {
      content,
      usage,
      model: json.model || this.model,
      raw: json,
    };
  }

  /**
   * Generate with image support (for vision models)
   * @param {string} prompt - Text prompt
   * @param {string} base64Image - Base64-encoded image
   * @param {Object} options - Generation options
   * @returns {Promise<string>}
   */
  async generateWithImage(prompt, base64Image, options = {}) {
    if (!this.apiKey) throw new Error("OpenAI API key missing");

    const body = {
      model: this.model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: {
                url: `data:image/png;base64,${base64Image}`,
                detail: options.detail || "high",
              },
            },
          ],
        },
      ],
      max_tokens: options.maxTokens || 1000,
    };

    if (options.temperature !== undefined) {
      body.temperature = options.temperature;
    }

    console.log(`[OpenAI →] VISION REQUEST: ${this.model} | prompt: ${prompt.substring(0, 80)}...`);

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
      throw new Error(`OpenAI vision generate failed: ${res.status} ${text}`);
    }

    const json = await res.json();
    const content = json.choices?.[0]?.message?.content || "";
    const usage = json.usage ? {
      inputTokens: json.usage.prompt_tokens ?? null,
      outputTokens: json.usage.completion_tokens ?? null,
      totalTokens: json.usage.total_tokens ?? null,
    } : null;

    if (!content) {
      console.error("[OpenAI ✗] VISION RESPONSE: Empty!");
      console.error("[OpenAI] Full response:", JSON.stringify(json, null, 2));
    } else {
      const preview = content.substring(0, 100).replace(/\n/g, " ");
      console.log(`[OpenAI ←] VISION RESPONSE: ${content.length} chars | "${preview}..."`);
    }

    return {
      content,
      usage,
      model: json.model || this.model,
      raw: json,
    };
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
    
    // Filter for chat models only
    return (json.data || [])
        .filter(m => {
            const id = m.id.toLowerCase();
            // Allow GPT, o1, o3 series
            const isChatModel = id.startsWith("gpt") || id.startsWith("o1") || id.startsWith("o3") || id.startsWith("chatgpt");
            // Explicitly exclude non-text/chat utility models
            const isExcluded = id.includes("audio") ||
                              id.includes("realtime") ||
                              id.includes("tts") ||
                              id.includes("dall-e") ||
                              id.includes("embedding") ||
                              id.includes("vision") ||
                              id.includes("whisper") ||
                              id.includes("moderation") ||
                              id.includes("transcribe") ||
                              id.includes("search") ||
                              id.includes("diarize");

            // Filter out specific version snapshots (e.g. -2024-08-06, -0125, -1106)
            // Regex matches:
            // 1. YYYY-MM-DD (e.g. -2024-08-06)
            // 2. 4 digits at end (e.g. -0125)
            const isSnapshot = /-\d{4}-\d{2}-\d{2}/.test(id) || /-\d{4}$/.test(id);

            return isChatModel && !isExcluded && !isSnapshot;
        })
        .map((m) => m.id)
        .sort(); // Alphabetical sort for better UI
  }
}

module.exports = { OpenAIProvider };
