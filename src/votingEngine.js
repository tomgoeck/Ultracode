const { RedFlagger } = require("./redFlagger");

// Implements a simple first-to-lead-by-k voting scheme with red-flag filtering.
class VotingEngine {
  /**
   * @param {{ redFlagger?: RedFlagger, maxRounds?: number, paraphraser?: any, resourceMonitor?: any }} [options]
   */
  constructor(options = {}) {
    this.redFlagger = options.redFlagger || new RedFlagger();
    this.maxRounds = options.maxRounds || 5; // kept for backwards compat (unused in adaptive loop)
    this.paraphraser = options.paraphraser || null; // Optional prompt paraphraser
    this.resourceMonitor = options.resourceMonitor || null; // Optional resource tracking
  }

  /**
   * @param {{
   *  provider: any,
   *  prompt: string,
   *  k: number,
   *  nSamples?: number,          // legacy alias for maxSamples
   *  initialSamples?: number,    // seeds before early-exit allowed
   *  maxSamples?: number,        // hard cap
   *  temperature?: number,
   *  temperatureSchedule?: number[],
   *  redFlagRules?: import("./types").RedFlagRule[],
   *  taskId?: string,
   *  stepId?: string,
   *  voteModel?: string
   * }} params
   * @returns {Promise<{ winner: import("./types").Candidate|null, candidates: import("./types").Candidate[], leadBy: number }>}
   */
  async run({
    provider,
    prompt,
    k,
    nSamples,
    initialSamples,
    maxSamples,
    temperature,
    temperatureSchedule,
    redFlagRules = [],
    taskId,
    stepId,
    voteModel,
  }) {
    const candidates = [];
    const tally = new Map(); // output -> voteCount
    let leadBy = 0;
    let winner = null;
    let achievedMargin = false;

    const cap = maxSamples || nSamples || 12; // allow legacy nSamples as cap
    const seeds = Math.max(1, Math.min(initialSamples || 2, cap));
    const temps = Array.isArray(temperatureSchedule) && temperatureSchedule.length
      ? temperatureSchedule
      : [0, 0.3, 0.5, 0.6];
    const pickTemp = (sampleIdx) => {
      if (temperature !== undefined) return temperature;
      return temps[Math.min(sampleIdx, temps.length - 1)];
    };

    for (let sample = 0; sample < cap; sample += 1) {
      // Paraphrase prompt to decorrelate errors (MAKER requirement)
      let finalPrompt = prompt;
      if (this.paraphraser && sample > 0) {
        try {
          // Use voter model for paraphrasing
          finalPrompt = await this.paraphraser.paraphrase(prompt, 0, sample, voteModel);
        } catch (err) {
          console.warn("[VotingEngine] Paraphrase failed, using original:", err.message);
        }
      }

      const temp = pickTemp(sample);
      const output = await provider.generate(finalPrompt, { temperature: temp });

      // Track resource usage
      if (this.resourceMonitor && taskId && stepId) {
        this.resourceMonitor.recordPromptCall(
          taskId,
          stepId,
          provider.model || provider.name || "unknown",
          finalPrompt,
          output
        );
      }

      const redFlags = this.redFlagger.evaluate(output, redFlagRules);

      const candidate = {
        model: provider.model || provider.name || "unknown",
        output,
        redFlags,
        voteCount: 0,
        metrics: { sample, temperature: temp },
      };
      candidates.push(candidate);
      if (redFlags.length) {
        continue; // discard and resample
      }

      const votes = (tally.get(output) || 0) + 1;
      tally.set(output, votes);
      candidate.voteCount = votes;

      // Determine current leader and margin.
      const sorted = Array.from(tally.entries()).sort((a, b) => b[1] - a[1]);
      const [leader, leaderVotes] = sorted[0];
      const runnerUpVotes = sorted[1]?.[1] || 0;
      leadBy = leaderVotes - runnerUpVotes;

      const haveSeeds = sample + 1 >= seeds;
      if (haveSeeds && leadBy >= k) {
        winner = {
          model: candidate.model,
          output: leader,
          redFlags: [],
          voteCount: leaderVotes,
          metrics: { leadBy, sample },
        };
        achievedMargin = true;
        return { winner, candidates, leadBy, achievedMargin };
      }
    }

    // Fallback: return best seen if we never achieved the margin.
    if (!winner && tally.size > 0) {
      const sorted = Array.from(tally.entries()).sort((a, b) => b[1] - a[1]);
      const [leader, leaderVotes] = sorted[0];
       const runnerUpVotes = sorted[1]?.[1] || 0;
       leadBy = leaderVotes - runnerUpVotes;
      winner = {
        model: "unknown",
        output: leader,
        redFlags: [],
        voteCount: leaderVotes,
        metrics: { leadBy },
      };
    }
    return { winner, candidates, leadBy, achievedMargin };
  }
}

module.exports = { VotingEngine };
