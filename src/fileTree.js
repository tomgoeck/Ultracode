const fs = require("fs");
const path = require("path");

function listFiles(root, relative = ".", flat = true) {
  const dir = path.resolve(root, relative);
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const result = [];

  for (const e of entries) {
    // Skip hidden files/folders (e.g., .git, .DS_Store)
    if (e.name.startsWith(".")) continue;

    const relPath = path.join(relative, e.name);
    const name = e.name;

    if (e.isDirectory()) {
      result.push({ path: relPath, name, isDir: true });
      if (flat) {
        // Recursively add children to flat list
        const children = listFiles(root, relPath, flat);
        result.push(...children);
      }
    } else {
      const size = fs.statSync(path.join(root, relPath)).size;
      result.push({ path: relPath, name, isDir: false, size });
    }
  }
  return result;
}

module.exports = { listFiles };
