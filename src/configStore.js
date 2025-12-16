const fs = require("fs");
const path = require("path");

// Simple JSON config store (providers, settings).
class ConfigStore {
  /**
   * @param {string} filePath
   */
  constructor(filePath) {
    this.filePath = filePath;
    this.data = { providers: [], settings: {}, keys: {} };
    this.load();
  }

  load() {
    try {
      const content = fs.readFileSync(this.filePath, "utf8");
      this.data = JSON.parse(content);
      if (!this.data.keys) this.data.keys = {}; // Ensure keys object exists
    } catch {
      this.data = { providers: [], settings: {}, keys: {} };
      this.save();
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), "utf8");
  }

  listProviders() {
    return this.data.providers || [];
  }

  getKeys() {
    return this.data.keys || {};
  }

  setKey(providerId, key) {
    if (!this.data.keys) this.data.keys = {};
    this.data.keys[providerId] = key;
    this.save();
  }

  upsertProvider(cfg) {
    const existingIndex = (this.data.providers || []).findIndex((p) => p.name === cfg.name);
    if (existingIndex >= 0) {
      this.data.providers[existingIndex] = { ...this.data.providers[existingIndex], ...cfg };
    } else {
      this.data.providers.push(cfg);
    }
    this.save();
    return cfg;
  }

  setSetting(key, value) {
    this.data.settings = this.data.settings || {};
    this.data.settings[key] = value;
    this.save();
  }

  getSetting(key, defaultValue = undefined) {
    return this.data.settings ? this.data.settings[key] ?? defaultValue : defaultValue;
  }
}

module.exports = { ConfigStore };
