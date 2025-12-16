const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

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

    // Create parent directory if needed
    try {
      await fs.promises.mkdir(path.dirname(full), { recursive: true });
    } catch (err) {
      // Ignore EEXIST - directory already exists, which is fine
      if (err.code !== 'EEXIST') {
        throw err;
      }
    }

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

  async applyPatch(relPath, patch) {
    if (!patch || typeof patch !== "string") {
      throw new Error("Patch content required");
    }
    if (patch.includes("../")) {
      throw new Error("Patch rejected: path traversal detected");
    }
    // Basic sanity: ensure patch references only the provided path
    const patchPaths = Array.from(patch.matchAll(/^[+-]{3}\s+(?:a\/|b\/)?(.+)$/gm)).map((m) => m[1]);
    if (patchPaths.length && !patchPaths.every((p) => p.endsWith(relPath))) {
      throw new Error("Patch references unexpected paths");
    }

    // Ensure target directory exists
    const full = this.resolveSafe(relPath);
    await fs.promises.mkdir(path.dirname(full), { recursive: true });

    const before = await fs.promises.readFile(full, "utf8").catch(() => null);

    const result = spawnSync("git", ["apply", "--whitespace=nowarn", "-"], {
      cwd: this.root,
      input: patch,
      encoding: "utf8",
    });

    if (result.status !== 0) {
      throw new Error(`git apply failed: ${result.stderr || result.stdout || "unknown error"}`);
    }

    const after = await fs.promises.readFile(full, "utf8").catch(() => null);
    return { path: relPath, fullPath: full, before, after };
  }

  async replaceRange(relPath, startLine, endLine, newText) {
    const full = this.resolveSafe(relPath);
    const content = await fs.promises.readFile(full, "utf8");
    const lines = content.split("\n");
    const startIdx = Math.max(0, startLine - 1);
    const endIdx = Math.max(startIdx, endLine - 1);
    const beforeLines = lines.slice(0, startIdx);
    const afterLines = lines.slice(endIdx + 1);
    const nextContent = [...beforeLines, ...newText.replace(/\r/g, "").split("\n"), ...afterLines].join("\n");
    await fs.promises.writeFile(full, nextContent, "utf8");
    return { path: relPath, fullPath: full, before: content, after: nextContent };
  }
}

module.exports = { ProjectGuard };
