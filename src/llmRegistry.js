// Simple in-memory registry for LLM providers. Each provider exposes `generate(prompt, options)` and optionally `listModels()`.

class LLMRegistry {
  constructor() {
    this.providers = new Map();
  }

  register(name, provider) {
    this.providers.set(name, provider);
  }

  has(name) {
    return this.providers.has(name);
  }

  get(name) {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new Error(`Provider not found: ${name}`);
    }
    return provider;
  }

  list() {
    return Array.from(this.providers.keys());
  }

  async listModels(name) {
    const provider = this.get(name);
    if (typeof provider.listModels !== "function") {
      throw new Error(`Provider ${name} does not support listModels`);
    }
    return provider.listModels();
  }
}

// Very small stub that echoes the prompt and adds a jitter to simulate variability.
class EchoProvider {
  constructor({ model = "echo-stub", noisy = false } = {}) {
    this.model = model;
    this.noisy = noisy;
    this.counter = 0;
  }

  async generate(prompt) {
    this.counter += 1;
    const variants = ["A", "B", "A"];
    const variant = variants[this.counter % variants.length];
    const base = `echo:${variant}:${prompt.slice(0, 60)}`;
    if (this.noisy) {
      // Occasionally emit a very long response to trigger red-flagging.
      if (Math.random() > 0.6) {
        return `${base}:${"x".repeat(5000)}`;
      }
    }
    return base;
  }

  async listModels() {
    return [this.model];
  }
}

module.exports = { LLMRegistry, EchoProvider };
