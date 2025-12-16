const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

// Minimal SQLite wrapper via sqlite3 CLI (no npm deps).
class SnapshotStore {
  /**
   * @param {string} dbPath
   */
  constructor(dbPath) {
    this.dbPath = dbPath;
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.init();
  }

  // Escape a value for SQL string literals.
  q(val) {
    if (val === null || val === undefined) return "NULL";
    return `'${String(val).replace(/'/g, "''")}'`;
  }

  // JSON stringify + escape.
  j(val) {
    return this.q(JSON.stringify(val ?? null));
  }

  run(sql) {
    const res = spawnSync("sqlite3", [this.dbPath, sql], { encoding: "utf8" });
    if (res.status !== 0) {
      const msg = res.stderr || res.stdout || "unknown sqlite error";
      throw new Error(`SQLite error: ${msg.trim()}`);
    }
    return res.stdout;
  }

  init() {
    const ddl = `
      PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS runs (
        run_id TEXT PRIMARY KEY,
        workspace_root TEXT,
        status TEXT,
        model_config TEXT,
        policy_config TEXT,
        created_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS steps (
        step_id TEXT PRIMARY KEY,
        task_id TEXT,
        run_id TEXT,
        step_index INTEGER,
        intent TEXT,
        status TEXT,
        prompt TEXT,
        input_view TEXT,
        config TEXT,
        started_at INTEGER,
        ended_at INTEGER,
        error TEXT
      );
      CREATE TABLE IF NOT EXISTS votes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        step_id TEXT,
        sample_index INTEGER,
        temperature REAL,
        output TEXT,
        red_flags TEXT,
        lead_by INTEGER,
        is_winner INTEGER
      );
      CREATE TABLE IF NOT EXISTS actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        step_id TEXT,
        action TEXT,
        result TEXT
      );
    `;
    this.run(ddl);
  }

  ensureRun(task) {
    const runId = task.id;
    const now = Date.now();
    const sql = `
      INSERT OR IGNORE INTO runs(run_id, workspace_root, status, model_config, policy_config, created_at)
      VALUES (${this.q(runId)}, ${this.q(process.cwd())}, 'active', ${this.j({ model: task.model, voteModel: task.voteModel })}, ${this.j({})}, ${now});
    `;
    this.run(sql);
    return runId;
  }

  recordStepStart({ task, step, prompt, config, inputView }) {
    const runId = this.ensureRun(task);
    const stepIndex = Number.parseInt(step.id.split("-").pop(), 10) || null;
    const now = Date.now();
    const sql = `
      INSERT OR REPLACE INTO steps(step_id, task_id, run_id, step_index, intent, status, prompt, input_view, config, started_at)
      VALUES (
        ${this.q(step.id)},
        ${this.q(task.id)},
        ${this.q(runId)},
        ${stepIndex},
        ${this.q(step.intent)},
        'running',
        ${this.q(prompt)},
        ${this.j(inputView)},
        ${this.j(config)},
        ${now}
      );
    `;
    this.run(sql);
  }

  recordVotes(stepId, candidates, winnerOutput) {
    if (!candidates || !candidates.length) return;
    const inserts = candidates
      .map((c, idx) => {
        const isWinner = winnerOutput && c.output === winnerOutput;
        return `INSERT INTO votes(step_id, sample_index, temperature, output, red_flags, lead_by, is_winner)
                VALUES (${this.q(stepId)}, ${idx}, ${c.metrics?.temperature ?? null}, ${this.q(c.output)}, ${this.j(c.redFlags)}, ${c.voteCount || 0}, ${isWinner ? 1 : 0});`;
      })
      .join("\n");
    this.run(inserts);
  }

  recordActions(stepId, actions, results) {
    if (!actions || !actions.length) return;
    const values = actions.map((action, idx) => {
      const res = results ? results[idx] : null;
      return `INSERT INTO actions(step_id, action, result)
              VALUES (${this.q(stepId)}, ${this.j(action)}, ${this.j(res)});`;
    }).join("\n");
    this.run(values);
  }

  recordStepEnd(stepId, status, error) {
    const now = Date.now();
    const sql = `
      UPDATE steps SET status=${this.q(status)}, error=${this.q(error || null)}, ended_at=${now}
      WHERE step_id=${this.q(stepId)};
    `;
    this.run(sql);
  }
}

module.exports = { SnapshotStore };
