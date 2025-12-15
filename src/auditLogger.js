const fs = require("fs");
const path = require("path");

class AuditLogger {
  /**
   * @param {string} filePath
   */
  constructor(filePath) {
    this.filePath = filePath;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, "", "utf8");
    }
  }

  log(entry) {
    const line = JSON.stringify({ ...entry, ts: entry.ts || Date.now() }) + "\n";
    fs.appendFileSync(this.filePath, line, "utf8");
  }

  readRecent(limit = 50) {
    const content = fs.readFileSync(this.filePath, "utf8");
    const lines = content.trim().split("\n").filter(Boolean);
    const slice = lines.slice(-limit);
    return slice.map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return { raw: l };
      }
    });
  }
}

module.exports = { AuditLogger };
