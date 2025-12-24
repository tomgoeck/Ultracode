const fs = require("fs");
const path = require("path");
const { ContextBuilder } = require("./contextBuilder");

/**
 * FeatureManager handles the execution and management of features.
 * Coordinates between FeatureStore, FeaturePlanner, and Orchestrator.
 */
class FeatureManager {
  /**
   * @param {Object} opts
   * @param {import('./featureStore').FeatureStore} opts.featureStore
   * @param {import('./orchestrator').Orchestrator} opts.orchestrator
   * @param {import('./llmRegistry').LLMRegistry} opts.llmRegistry
   * @param {Function} opts.planFeature - Function to plan a feature into subtasks
   * @param {Function} opts.broadcast - Function to broadcast SSE events
   * @param {import('./gitCommitter').GitCommitter} opts.gitCommitter
   * @param {import('./serverManager').ServerManager} opts.serverManager
   * @param {import('./testRunner').TestRunner} opts.testRunner
   */
  constructor({ featureStore, orchestrator, llmRegistry, planFeature, broadcast, gitCommitter, serverManager, testRunner, configStore, resourceMonitor }) {
    this.featureStore = featureStore;
    this.orchestrator = orchestrator;
    this.llmRegistry = llmRegistry;
    this.planFeature = planFeature;
    this.broadcast = broadcast || (() => {});
    this.gitCommitter = gitCommitter;
    this.serverManager = serverManager;
    this.testRunner = testRunner;
    this.configStore = configStore;
    this.resourceMonitor = resourceMonitor;

    // Initialize ContextBuilder for intelligent context aggregation
    this.contextBuilder = new ContextBuilder(featureStore);

    // Track running executions
    this.runningFeatures = new Map(); // featureId -> { abortController, promise }
    this.pauseRequested = new Set(); // featureIds that should pause
  }

  // ==================== FEATURE CRUD (delegated to store) ====================

  getFeature(featureId) {
    return this.featureStore.getFeature(featureId);
  }

  getFeaturesByProject(projectId) {
    return this.featureStore.getFeaturesByProject(projectId);
  }

  createFeature(data) {
    return this.featureStore.createFeature(data);
  }

  updateFeature(featureId, updates) {
    return this.featureStore.updateFeature(featureId, updates);
  }

  deleteFeature(featureId) {
    return this.featureStore.deleteFeature(featureId);
  }

  // ==================== DEPENDENCY MANAGEMENT ====================

  /**
   * Check if a feature is runnable (all dependencies completed).
   * @param {string} featureId
   * @returns {boolean}
   */
  isRunnable(featureId) {
    const feature = this.featureStore.getFeature(featureId);
    if (!feature) return false;
    // Pending with deps met OR paused with deps met can run/resume
    const depsMet = this.featureStore.areDependenciesMet(featureId);
    if (!depsMet) return false;
    return feature.status === "pending" || feature.status === "paused";
  }

  /**
   * Get the next runnable feature for a project.
   * Priority order: A > B > C, then by order_index.
   * @param {string} projectId
   * @returns {Object|null}
   */
  getNextRunnable(projectId) {
    return this.featureStore.getNextRunnableFeature(projectId);
  }

  /**
   * Get all blocked features (have unmet dependencies).
   * @param {string} projectId
   * @returns {Array<Object>}
   */
  getBlockedFeatures(projectId) {
    const features = this.featureStore.getFeaturesByProject(projectId);
    return features.filter((f) => f.status === "pending" && !this.isRunnable(f.id));
  }

  /**
   * Validate dependencies before setting them.
   * @param {string} featureId
   * @param {Array<string>} newDeps
   * @returns {{valid: boolean, error?: string}}
   */
  validateDependencies(featureId, newDeps) {
    return this.featureStore.validateDependencies(featureId, newDeps);
  }

  // ==================== FEATURE EXECUTION ====================

  /**
   * Ensure a provider is registered for a given model string (supports "provider:model" format).
   * @param {string} modelStr
   * @returns {string|null} registered provider key
   */
  _ensureProvider(modelStr) {
    if (!modelStr) return null;
    if (!modelStr.includes(":")) {
      if (!this.llmRegistry.has(modelStr)) {
        throw new Error(`Provider not registered: ${modelStr}`);
      }
      return modelStr;
    }

    const [providerType, modelName] = modelStr.split(":", 2);
    const providerKey = `${providerType}:${modelName}`;
    if (this.llmRegistry.has(providerKey)) {
      return providerKey;
    }

    const { createProvider } = require("./providerFactory");
    const apiKey = this.configStore?.getKey(providerType);
    if (!apiKey && (providerType === "openai" || providerType === "claude" || providerType === "gemini")) {
      throw new Error(`API key for provider "${providerType}" is missing. Please configure it in settings.`);
    }

    const cfg = {
      name: providerKey,
      type: providerType,
      apiKey,
      model: modelName,
    };

    this.llmRegistry.register(providerKey, createProvider(cfg));
    console.log(`[FeatureManager] Auto-registered provider: ${providerKey}`);
    return providerKey;
  }

  /**
   * Execute a specific feature.
   * Plans subtasks if needed, then executes them sequentially.
   * @param {string} featureId
   * @param {Object} options
   * @returns {Promise<Object>} Execution result
   */
  async executeFeature(featureId, options = {}) {
    const feature = this.featureStore.getFeature(featureId);
    if (!feature) {
      throw new Error(`Feature not found: ${featureId}`);
    }

    const project = this.featureStore.getProject(feature.project_id);
    if (!project) {
      throw new Error(`Project not found: ${feature.project_id}`);
    }

    // Check if runnable
    if (!this.isRunnable(featureId)) {
      const blockedBy = (feature.depends_on || []).filter((depId) => {
        const dep = this.featureStore.getFeature(depId);
        return !dep || (dep.status !== "completed" && dep.status !== "verified");
      });
      throw new Error(`Feature is blocked by unmet dependencies: ${blockedBy.join(", ")}`);
    }

    // Check if already running
    if (this.runningFeatures.has(featureId)) {
      throw new Error(`Feature is already running: ${featureId}`);
    }

    // Update status to running
    this.featureStore.updateFeature(featureId, { status: "running" });
    this.featureStore.recordEvent(project.id, featureId, null, "feature_started", {
      name: feature.name,
      priority: feature.priority,
    });
    this.broadcast({ type: "feature-started", projectId: project.id, featureId, feature });

    const abortController = { aborted: false };
    const executionPromise = this._runFeatureExecution(feature, project, abortController, options);
    this.runningFeatures.set(featureId, { abortController, promise: executionPromise });

    try {
      const result = await executionPromise;
      return result;
    } finally {
      this.runningFeatures.delete(featureId);
      this.pauseRequested.delete(featureId);
    }
  }

  /**
   * Internal: Run the actual feature execution.
   * @private
   */
  async _runFeatureExecution(feature, project, abortController, options) {
    const featureId = feature.id;
    const results = [];
    let finalStatus = "completed";

    try {
      const plannerModel = this._ensureProvider(project.planner_model);
      const executorModel = this._ensureProvider(project.executor_model);
      const voteModel = this._ensureProvider(project.vote_model || project.executor_model);
      if (!plannerModel) throw new Error("No planner model configured for project");
      if (!executorModel) throw new Error("No executor model configured for project");
      if (!voteModel) throw new Error("No vote model configured for project");

      // Step 1: Plan the feature into subtasks if needed
      let subtasks = this.featureStore.getSubtasksByFeature(featureId);
      if (subtasks.length === 0) {
        this.broadcast({
          type: "feature-planning",
          projectId: project.id,
          featureId,
          plannerModel,
          intent: `Plan feature "${feature.name}"`,
        });

        // Load context
        const context = await this._loadFeatureContext(project, feature);

        const plannedSubtasks = await this.planFeature({
          feature,
          project,
          context,
          projectPath: project.folder_path,
          llmRegistry: this.llmRegistry,
          plannerModel,
          fallbackModels: [executorModel, voteModel],
          configStore: this.configStore,
          resourceMonitor: this.resourceMonitor,
          onProgress: (message) => {
            // Bubble up planner activity to UI/terminal
            this.broadcast({
              type: "planner-progress",
              projectId: project.id,
              featureId,
              message,
            });
            this.featureStore.recordEvent(project.id, featureId, null, "planner_progress", {
              message,
            });
          },
        });

        // Create subtasks in database
        for (const st of plannedSubtasks) {
          this.featureStore.createSubtask({
            featureId,
            intent: st.intent,
            applyType: st.apply?.type,
            applyPath: st.apply?.path,
          });
        }

        subtasks = this.featureStore.getSubtasksByFeature(featureId);
        this.broadcast({
          type: "feature-planned",
          projectId: project.id,
          featureId,
          subtaskCount: subtasks.length,
          plannerModel,
        });
      }

      // Step 2: Execute subtasks sequentially
      const { ProjectGuard } = require("./projectGuard");
      const workspaceGuard = new ProjectGuard(project.folder_path);

      for (const subtask of subtasks) {
        // Check for abort/pause
        if (abortController.aborted || this.pauseRequested.has(featureId)) {
          finalStatus = "paused";
          break;
        }

        // Skip completed subtasks
        if (subtask.status === "completed") {
          continue;
        }

        // Update subtask status
        this.featureStore.updateSubtask(subtask.id, { status: "running" });
        this.featureStore.recordEvent(project.id, featureId, subtask.id, "subtask_started", {
          intent: subtask.intent,
        });
        this.broadcast({ type: "subtask-started", projectId: project.id, featureId, subtaskId: subtask.id, subtask });

        try {
          // Re-ensure models before each subtask in case registry was pruned/restarted
          const execModelKey = this._ensureProvider(project.executor_model || executorModel);
          const voteModelKey = this._ensureProvider(project.vote_model || project.executor_model || voteModel);

          let stepContext = null;
          try {
            const execContext = await this.contextBuilder.buildExecutionContext(project, feature, subtask);
            stepContext = this.contextBuilder.formatAsPrompt(execContext, "execution");
          } catch (err) {
            console.warn(`[FeatureManager] Failed to build execution context: ${err.message}`);
          }

          const applyType = subtask.apply_type || "writeFile";
          const maxChars = applyType === "editFile" ? 12000 : 20000;

          // Build task object for orchestrator
          const task = {
            id: `task-${featureId}-${subtask.id}`,
            title: `${feature.name}: ${subtask.intent}`,
            goal: subtask.intent,
            model: execModelKey,
            voteModel: voteModelKey || execModelKey,
            k: 2,
            nSamples: 3,
            projectId: project.id,
            featureId,
            steps: [
              {
                id: subtask.id,
                intent: subtask.intent,
                stateRefs: ["workspace"],
                context: stepContext,
                redFlags: [{ maxChars }],
                apply: {
                  type: applyType,
                  path: subtask.apply_path,
                },
              },
            ],
          };

          // Run through orchestrator
          const stepResult = await this.orchestrator.runStep(task, task.steps[0], workspaceGuard);

          // Treat non-applied or errored results as failures
          if (!stepResult || stepResult.applied === false || stepResult.error) {
            const errMsg = stepResult?.error || "Subtask did not apply any changes";
            throw new Error(errMsg);
          }

          // Update subtask with result
          this.featureStore.updateSubtask(subtask.id, {
            status: "completed",
            result: stepResult,
          });
          this.featureStore.recordEvent(project.id, featureId, subtask.id, "subtask_completed", {
            hasWinner: !!stepResult.winner,
          });
          this.broadcast({ type: "subtask-completed", projectId: project.id, featureId, subtaskId: subtask.id, result: stepResult });
          results.push({ subtaskId: subtask.id, result: stepResult });
        } catch (subtaskError) {
          // Subtask failed
          this.featureStore.updateSubtask(subtask.id, {
            status: "failed",
            error: subtaskError.message,
          });
          this.featureStore.recordEvent(project.id, featureId, subtask.id, "subtask_failed", {
            error: subtaskError.message,
          });
          this.broadcast({ type: "subtask-failed", projectId: project.id, featureId, subtaskId: subtask.id, error: subtaskError.message });
          results.push({ subtaskId: subtask.id, error: subtaskError.message });
          finalStatus = "failed";
          break; // Stop on first failure
        }
      }

      // Step 3: Automated tests disabled (temporary)
      // (Previously: run tests and add fix subtasks/retries on failure)

      // Step 4: Update feature status based on priority
      if (finalStatus === "completed" || finalStatus === "verified") {
        // Generate technical summary
        const technicalSummary = this._generateTechnicalSummary(feature, subtasks, results);

        // Priority A (Essential): Auto-complete after execution
        // Priority B/C: Require human verification
        let targetStatus = finalStatus;
        if (feature.priority === 'B' || feature.priority === 'C') {
          targetStatus = 'human_testing'; // Requires manual confirmation
        }

        this.featureStore.updateFeature(featureId, {
          status: targetStatus,
          technicalSummary,
        });

        // Git commit
        if (this.gitCommitter && typeof this.gitCommitter.commitFeatureCompletion === "function") {
          const commitResult = await this.gitCommitter.commitFeatureCompletion(feature, project, results);
          if (commitResult?.committed) {
            this.featureStore.recordEvent(project.id, featureId, null, "git_commit", {
              message: commitResult.message,
              changedFiles: commitResult.changedFiles,
            });
          }
        }

        this.featureStore.recordEvent(project.id, featureId, null, targetStatus === 'human_testing' ? "feature_awaiting_test" : "feature_completed", {
          subtasksCompleted: results.filter((r) => !r.error).length,
          technicalSummary: technicalSummary?.substring(0, 200),
          status: targetStatus,
          priority: feature.priority,
        });
        this.broadcast({
          type: targetStatus === 'human_testing' ? "feature-awaiting-test" : "feature-completed",
          projectId: project.id,
          featureId,
          results,
          status: targetStatus,
          priority: feature.priority
        });
      } else if (finalStatus === "paused") {
        this.featureStore.updateFeature(featureId, { status: "paused" });
        this.featureStore.recordEvent(project.id, featureId, null, "feature_paused", {});
        this.broadcast({ type: "feature-paused", projectId: project.id, featureId });
      } else {
        this.featureStore.updateFeature(featureId, { status: "failed" });
        this.featureStore.recordEvent(project.id, featureId, null, "feature_failed", {
          lastError: results[results.length - 1]?.error,
        });
        this.broadcast({ type: "feature-failed", projectId: project.id, featureId, results });
      }

      return { featureId, status: finalStatus, results };
    } catch (error) {
      // Unexpected error
      this.featureStore.updateFeature(featureId, { status: "failed" });
      this.featureStore.recordEvent(project.id, featureId, null, "feature_error", {
        error: error.message,
      });
      this.broadcast({ type: "feature-error", projectId: project.id, featureId, error: error.message });
      throw error;
    }
  }

  /**
   * Load context for feature planning using ContextBuilder.
   * @private
   */
  async _loadFeatureContext(project, feature) {
    // Use ContextBuilder for intelligent context aggregation
    const richContext = await this.contextBuilder.buildPlanningContext(project, feature, {
      maxDepth: 3,
      includeSimilarFeatures: true,
    });

    // Return both rich context and legacy format
    return {
      // Rich context from ContextBuilder
      richContext,

      // Legacy format (for backward compatibility with existing planFeature calls)
      projectMd: richContext.guidelines || "",
      completedFeatures: richContext.completedFeatures || [],

      // Additional context fields
      fileTree: richContext.fileTree || [],
      dependencies: richContext.dependencies || [],
    };
  }

  /**
   * Generate technical summary for a completed feature.
   * @private
   */
  _generateTechnicalSummary(feature, subtasks, results) {
    const completedSubtasks = subtasks.filter((st) => st.status === "completed");
    const filesModified = new Set();

    for (const st of completedSubtasks) {
      if (st.apply_path) {
        filesModified.add(st.apply_path);
      }
    }

    const summary = [
      `Feature "${feature.name}" completed.`,
      `Subtasks: ${completedSubtasks.length}/${subtasks.length} completed.`,
      filesModified.size > 0 ? `Files modified: ${Array.from(filesModified).join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    return summary;
  }

  /**
   * Test a completed feature with Puppeteer + LLM verification.
   * @private
   */
  async _testFeature(feature, project, options) {
    // Skip tests if disabled
    if (options.skipTests) {
      console.log(`[FeatureManager] Tests skipped for feature ${feature.id}`);
      return null;
    }

    // Skip if no DoD specified
    if (!feature.dod) {
      console.log(`[FeatureManager] No DoD specified for feature ${feature.id}, skipping tests`);
      return null;
    }

    console.log(`[FeatureManager] Testing feature: ${feature.name}`);
    this.broadcast({ type: "feature-testing", projectId: project.id, featureId: feature.id });

    try {
      const voteModel = this._ensureProvider(project.vote_model || project.executor_model);

      // Start dev server
      const { url } = await this.serverManager.startServer(project.folder_path, project.id);

      // Prepare screenshot path
      const screenshotDir = path.join(project.folder_path, ".ultracode", "screenshots");
      fs.mkdirSync(screenshotDir, { recursive: true });
      const screenshotPath = path.join(screenshotDir, `${feature.id}-${Date.now()}.png`);

      // Run test
      const testResult = await this.testRunner.testFeature({
        url,
        featureName: feature.name,
        featureDescription: feature.description || "",
        dod: feature.dod,
        voteModel,
        screenshotPath,
      });

      // Record event
      this.featureStore.recordEvent(project.id, feature.id, null, "feature_tested", {
        passed: testResult.passed,
        feedback: testResult.feedback?.substring(0, 200),
      });

      this.broadcast({
        type: "feature-tested",
        projectId: project.id,
        featureId: feature.id,
        testResult,
      });

      // Generate manual test instructions if needed
      const manualInstructions = this.testRunner.generateManualTestInstructions(feature);
      if (manualInstructions) {
        console.log(`[FeatureManager] Manual tests required:\n${manualInstructions.instructions}`);
        this.broadcast({
          type: "manual-tests-required",
          projectId: project.id,
          featureId: feature.id,
          manualInstructions,
        });
      }

      return testResult;
    } catch (error) {
      console.error(`[FeatureManager] Test error:`, error.message);
      this.featureStore.recordEvent(project.id, feature.id, null, "test_error", {
        error: error.message,
      });
      this.broadcast({
        type: "test-error",
        projectId: project.id,
        featureId: feature.id,
        error: error.message,
      });
      return { passed: false, feedback: `Test error: ${error.message}` };
    }
  }

  /**
   * Execute the next runnable feature for a project.
   * @param {string} projectId
   * @returns {Promise<Object|null>}
   */
async executeNextRunnable(projectId) {
  // Prefer resuming paused features first (by priority/order)
  const paused = this.featureStore
    .getFeaturesByProject(projectId)
    .filter((f) => f.status === "paused")
    .filter((f) => this.isRunnable(f.id)); // skip paused-but-blocked features
  if (paused.length > 0) {
    const priorityRank = { A: 1, B: 2, C: 3 };
    paused.sort((a, b) => {
      const pr = (priorityRank[a.priority] || 99) - (priorityRank[b.priority] || 99);
      if (pr !== 0) return pr;
        return (a.order_index || 0) - (b.order_index || 0);
      });
      const featureToResume = paused[0];
      return this.resumeFeature(featureToResume.id);
    }

    const feature = this.getNextRunnable(projectId);
    if (!feature) {
      return null;
    }
    return this.executeFeature(feature.id);
  }

  /**
   * Request to pause a running feature (graceful, after current subtask).
   * @param {string} featureId
   */
  requestPause(featureId) {
    if (this.runningFeatures.has(featureId)) {
      this.pauseRequested.add(featureId);
      this.broadcast({ type: "feature-pause-requested", featureId });
      return true;
    }
    return false;
  }

  /**
   * Abort a running feature immediately.
   * @param {string} featureId
   */
  abortFeature(featureId) {
    const running = this.runningFeatures.get(featureId);
    if (running) {
      running.abortController.aborted = true;
      return true;
    }
    return false;
  }

  /**
   * Resume a paused feature.
   * @param {string} featureId
   * @returns {Promise<Object>}
   */
  async resumeFeature(featureId) {
    const feature = this.featureStore.getFeature(featureId);
    if (!feature || feature.status !== "paused") {
      throw new Error(`Feature is not paused: ${featureId}`);
    }
    return this.executeFeature(featureId);
  }

  /**
   * Check if a feature is currently running.
   * @param {string} featureId
   * @returns {boolean}
   */
  isRunning(featureId) {
    return this.runningFeatures.has(featureId);
  }

  /**
   * Retry a single failed subtask.
   * @param {string} subtaskId
   * @returns {Promise<Object>}
   */
  async retrySubtask(subtaskId) {
    const subtask = this.featureStore.getSubtask(subtaskId);
    if (!subtask) {
      throw new Error(`Subtask not found: ${subtaskId}`);
    }

    const feature = this.featureStore.getFeature(subtask.feature_id);
    if (!feature) {
      throw new Error(`Feature not found for subtask: ${subtask.feature_id}`);
    }

    const project = this.featureStore.getProject(feature.project_id);
    if (!project) {
      throw new Error(`Project not found: ${feature.project_id}`);
    }

    // Check if feature is running
    if (this.runningFeatures.has(feature.id)) {
      throw new Error(`Cannot retry subtask while feature is running`);
    }

    // Reset subtask to pending
    this.featureStore.updateSubtask(subtaskId, {
      status: "pending",
      error: null,
      result: null,
    });

    this.broadcast({
      type: "subtask-retry-started",
      projectId: project.id,
      featureId: feature.id,
      subtaskId,
    });

    // Execute just this subtask
    try {
      const executorModel = this._ensureProvider(project.executor_model);
      const voteModel = this._ensureProvider(project.vote_model || project.executor_model);

      const workspaceGuard = new (require("./projectGuard").ProjectGuard)(project.folder_path);

      // Build task object for orchestrator
      const execModelKey = typeof executorModel === "string" ? executorModel : project.executor_model;
      const voteModelKey = typeof voteModel === "string" ? voteModel : (project.vote_model || project.executor_model);
      const applyType = subtask.apply_type || "writeFile";
      const maxChars = applyType === "editFile" ? 12000 : 20000;

      let stepContext = null;
      try {
        const execContext = await this.contextBuilder.buildExecutionContext(project, feature, subtask);
        stepContext = this.contextBuilder.formatAsPrompt(execContext, "execution");
      } catch (err) {
        console.warn(`[FeatureManager] Failed to build execution context: ${err.message}`);
      }

      const task = {
        taskId: `retry-${subtaskId}`,
        projectId: project.id,
        execModel: execModelKey,
        voteModel: voteModelKey,
        k: 2,
        nSamples: 3,
        projectId: project.id,
        featureId: feature.id,
        steps: [
          {
            id: subtask.id,
            intent: subtask.intent,
            stateRefs: ["workspace"],
            context: stepContext,
            redFlags: [{ maxChars }],
            apply: {
              type: applyType,
              path: subtask.apply_path,
            },
          },
        ],
      };

      // Run through orchestrator
      const stepResult = await this.orchestrator.runStep(task, task.steps[0], workspaceGuard);

      // Update subtask with result
      this.featureStore.updateSubtask(subtaskId, {
        status: "completed",
        result: stepResult,
      });

      this.featureStore.recordEvent(project.id, feature.id, subtaskId, "subtask_retried_success", {
        hasWinner: !!stepResult.winner,
      });

      this.broadcast({
        type: "subtask-retry-completed",
        projectId: project.id,
        featureId: feature.id,
        subtaskId,
        result: stepResult,
      });

      return { subtaskId, success: true, result: stepResult };
    } catch (error) {
      // Retry failed
      this.featureStore.updateSubtask(subtaskId, {
        status: "failed",
        error: error.message,
      });

      this.featureStore.recordEvent(project.id, feature.id, subtaskId, "subtask_retry_failed", {
        error: error.message,
      });

      this.broadcast({
        type: "subtask-retry-failed",
        projectId: project.id,
        featureId: feature.id,
        subtaskId,
        error: error.message,
      });

      throw error;
    }
  }

  /**
   * Get execution status for a feature.
   * @param {string} featureId
   * @returns {Object}
   */
  getExecutionStatus(featureId) {
    const feature = this.featureStore.getFeature(featureId);
    if (!feature) return null;

    const subtasks = this.featureStore.getSubtasksByFeature(featureId);
    const completed = subtasks.filter((st) => st.status === "completed").length;
    const running = subtasks.filter((st) => st.status === "running").length;
    const pending = subtasks.filter((st) => st.status === "pending").length;
    const failed = subtasks.filter((st) => st.status === "failed").length;

    return {
      featureId,
      featureStatus: feature.status,
      isRunning: this.isRunning(featureId),
      isPauseRequested: this.pauseRequested.has(featureId),
      subtasks: {
        total: subtasks.length,
        completed,
        running,
        pending,
        failed,
      },
      progress: subtasks.length > 0 ? Math.round((completed / subtasks.length) * 100) : 0,
    };
  }

  /**
   * Mark a feature as completed (used for human-in-the-loop approval)
   * @param {string} featureId
   * @returns {Object} Updated feature
   */
  markAsCompleted(featureId) {
    const feature = this.featureStore.getFeature(featureId);
    if (!feature) {
      throw new Error(`Feature not found: ${featureId}`);
    }

    // Only allow marking as completed if in human_testing status
    if (feature.status !== 'human_testing') {
      throw new Error(`Feature must be in 'human_testing' status to mark as completed (current: ${feature.status})`);
    }

    // Update to completed
    this.featureStore.updateFeature(featureId, { status: 'completed' });

    // Record event
    const project = this.featureStore.getProject(feature.project_id);
    if (project) {
      this.featureStore.recordEvent(project.id, featureId, null, "feature_manually_completed", {
        priority: feature.priority,
        previousStatus: 'human_testing',
      });

      this.broadcast({
        type: "feature-manually-completed",
        projectId: project.id,
        featureId,
        status: 'completed'
      });
    }

    return this.featureStore.getFeature(featureId);
  }
}

module.exports = { FeatureManager };
