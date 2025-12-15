const fs = require("fs");
const path = require("path");

// Guards filesystem access to a single root. Provides simple read/write with safety checks.
class ProjectGuard {
  /**
   * @param {string} root
   */
  constructor(root) {
    this.root = path.resolve(root);
  }

  resolveSafe(relPath) {
    const full = path.resolve(this.root, relPath);
    if (!full.startsWith(this.root)) {
      throw new Error(`Path escapes project root: ${relPath}`);
    }
    return full;
  }

  async list(relativeDir = ".") {
    const dir = this.resolveSafe(relativeDir);
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    return entries.map((e) => ({
      name: e.name,
      isDir: e.isDirectory(),
      path: path.join(relativeDir, e.name),
    }));
  }

  async readFile(relPath) {
    const full = this.resolveSafe(relPath);
    return fs.promises.readFile(full, "utf8");
  }

  async writeFile(relPath, content, options = {}) {
    const { dryRun = false } = options;
    const full = this.resolveSafe(relPath);
    await fs.promises.mkdir(path.dirname(full), { recursive: true });
    let before = null;
    try {
      before = await fs.promises.readFile(full, "utf8");
    } catch {
      before = null;
    }

    if (!dryRun) {
      await fs.promises.writeFile(full, content, "utf8");
    }

    return { dryRun, path: relPath, fullPath: full, before, after: content };
  }
}

module.exports = { ProjectGuard };
