const fs = require("fs");
const path = require("path");

// Persists pending commands to disk.
class PendingStore {
  /**
   * @param {string} filePath
   */
  constructor(filePath) {
    this.filePath = filePath;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.pending = [];
    this.load();
  }

  load() {
    try {
      const content = fs.readFileSync(this.filePath, "utf8");
      this.pending = JSON.parse(content);
    } catch {
      this.pending = [];
      this.save();
    }
  }

  save() {
    fs.writeFileSync(this.filePath, JSON.stringify(this.pending, null, 2), "utf8");
  }

  list() {
    return [...this.pending];
  }

  add(entry) {
    this.pending = this.pending.filter((c) => c.id !== entry.id);
    this.pending.push(entry);
    this.save();
    return entry;
  }

  remove(id) {
    this.pending = this.pending.filter((c) => c.id !== id);
    this.save();
  }
}

module.exports = { PendingStore };
