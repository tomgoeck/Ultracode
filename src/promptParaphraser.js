/**
 * PromptParaphraser - Rephrases prompts to decorrelate errors in voting (MAKER requirement)
 *
 * Uses a cheap LLM to generate varied prompts while preserving intent.
 * This reduces correlated errors when multiple samples are taken.
 */
class PromptParaphraser {
  /**
   * @param {import("./llmRegistry").LLMRegistry} llmRegistry
   * @param {string} [modelName="gpt-4o-mini"] - Cheap model for paraphrasing
   */
  constructor(llmRegistry, modelName = "gpt-4o-mini") {
    this.llmRegistry = llmRegistry;
    this.modelName = modelName;
    this.cache = new Map(); // Cache paraphrases to avoid redundant API calls
  }

  /**
   * Paraphrase a prompt while preserving its exact intent
   * @param {string} prompt - Original prompt
   * @param {number} round - Current voting round
   * @param {number} sample - Sample number within round
   * @param {string} [modelName] - Optional model override (uses voter model if not specified)
   * @returns {Promise<string>} - Paraphrased prompt or original on fallback
   */
  async paraphrase(prompt, round, sample, modelName = null) {
    // Skip paraphrasing for the very first sample to save costs
    if (round === 0 && sample === 0) {
      return prompt;
    }

    // Use provided model or fall back to default
    const useModel = modelName || this.modelName;

    // Check cache
    const cacheKey = `${round}-${sample}-${useModel}-${prompt.slice(0, 50)}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    try {
      // Try to get provider, fall back gracefully if not found
      let provider;
      try {
        provider = this.llmRegistry.get(useModel);
      } catch (err) {
        console.warn(`[PromptParaphraser] Model ${useModel} not found, using original prompt`);
        return prompt;
      }

      // Paraphrase instruction
      const paraphrasePrompt = `You are an expert prompt engineer. Rephrase the following instruction while preserving its EXACT intent and meaning. Use different wording, sentence structure, or phrasing, but keep the core request identical.

ORIGINAL INSTRUCTION:
${prompt}

REPHRASED INSTRUCTION (preserve exact meaning):`;

      // Use higher temperature for more variation
      const paraphrased = await provider.generate(paraphrasePrompt, { temperature: 0.7 });

      if (!paraphrased || paraphrased.trim().length === 0) {
        console.warn("[PromptParaphraser] Empty paraphrase result, using original");
        return prompt;
      }

      // Clean up common response prefixes
      const cleaned = paraphrased
        .replace(/^(REPHRASED INSTRUCTION:|Here'?s? the rephrased instruction:?|Sure[,!]?)/i, "")
        .trim();

      // Cache the result
      this.cache.set(cacheKey, cleaned);

      // Limit cache size to prevent memory bloat
      if (this.cache.size > 100) {
        const firstKey = this.cache.keys().next().value;
        this.cache.delete(firstKey);
      }

      return cleaned;
    } catch (err) {
      console.error("[PromptParaphraser] Error during paraphrasing:", err.message);
      return prompt; // Fallback to original
    }
  }

  /**
   * Clear the paraphrase cache
   */
  clearCache() {
    this.cache.clear();
  }

  /**
   * Get cache statistics for monitoring
   */
  getCacheStats() {
    return {
      size: this.cache.size,
      model: this.modelName,
    };
  }
}

module.exports = { PromptParaphraser };
