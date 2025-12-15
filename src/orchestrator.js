const { VotingEngine } = require("./votingEngine");
const { RedFlagger } = require("./redFlagger");

// Coordinates single-step execution using MAD: stateless prompt → candidates → red-flag filter → voting → apply.
class Orchestrator {
  /**
   * @param {{ llmRegistry: any, stateStore: any, commandRunner: any, projectGuard?: any, votingEngine?: VotingEngine }} deps
   */
  constructor({
    llmRegistry,
    stateStore,
    commandRunner,
    projectGuard,
    votingEngine,
    auditLogger,
    eventEmitter,
  }) {
    this.llmRegistry = llmRegistry;
    this.stateStore = stateStore;
    this.commandRunner = commandRunner;
    this.projectGuard = projectGuard;
    this.auditLogger = auditLogger;
    this.eventEmitter = eventEmitter;
    this.votingEngine =
      votingEngine ||
      new VotingEngine({
        redFlagger: new RedFlagger(),
      });
  }

  buildPrompt(task, step, state) {
    const stateSlice = (step.stateRefs || [])
      .map((ref) => `${ref}: ${JSON.stringify(state[ref], null, 2)}`)
      .join("\n");
    return [
      `Task: ${task.title}`,
      `Goal: ${task.goal}`,
      `Step Intent: ${step.intent}`,
      `State:\n${stateSlice || "(empty)"}`,
      `Instruction: Return the minimal code/action needed for this single step only.`,
    ].join("\n\n");
  }

  /**
   * Executes one step with voting + red-flagging and applies the winner to state/commands.
   */
  async runStep(task, step, projectGuardOverride) {
    this.emitEvent({ type: "step-start", taskId: task.id, stepId: step.id, intent: step.intent });

    const state = this.stateStore.snapshot();
    const prompt = this.buildPrompt(task, step, state);
    const providerName = step.voteModel || task.voteModel || task.model;
    const provider = this.llmRegistry.get(providerName);

    let resultObj = null;
    try {
      resultObj = await this.votingEngine.run({
        provider,
        prompt,
        k: step.k || task.k,
        nSamples: step.nSamples || task.nSamples,
        redFlagRules: step.redFlags || task.redFlags,
      });
    } catch (err) {
      step.status = "failed";
      this.appendLog({
        taskId: task.id,
        stepId: step.id,
        event: "error",
        error: err.message,
      });
      this.emitEvent({
        type: "step-error",
        taskId: task.id,
        stepId: step.id,
        error: err.message,
      });
      return { winner: null, leadBy: 0, applied: false, error: err.message };
    }

    const { winner, candidates, leadBy } = resultObj;

    step.candidates = candidates;
    step.winner = winner;

    if (!winner) {
      step.status = "failed";
      this.appendLog({ taskId: task.id, stepId: step.id, event: "no-winner", leadBy });
      this.emitEvent({
        type: "step-error",
        taskId: task.id,
        stepId: step.id,
        error: "no winner",
        leadBy,
      });
      return { winner: null, leadBy, applied: false };
    }

    // Apply "winner" as a state patch placeholder.
    this.stateStore.updateSection("appliedOutputs", (prev = []) => [
      ...prev,
      { taskId: task.id, stepId: step.id, output: winner.output },
    ]);

    const applyResult = await this.applyWinner(step, winner.output, projectGuardOverride);
    let commandResult = null;
    if (step.command) {
      commandResult = await this.commandRunner.run(step.command, {
        stream: (chunk) =>
          this.emitEvent({
            type: "command-output",
            taskId: task.id,
            stepId: step.id,
            command: step.command,
            data: chunk,
          }),
      });
    }

    step.status = "completed";
    this.appendLog({
      taskId: task.id,
      stepId: step.id,
      event: "winner",
      leadBy,
      output: winner.output,
      applyResult,
      commandResult,
    });
    this.emitEvent({
      type: "step-completed",
      taskId: task.id,
      stepId: step.id,
      leadBy,
      winner: winner.output,
      applyResult,
      commandResult,
    });
    return { winner, leadBy, applied: true, applyResult, commandResult };
  }

  appendLog(entry) {
    this.stateStore.updateSection("log", (prev = []) => [...prev, { ...entry, ts: Date.now() }]);
    if (this.auditLogger) {
      this.auditLogger.log(entry);
    }
    this.emitEvent({ type: "log", entry });
  }

  async applyWinner(step, output, projectGuardOverride) {
    if (!step.apply) {
      // Default: store in state for later consumption.
      this.stateStore.updateSection("appliedOutputs", (prev = []) => [
        ...prev,
        { taskId: step.taskId, stepId: step.id, output },
      ]);
      return { kind: "state-only" };
    }

    const guard = projectGuardOverride || this.projectGuard;

    if (step.apply.type === "writeFile") {
      if (!guard) throw new Error("ProjectGuard not configured");
      return guard.writeFile(step.apply.path, output, { dryRun: step.apply.dryRun });
    }
    if (step.apply.type === "appendFile") {
      if (!guard) throw new Error("ProjectGuard not configured");
      const prev = await guard.readFile(step.apply.path).catch(() => "");
      const next = `${prev}${output}`;
      return guard.writeFile(step.apply.path, next, { dryRun: step.apply.dryRun });
    }
    if (step.apply.type === "statePatch") {
      const key = step.apply.stateKey || "outputs";
      this.stateStore.updateSection(key, (prev = []) => [...prev, output]);
      return { kind: "state-patch", key };
    }
    if (step.apply.type === "writeFileFromState") {
      if (!guard) throw new Error("ProjectGuard not configured");
      const key = step.apply.stateKey || "proposedFiles";
      const state = this.stateStore.snapshot();
      const proposed = state[key];
      let content = null;
      if (Array.isArray(proposed)) {
        const match = proposed.find((p) => p.path === step.apply.path) || proposed[0];
        content = match?.content || match;
      } else if (typeof proposed === "string") {
        content = proposed;
      } else if (proposed && typeof proposed === "object") {
        content = proposed.content || JSON.stringify(proposed, null, 2);
      }
      if (content == null) {
        throw new Error(`No content found in state key ${key} to write`);
      }
      return guard.writeFile(step.apply.path, content, { dryRun: step.apply.dryRun });
    }
    throw new Error(`Unknown apply type: ${step.apply.type}`);
  }

  emitEvent(event) {
    if (this.eventEmitter && typeof this.eventEmitter.emit === "function") {
      this.eventEmitter.emit(event);
    }
  }
}

module.exports = { Orchestrator };
