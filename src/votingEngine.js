const { RedFlagger } = require("./redFlagger");

// Implements a simple first-to-lead-by-k voting scheme with red-flag filtering.
class VotingEngine {
  /**
   * @param {{ redFlagger?: RedFlagger, maxRounds?: number }} [options]
   */
  constructor(options = {}) {
    this.redFlagger = options.redFlagger || new RedFlagger();
    this.maxRounds = options.maxRounds || 5;
  }

  /**
   * @param {{ provider: any, prompt: string, k: number, nSamples: number, redFlagRules?: import("./types").RedFlagRule[] }} params
   * @returns {Promise<{ winner: import("./types").Candidate|null, candidates: import("./types").Candidate[], leadBy: number }>}
   */
  async run({ provider, prompt, k, nSamples, redFlagRules = [] }) {
    const candidates = [];
    const tally = new Map(); // output -> voteCount
    let leadBy = 0;
    let winner = null;

    for (let round = 0; round < this.maxRounds; round += 1) {
      for (let sample = 0; sample < nSamples; sample += 1) {
        const output = await provider.generate(prompt);
        const redFlags = this.redFlagger.evaluate(output, redFlagRules);

        const candidate = {
          model: provider.model || provider.name || "unknown",
          output,
          redFlags,
          voteCount: 0,
          metrics: { round, sample },
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

        if (leadBy >= k) {
          winner = {
            model: candidate.model,
            output: leader,
            redFlags: [],
            voteCount: leaderVotes,
            metrics: { leadBy, round },
          };
          return { winner, candidates, leadBy };
        }
      }
    }

    // Fallback: return best seen if we never achieved the margin.
    if (!winner && tally.size > 0) {
      const sorted = Array.from(tally.entries()).sort((a, b) => b[1] - a[1]);
      const [leader, leaderVotes] = sorted[0];
      winner = {
        model: "unknown",
        output: leader,
        redFlags: [],
        voteCount: leaderVotes,
        metrics: { leadBy },
      };
    }
    return { winner, candidates, leadBy };
  }
}

module.exports = { VotingEngine };
