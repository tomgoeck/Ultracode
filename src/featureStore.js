const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

/**
 * SQLite store for Projects, Features, Subtasks, and Events.
 * Uses sqlite3 CLI (no npm deps) - same pattern as snapshotStore.js
 */
class FeatureStore {
  /**
   * @param {string} dbPath - Path to SQLite database file
   */
  constructor(dbPath) {
    this.dbPath = dbPath;
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.init();
  }

  /**
   * Escape a value for SQL string literals.
   * @param {any} val
   * @returns {string}
   */
  q(val) {
    if (val === null || val === undefined) return "NULL";
    return `'${String(val).replace(/'/g, "''")}'`;
  }

  /**
   * JSON stringify + escape for storing objects.
   * @param {any} val
   * @returns {string}
   */
  j(val) {
    return this.q(JSON.stringify(val ?? null));
  }

  /**
   * Execute raw SQL against the database.
   * @param {string} sql
   * @returns {string} stdout from sqlite3
   */
  run(sql) {
    const res = spawnSync("sqlite3", [this.dbPath, sql], { encoding: "utf8" });
    if (res.status !== 0) {
      const msg = res.stderr || res.stdout || "unknown sqlite error";
      throw new Error(`SQLite error: ${msg.trim()}`);
    }
    return res.stdout;
  }

  /**
   * Query and return results as array of objects.
   * @param {string} sql
   * @returns {Array<Object>}
   */
  query(sql) {
    const fullSql = `.mode json\n${sql}`;
    const res = spawnSync("sqlite3", [this.dbPath], {
      input: fullSql,
      encoding: "utf8",
    });
    if (res.status !== 0) {
      const msg = res.stderr || res.stdout || "unknown sqlite error";
      throw new Error(`SQLite error: ${msg.trim()}`);
    }
    const output = res.stdout.trim();
    if (!output) return [];
    try {
      return JSON.parse(output);
    } catch {
      return [];
    }
  }

  /**
   * Initialize database schema.
   */
  init() {
    const ddl = `
      PRAGMA journal_mode=WAL;

      -- Projects table
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        folder_path TEXT,
        planner_model TEXT,
        executor_model TEXT,
        vote_model TEXT,
        status TEXT DEFAULT 'created',
        bootstrapped INTEGER DEFAULT 0,
        created_at INTEGER,
        updated_at INTEGER
      );

      -- Features table
      CREATE TABLE IF NOT EXISTS features (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        priority TEXT CHECK(priority IN ('A', 'B', 'C')) DEFAULT 'B',
        status TEXT DEFAULT 'pending',
        depends_on TEXT,
        dod TEXT,
        technical_summary TEXT,
        order_index INTEGER DEFAULT 0,
        created_at INTEGER,
        updated_at INTEGER,
        FOREIGN KEY (project_id) REFERENCES projects(id)
      );

      -- Subtasks table
      CREATE TABLE IF NOT EXISTS subtasks (
        id TEXT PRIMARY KEY,
        feature_id TEXT NOT NULL,
        intent TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        apply_type TEXT,
        apply_path TEXT,
        result TEXT,
        error TEXT,
        created_at INTEGER,
        started_at INTEGER,
        completed_at INTEGER,
        FOREIGN KEY (feature_id) REFERENCES features(id)
      );

      -- Events table (audit trail)
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT,
        feature_id TEXT,
        subtask_id TEXT,
        event_type TEXT NOT NULL,
        payload TEXT,
        timestamp INTEGER
      );

      -- Wizard conversations table
      CREATE TABLE IF NOT EXISTS wizard_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp INTEGER
      );

      -- Model usage aggregates (per project/model)
      CREATE TABLE IF NOT EXISTS model_usage (
        project_id TEXT NOT NULL,
        model TEXT NOT NULL,
        input_tokens INTEGER DEFAULT 0,
        output_tokens INTEGER DEFAULT 0,
        total_tokens INTEGER DEFAULT 0,
        calls INTEGER DEFAULT 0,
        updated_at INTEGER,
        PRIMARY KEY (project_id, model)
      );

      -- Model usage aggregates per role (planner/subtask/voter)
      CREATE TABLE IF NOT EXISTS model_usage_by_role (
        project_id TEXT NOT NULL,
        role TEXT NOT NULL,
        model TEXT NOT NULL,
        input_tokens INTEGER DEFAULT 0,
        output_tokens INTEGER DEFAULT 0,
        total_tokens INTEGER DEFAULT 0,
        calls INTEGER DEFAULT 0,
        updated_at INTEGER,
        PRIMARY KEY (project_id, role, model)
      );

      -- Indexes for common queries
      CREATE INDEX IF NOT EXISTS idx_features_project ON features(project_id);
      CREATE INDEX IF NOT EXISTS idx_features_status ON features(status);
      CREATE INDEX IF NOT EXISTS idx_subtasks_feature ON subtasks(feature_id);
      CREATE INDEX IF NOT EXISTS idx_events_project ON events(project_id);
      CREATE INDEX IF NOT EXISTS idx_events_feature ON events(feature_id);
      CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
      CREATE INDEX IF NOT EXISTS idx_model_usage_project ON model_usage(project_id);
      CREATE INDEX IF NOT EXISTS idx_model_usage_role_project ON model_usage_by_role(project_id);
    `;
    this.run(ddl);
  }

  // ==================== PROJECTS ====================

  /**
   * Create a new project.
   * @param {Object} project
   * @returns {string} project id
   */
  createProject({ id, name, description, folderPath, plannerModel, executorModel, voteModel }) {
    const now = Date.now();
    const projectId = id || `project-${now}`;
    const sql = `
      INSERT INTO projects (id, name, description, folder_path, planner_model, executor_model, vote_model, status, created_at, updated_at)
      VALUES (${this.q(projectId)}, ${this.q(name)}, ${this.q(description)}, ${this.q(folderPath)}, ${this.q(plannerModel)}, ${this.q(executorModel)}, ${this.q(voteModel)}, 'created', ${now}, ${now});
    `;
    this.run(sql);
    this.recordEvent(projectId, null, null, "project_created", { name, folderPath });
    return projectId;
  }

  /**
   * Get a project by ID.
   * @param {string} projectId
   * @returns {Object|null}
   */
  getProject(projectId) {
    const rows = this.query(`SELECT * FROM projects WHERE id = ${this.q(projectId)};`);
    return rows[0] || null;
  }

  /**
   * Get all projects.
   * @returns {Array<Object>}
   */
  getAllProjects() {
    return this.query("SELECT * FROM projects ORDER BY created_at DESC;");
  }

  /**
   * Update project fields.
   * @param {string} projectId
   * @param {Object} updates
   */
  updateProject(projectId, updates) {
    const now = Date.now();
    const sets = [];
    if (updates.name !== undefined) sets.push(`name = ${this.q(updates.name)}`);
    if (updates.description !== undefined) sets.push(`description = ${this.q(updates.description)}`);
    if (updates.folderPath !== undefined) sets.push(`folder_path = ${this.q(updates.folderPath)}`);
    if (updates.plannerModel !== undefined) sets.push(`planner_model = ${this.q(updates.plannerModel)}`);
    if (updates.executorModel !== undefined) sets.push(`executor_model = ${this.q(updates.executorModel)}`);
    if (updates.voteModel !== undefined) sets.push(`vote_model = ${this.q(updates.voteModel)}`);
    if (updates.status !== undefined) sets.push(`status = ${this.q(updates.status)}`);
    if (updates.bootstrapped !== undefined) sets.push(`bootstrapped = ${updates.bootstrapped ? 1 : 0}`);
    sets.push(`updated_at = ${now}`);

    if (sets.length > 0) {
      const sql = `UPDATE projects SET ${sets.join(", ")} WHERE id = ${this.q(projectId)};`;
      this.run(sql);
    }
  }

  /**
   * Delete a project and all related data.
   * @param {string} projectId
   */
  deleteProject(projectId) {
    const sql = `
      DELETE FROM wizard_messages WHERE project_id = ${this.q(projectId)};
      DELETE FROM events WHERE project_id = ${this.q(projectId)};
      DELETE FROM subtasks WHERE feature_id IN (SELECT id FROM features WHERE project_id = ${this.q(projectId)});
      DELETE FROM features WHERE project_id = ${this.q(projectId)};
      DELETE FROM model_usage WHERE project_id = ${this.q(projectId)};
      DELETE FROM projects WHERE id = ${this.q(projectId)};
    `;
    this.run(sql);
  }

  // ==================== USAGE METRICS ====================

  /**
   * Record aggregated model usage for a project.
   * @param {Object} entry
   * @param {string} entry.projectId
   * @param {string} entry.model
   * @param {number} entry.inputTokens
   * @param {number} entry.outputTokens
   * @param {number} entry.totalTokens
   */
  recordModelUsage({ projectId, model, inputTokens, outputTokens, totalTokens }) {
    if (!projectId || !model) return;
    const now = Date.now();
    const inTok = Number.isFinite(inputTokens) ? Math.max(0, Math.floor(inputTokens)) : 0;
    const outTok = Number.isFinite(outputTokens) ? Math.max(0, Math.floor(outputTokens)) : 0;
    const totalTok = Number.isFinite(totalTokens) ? Math.max(0, Math.floor(totalTokens)) : inTok + outTok;
    const sql = `
      INSERT INTO model_usage (project_id, model, input_tokens, output_tokens, total_tokens, calls, updated_at)
      VALUES (${this.q(projectId)}, ${this.q(model)}, ${inTok}, ${outTok}, ${totalTok}, 1, ${now})
      ON CONFLICT(project_id, model) DO UPDATE SET
        input_tokens = input_tokens + ${inTok},
        output_tokens = output_tokens + ${outTok},
        total_tokens = total_tokens + ${totalTok},
        calls = calls + 1,
        updated_at = ${now};
    `;
    this.run(sql);
  }

  /**
   * Record aggregated model usage for a project by role.
   * @param {Object} entry
   * @param {string} entry.projectId
   * @param {string} entry.role
   * @param {string} entry.model
   * @param {number} entry.inputTokens
   * @param {number} entry.outputTokens
   * @param {number} entry.totalTokens
   */
  recordModelUsageByRole({ projectId, role, model, inputTokens, outputTokens, totalTokens }) {
    if (!projectId || !role || !model) return;
    const now = Date.now();
    const inTok = Number.isFinite(inputTokens) ? Math.max(0, Math.floor(inputTokens)) : 0;
    const outTok = Number.isFinite(outputTokens) ? Math.max(0, Math.floor(outputTokens)) : 0;
    const totalTok = Number.isFinite(totalTokens) ? Math.max(0, Math.floor(totalTokens)) : inTok + outTok;
    const sql = `
      INSERT INTO model_usage_by_role (project_id, role, model, input_tokens, output_tokens, total_tokens, calls, updated_at)
      VALUES (${this.q(projectId)}, ${this.q(role)}, ${this.q(model)}, ${inTok}, ${outTok}, ${totalTok}, 1, ${now})
      ON CONFLICT(project_id, role, model) DO UPDATE SET
        input_tokens = input_tokens + ${inTok},
        output_tokens = output_tokens + ${outTok},
        total_tokens = total_tokens + ${totalTok},
        calls = calls + 1,
        updated_at = ${now};
    `;
    this.run(sql);
  }

  /**
   * Get aggregated model usage for a project.
   * @param {string} projectId
   * @returns {Array<Object>}
   */
  getProjectModelUsage(projectId) {
    if (!projectId) return [];
    return this.query(`
      SELECT model, input_tokens, output_tokens, total_tokens, calls, updated_at
      FROM model_usage
      WHERE project_id = ${this.q(projectId)}
      ORDER BY total_tokens DESC;
    `);
  }

  /**
   * Get aggregated model usage per role for a project.
   * @param {string} projectId
   * @returns {Array<Object>}
   */
  getProjectRoleUsage(projectId) {
    if (!projectId) return [];
    return this.query(`
      SELECT role, model, input_tokens, output_tokens, total_tokens, calls, updated_at
      FROM model_usage_by_role
      WHERE project_id = ${this.q(projectId)}
      ORDER BY role ASC, total_tokens DESC;
    `);
  }

  // ==================== FEATURES ====================

  /**
   * Create a new feature.
   * @param {Object} feature
   * @returns {string} feature id
   */
  createFeature({ id, projectId, name, description, priority, dependsOn, dod, orderIndex }) {
    const now = Date.now();
    const featureId = id || `feature-${now}-${Math.random().toString(36).slice(2, 6)}`;
    const sql = `
      INSERT INTO features (id, project_id, name, description, priority, status, depends_on, dod, order_index, created_at, updated_at)
      VALUES (${this.q(featureId)}, ${this.q(projectId)}, ${this.q(name)}, ${this.q(description)}, ${this.q(priority || "B")}, 'pending', ${this.j(dependsOn || [])}, ${this.q(dod)}, ${orderIndex ?? 0}, ${now}, ${now});
    `;
    this.run(sql);
    this.recordEvent(projectId, featureId, null, "feature_created", { name, priority });
    return featureId;
  }

  /**
   * Get a feature by ID.
   * @param {string} featureId
   * @returns {Object|null}
   */
  getFeature(featureId) {
    const rows = this.query(`SELECT * FROM features WHERE id = ${this.q(featureId)};`);
    if (rows[0]) {
      rows[0].depends_on = this.parseJson(rows[0].depends_on);
    }
    return rows[0] || null;
  }

  /**
   * Get all features for a project.
   * @param {string} projectId
   * @returns {Array<Object>}
   */
  getFeaturesByProject(projectId) {
    const rows = this.query(`
      SELECT * FROM features
      WHERE project_id = ${this.q(projectId)}
      ORDER BY
        CASE priority WHEN 'A' THEN 1 WHEN 'B' THEN 2 WHEN 'C' THEN 3 END,
        order_index ASC;
    `);
    return rows.map((r) => ({ ...r, depends_on: this.parseJson(r.depends_on) }));
  }

  /**
   * Update feature fields.
   * @param {string} featureId
   * @param {Object} updates
   */
  updateFeature(featureId, updates) {
    const now = Date.now();
    const sets = [];
    if (updates.name !== undefined) sets.push(`name = ${this.q(updates.name)}`);
    if (updates.description !== undefined) sets.push(`description = ${this.q(updates.description)}`);
    if (updates.priority !== undefined) sets.push(`priority = ${this.q(updates.priority)}`);
    if (updates.status !== undefined) sets.push(`status = ${this.q(updates.status)}`);
    if (updates.dependsOn !== undefined) sets.push(`depends_on = ${this.j(updates.dependsOn)}`);
    if (updates.dod !== undefined) sets.push(`dod = ${this.q(updates.dod)}`);
    if (updates.technicalSummary !== undefined) sets.push(`technical_summary = ${this.q(updates.technicalSummary)}`);
    if (updates.orderIndex !== undefined) sets.push(`order_index = ${updates.orderIndex}`);
    sets.push(`updated_at = ${now}`);

    if (sets.length > 0) {
      const sql = `UPDATE features SET ${sets.join(", ")} WHERE id = ${this.q(featureId)};`;
      this.run(sql);
    }
  }

  /**
   * Delete a feature and all related subtasks.
   * @param {string} featureId
   */
  deleteFeature(featureId) {
    const feature = this.getFeature(featureId);
    const sql = `
      DELETE FROM subtasks WHERE feature_id = ${this.q(featureId)};
      DELETE FROM events WHERE feature_id = ${this.q(featureId)};
      DELETE FROM features WHERE id = ${this.q(featureId)};
    `;
    this.run(sql);
    if (feature) {
      this.recordEvent(feature.project_id, featureId, null, "feature_deleted", { name: feature.name });
    }
  }

  /**
   * Check if a feature is runnable (all dependencies completed).
   * @param {string} featureId
   * @returns {boolean}
   */
  isFeatureRunnable(featureId) {
    const feature = this.getFeature(featureId);
    if (!feature) return false;
    // Allow pending or paused if deps are met
    if (feature.status !== "pending" && feature.status !== "paused") return false;
    return this.areDependenciesMet(featureId);
  }

  /**
   * Check if all dependencies are completed/verified.
   * @param {string} featureId
   * @returns {boolean}
   */
  areDependenciesMet(featureId) {
    const feature = this.getFeature(featureId);
    if (!feature) return false;

    const dependsOn = feature.depends_on || [];
    if (dependsOn.length === 0) return true;

    const projectId = feature.project_id;

    const resolveDep = (depId) => {
      // Try exact match
      let dep = this.getFeature(depId);
      if (dep) return dep;
      // Try with project prefix
      const prefixed = `${projectId}-${depId}`;
      dep = this.getFeature(prefixed);
      if (dep) return dep;
      // Try suffix match (ids ending with depId)
      const all = this.getFeaturesByProject(projectId);
      return all.find((f) => f.id.endsWith(depId));
    };

    for (const depId of dependsOn) {
      const dep = resolveDep(depId);
      if (!dep || (dep.status !== "completed" && dep.status !== "verified")) {
        return false;
      }
    }
    return true;
  }

  /**
   * Get the next runnable feature (A > B > C priority, dependencies fulfilled).
   * @param {string} projectId
   * @returns {Object|null}
   */
  getNextRunnableFeature(projectId) {
    const features = this.getFeaturesByProject(projectId);
    for (const feature of features) {
      if ((feature.status === "pending" || feature.status === "paused") && this.isFeatureRunnable(feature.id)) {
        return feature;
      }
    }
    return null;
  }

  /**
   * Validate dependencies for cycles.
   * @param {string} featureId
   * @param {Array<string>} newDeps
   * @returns {{valid: boolean, error?: string}}
   */
  validateDependencies(featureId, newDeps) {
    // Check for self-reference
    if (newDeps.includes(featureId)) {
      return { valid: false, error: "Feature cannot depend on itself" };
    }

    // Check for cycles using DFS
    const visited = new Set();
    const stack = [...newDeps];

    while (stack.length > 0) {
      const currentId = stack.pop();
      if (currentId === featureId) {
        return { valid: false, error: "Circular dependency detected" };
      }
      if (visited.has(currentId)) continue;
      visited.add(currentId);

      const current = this.getFeature(currentId);
      if (current && current.depends_on) {
        stack.push(...current.depends_on);
      }
    }

    return { valid: true };
  }

  /**
   * Reorder features (update order_index).
   * @param {string} projectId
   * @param {Array<{id: string, orderIndex: number}>} ordering
   */
  reorderFeatures(projectId, ordering) {
    for (const { id, orderIndex } of ordering) {
      this.run(`UPDATE features SET order_index = ${orderIndex} WHERE id = ${this.q(id)} AND project_id = ${this.q(projectId)};`);
    }
  }

  // ==================== SUBTASKS ====================

  /**
   * Create a new subtask.
   * @param {Object} subtask
   * @returns {string} subtask id
   */
  createSubtask({ id, featureId, intent, applyType, applyPath }) {
    const now = Date.now();
    const subtaskId = id || `subtask-${now}-${Math.random().toString(36).slice(2, 6)}`;
    const sql = `
      INSERT INTO subtasks (id, feature_id, intent, status, apply_type, apply_path, created_at)
      VALUES (${this.q(subtaskId)}, ${this.q(featureId)}, ${this.q(intent)}, 'pending', ${this.q(applyType)}, ${this.q(applyPath)}, ${now});
    `;
    this.run(sql);

    const feature = this.getFeature(featureId);
    if (feature) {
      this.recordEvent(feature.project_id, featureId, subtaskId, "subtask_created", { intent });
    }
    return subtaskId;
  }

  /**
   * Create multiple subtasks at once.
   * @param {string} featureId
   * @param {Array<Object>} subtasks
   * @returns {Array<string>} subtask ids
   */
  createSubtasks(featureId, subtasks) {
    return subtasks.map((s) => this.createSubtask({ featureId, ...s }));
  }

  /**
   * Get a subtask by ID.
   * @param {string} subtaskId
   * @returns {Object|null}
   */
  getSubtask(subtaskId) {
    const rows = this.query(`SELECT * FROM subtasks WHERE id = ${this.q(subtaskId)};`);
    if (rows[0]) {
      rows[0].result = this.parseJson(rows[0].result);
    }
    return rows[0] || null;
  }

  /**
   * Get all subtasks for a feature.
   * @param {string} featureId
   * @returns {Array<Object>}
   */
  getSubtasksByFeature(featureId) {
    const rows = this.query(`SELECT * FROM subtasks WHERE feature_id = ${this.q(featureId)} ORDER BY created_at ASC;`);
    return rows.map((r) => ({ ...r, result: this.parseJson(r.result) }));
  }

  /**
   * Update subtask status and result.
   * @param {string} subtaskId
   * @param {Object} updates
   */
  updateSubtask(subtaskId, updates) {
    const now = Date.now();
    const sets = [];
    if (updates.status !== undefined) sets.push(`status = ${this.q(updates.status)}`);
    if (updates.result !== undefined) sets.push(`result = ${this.j(updates.result)}`);
    if (updates.error !== undefined) sets.push(`error = ${this.q(updates.error)}`);
    if (updates.status === "running") sets.push(`started_at = ${now}`);
    if (updates.status === "completed" || updates.status === "failed") sets.push(`completed_at = ${now}`);

    if (sets.length > 0) {
      const sql = `UPDATE subtasks SET ${sets.join(", ")} WHERE id = ${this.q(subtaskId)};`;
      this.run(sql);
    }
  }

  /**
   * Delete a subtask.
   * @param {string} subtaskId
   */
  deleteSubtask(subtaskId) {
    this.run(`DELETE FROM subtasks WHERE id = ${this.q(subtaskId)};`);
  }

  /**
   * Increment and return retry count for a feature (tracked via events).
   * @param {string} featureId
   * @returns {number} retry count after increment
   */
  incrementRetryCount(featureId) {
    const feature = this.getFeature(featureId);
    if (!feature) return 0;
    const projectId = feature.project_id;
    this.recordEvent(projectId, featureId, null, "retry_incremented", {});
    const rows = this.query(`
      SELECT COUNT(*) as cnt FROM events
      WHERE feature_id = ${this.q(featureId)} AND event_type = 'retry_incremented';
    `);
    return rows[0]?.cnt || 0;
  }

  /**
   * Reset any features stuck in "running" (e.g., after abrupt shutdown).
   * @param {string} [newStatus="failed"]
   */
  resetRunningFeatures(newStatus = "failed") {
    const now = Date.now();
    const sql = `
      UPDATE features
      SET status = ${this.q(newStatus)}, updated_at = ${now}
      WHERE status = 'running';
    `;
    this.run(sql);
  }

  /**
   * Get the next pending subtask for a feature.
   * @param {string} featureId
   * @returns {Object|null}
   */
  getNextPendingSubtask(featureId) {
    const rows = this.query(`
      SELECT * FROM subtasks
      WHERE feature_id = ${this.q(featureId)} AND status = 'pending'
      ORDER BY created_at ASC
      LIMIT 1;
    `);
    if (rows[0]) {
      rows[0].result = this.parseJson(rows[0].result);
    }
    return rows[0] || null;
  }

  // ==================== EVENTS ====================

  /**
   * Record an event.
   * @param {string|null} projectId
   * @param {string|null} featureId
   * @param {string|null} subtaskId
   * @param {string} eventType
   * @param {Object} payload
   */
  recordEvent(projectId, featureId, subtaskId, eventType, payload = {}) {
    const now = Date.now();
    const sql = `
      INSERT INTO events (project_id, feature_id, subtask_id, event_type, payload, timestamp)
      VALUES (${this.q(projectId)}, ${this.q(featureId)}, ${this.q(subtaskId)}, ${this.q(eventType)}, ${this.j(payload)}, ${now});
    `;
    this.run(sql);
  }

  /**
   * Get events for a project.
   * @param {string} projectId
   * @param {Object} options
   * @returns {Array<Object>}
   */
  getEvents(projectId, { featureId, eventType, limit = 100, offset = 0 } = {}) {
    let where = `project_id = ${this.q(projectId)}`;
    if (featureId) where += ` AND feature_id = ${this.q(featureId)}`;
    if (eventType) where += ` AND event_type = ${this.q(eventType)}`;

    const rows = this.query(`
      SELECT * FROM events
      WHERE ${where}
      ORDER BY timestamp DESC
      LIMIT ${limit} OFFSET ${offset};
    `);
    return rows.map((r) => ({ ...r, payload: this.parseJson(r.payload) }));
  }

  // ==================== WIZARD MESSAGES ====================

  /**
   * Add a wizard chat message.
   * @param {string} projectId
   * @param {string} role - 'user' or 'assistant'
   * @param {string} content
   */
  addWizardMessage(projectId, role, content) {
    const now = Date.now();
    const sql = `
      INSERT INTO wizard_messages (project_id, role, content, timestamp)
      VALUES (${this.q(projectId)}, ${this.q(role)}, ${this.q(content)}, ${now});
    `;
    this.run(sql);
  }

  /**
   * Get wizard conversation for a project.
   * @param {string} projectId
   * @returns {Array<Object>}
   */
  getWizardMessages(projectId) {
    return this.query(`
      SELECT * FROM wizard_messages
      WHERE project_id = ${this.q(projectId)}
      ORDER BY timestamp ASC;
    `);
  }

  /**
   * Clear wizard messages for a project.
   * @param {string} projectId
   */
  clearWizardMessages(projectId) {
    this.run(`DELETE FROM wizard_messages WHERE project_id = ${this.q(projectId)};`);
  }

  // ==================== HELPERS ====================

  /**
   * Safely parse JSON or return null.
   * @param {string|null} str
   * @returns {any}
   */
  parseJson(str) {
    if (!str || str === "null") return null;
    try {
      return JSON.parse(str);
    } catch {
      return null;
    }
  }

  /**
   * Get statistics for a project.
   * @param {string} projectId
   * @returns {Object}
   */
  getProjectStats(projectId) {
    const features = this.getFeaturesByProject(projectId);
    const stats = {
      total: features.length,
      byPriority: { A: 0, B: 0, C: 0 },
      byStatus: { pending: 0, running: 0, blocked: 0, completed: 0, verified: 0, failed: 0 },
      completedCount: 0,
      blockedCount: 0,
    };

    for (const f of features) {
      stats.byPriority[f.priority] = (stats.byPriority[f.priority] || 0) + 1;
      stats.byStatus[f.status] = (stats.byStatus[f.status] || 0) + 1;
      if (f.status === "completed" || f.status === "verified") stats.completedCount++;
      if (!this.isFeatureRunnable(f.id) && f.status === "pending") {
        stats.blockedCount++;
      }
    }

    return stats;
  }
}

module.exports = { FeatureStore };
