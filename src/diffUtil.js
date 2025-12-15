// Very lightweight line diff for preview (not full LCS; highlights changed lines).
function simpleDiff(before = "", after = "") {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const maxLen = Math.max(beforeLines.length, afterLines.length);
  const diffLines = [];
  for (let i = 0; i < maxLen; i += 1) {
    const a = beforeLines[i];
    const b = afterLines[i];
    if (a === b) {
      diffLines.push(`  ${a ?? ""}`);
    } else {
      if (a !== undefined) diffLines.push(`- ${a}`);
      if (b !== undefined) diffLines.push(`+ ${b}`);
    }
  }
  return ["--- before", "+++ after", ...diffLines].join("\n");
}

module.exports = { simpleDiff };
