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
    const combinedRules = [{ maxChars: DEFAULT_MAX_CHARS }, this.defaultRule, ...rules];
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
    }
    return redFlags;
  }
}

module.exports = { RedFlagger };
