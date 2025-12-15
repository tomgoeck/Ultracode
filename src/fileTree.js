const fs = require("fs");
const path = require("path");

function listFiles(root, relative = ".") {
  const dir = path.resolve(root, relative);
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const result = [];
  for (const e of entries) {
    const relPath = path.join(relative, e.name);
    if (e.isDirectory()) {
      result.push({ path: relPath, type: "dir", children: listFiles(root, relPath) });
    } else {
      result.push({ path: relPath, type: "file", size: fs.statSync(path.join(root, relPath)).size });
    }
  }
  return result;
}

module.exports = { listFiles };
