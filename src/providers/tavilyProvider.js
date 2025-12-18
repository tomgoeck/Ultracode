/**
 * Tavily Search API provider for web research.
 * Used in the Wizard for project clarification.
 * API Docs: https://docs.tavily.com/
 */
class TavilyProvider {
  /**
   * @param {{ apiKey: string }} opts
   */
  constructor({ apiKey }) {
    this.apiKey = apiKey;
    this.baseUrl = "https://api.tavily.com";
    this.name = "tavily";
  }

  /**
   * Search the web for information.
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @returns {Promise<Object>} Search results
   */
  async search(query, options = {}) {
    if (!this.apiKey) {
      throw new Error("Tavily API key missing");
    }

    const {
      searchDepth = "basic", // "basic" or "advanced"
      maxResults = 5,
      includeAnswer = false,
      includeRawContent = "markdown", // true|"markdown"|"text"|false
      includeDomains = [],
      excludeDomains = [],
    } = options;

    console.log(`[Tavily →] SEARCH: "${query.substring(0, 50)}..." (depth: ${searchDepth})`);

    const body = {
      query,
      search_depth: searchDepth,
      max_results: maxResults,
      include_answer: includeAnswer,
      include_raw_content: includeRawContent,
    };

    if (includeDomains.length > 0) {
      body.include_domains = includeDomains;
    }
    if (excludeDomains.length > 0) {
      body.exclude_domains = excludeDomains;
    }

    const res = await fetch(`${this.baseUrl}/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Tavily search failed: ${res.status} ${text}`);
    }

    const json = await res.json();

    console.log(`[Tavily ←] RESULTS: ${json.results?.length || 0} results`);
    if (json.answer) {
      console.log(`[Tavily ←] ANSWER: "${json.answer.substring(0, 100)}..."`);
    }

    return {
      answer: json.answer || null,
      results: (json.results || []).map((r) => ({
        title: r.title,
        url: r.url,
        content: r.content,
        raw_content: r.raw_content,
        score: r.score,
      })),
      query: json.query,
    };
  }

  /**
   * Format search results for inclusion in LLM context.
   * @param {Object} searchResult - Result from search()
   * @returns {string} Formatted text
   */
  formatForContext(searchResult) {
    let text = "";

    if (searchResult.answer) {
      text += `## AI-Generated Answer\n${searchResult.answer}\n\n`;
    }

    if (searchResult.results && searchResult.results.length > 0) {
      text += `## Web Search Results\n\n`;
      for (const [idx, r] of searchResult.results.entries()) {
        text += `### ${idx + 1}. ${r.title}\n`;
        text += `URL: ${r.url}\n`;
        const body = r.raw_content || r.content || "";
        text += `${body}\n\n`;
      }
    }

    return text.trim();
  }

  /**
   * Search and return formatted context string.
   * Convenience method for wizard usage.
   * @param {string} query
   * @param {Object} options
   * @returns {Promise<string>}
   */
  async searchForContext(query, options = {}) {
    const result = await this.search(query, options);
    return this.formatForContext(result);
  }

  /**
   * Check if API key is configured.
   * @returns {boolean}
   */
  isConfigured() {
    return !!this.apiKey;
  }
}

module.exports = { TavilyProvider };
