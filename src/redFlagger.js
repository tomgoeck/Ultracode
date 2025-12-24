const DEFAULT_MAX_CHARS = 4000;

// Applies simple heuristics to decide whether a model output should be discarded.
class RedFlagger {
  /**
   * @param {import("./types").RedFlagRule=} defaultRule
   */
  constructor(defaultRule = {}) {
    this.defaultRule = defaultRule;
  }

  /**
   * @param {string} output
   * @param {import("./types").RedFlagRule[]} rules
   * @returns {string[]} redFlags
   */
  evaluate(output, rules = []) {
    const hasMaxChars = rules.some((rule) => rule && typeof rule.maxChars === "number");
    const hasMaxTokens = rules.some((rule) => rule && typeof rule.maxTokens === "number");
    const defaultRule = this.defaultRule && typeof this.defaultRule === "object"
      ? { ...this.defaultRule }
      : null;
    if (defaultRule && hasMaxChars) delete defaultRule.maxChars;
    if (defaultRule && hasMaxTokens) delete defaultRule.maxTokens;

    const combinedRules = [
      ...(hasMaxChars || hasMaxTokens ? [] : [{ maxChars: DEFAULT_MAX_CHARS }]),
      defaultRule,
      ...rules,
    ].filter(Boolean);
    const redFlags = [];

    for (const rule of combinedRules) {
      if (!rule) continue;
      if (rule.maxChars && output.length > rule.maxChars) {
        redFlags.push(`too-long:${output.length}`);
      }
      if (rule.maxTokens) {
        const tokens = output.trim().split(/\s+/).length;
        if (tokens > rule.maxTokens) {
          redFlags.push(`too-many-tokens:${tokens}`);
        }
      }
      if (rule.requiredRegex && !rule.requiredRegex.test(output)) {
        redFlags.push("missing-required-regex");
      }
      if (rule.requireJson) {
        try {
          JSON.parse(output);
        } catch {
          redFlags.push("invalid-json");
        }
      }
      // Check for shell commands (common mistake)
      if (rule.noShellCommands !== false) { // Default: check for shell commands
        const shellCommands = ['mkdir', 'touch', 'npm install', 'npm init', 'cd ', 'ls ', 'echo ', 'git ', 'cp ', 'mv ', 'rm '];
        const trimmed = output.trim().toLowerCase();
        for (const cmd of shellCommands) {
          if (trimmed.startsWith(cmd)) {
            redFlags.push(`shell-command:${cmd.trim()}`);
            break;
          }
        }
      }
      // Check for instruction lists instead of actual code/content
      if (rule.noInstructionLists !== false) { // Default: check for instruction lists
        const lines = output.trim().split('\n');
        const firstFewLines = lines.slice(0, 5).join('\n').toLowerCase();
        // Patterns that indicate instructions rather than code
        const instructionPatterns = [
          /^\s*1\.\s+(create|add|open|install|run|start|build|make|write)/,
          /^\s*step\s+1/,
          /^\s*first,?\s+(create|add|open|install)/,
          /^\s*to\s+(create|build|make|start)/,
          /files?:\s*$/i,  // "Files:" at end of line (common in instruction lists)
        ];
        for (const pattern of instructionPatterns) {
          if (pattern.test(firstFewLines)) {
            redFlags.push('instruction-list');
            break;
          }
        }
      }
    }
    return redFlags;
  }
}

module.exports = { RedFlagger };
