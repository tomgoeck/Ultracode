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

    // Core instructions inspired by agent-cli system prompt
    const coreInstructions = `
# Core Mandates

- **Conventions:** Rigorously analyze existing code in the workspace FIRST. Check imports, function signatures, naming patterns, file structure, and architectural style before generating new code.
- **Libraries/Frameworks:** NEVER assume a library/framework is available. Only use libraries you can verify exist in package.json, requirements.txt, Cargo.toml, or similar configuration files visible in the workspace state.
- **Style & Structure:** Mimic the exact style (formatting, naming, indentation), structure, and architectural patterns of existing code in this project.
- **Idiomatic Changes:** Generate code that integrates naturally and idiomatically with surrounding context. Match the typing style (TypeScript vs JSDoc vs plain JS), error handling patterns, and module structure.
- **Comments:** Add code comments sparingly. Focus on *why* something is done (especially for complex logic), not *what* is done. Only add high-value comments if necessary for clarity.
- **No Assumptions:** Do not invent APIs, functions, or modules that don't exist. Work only with what you can verify in the workspace state.
`.trim();

    // Determine what type of output is expected based on apply type
    let outputInstruction = "";
    if (step.apply?.type === "writeFile") {
      outputInstruction = `
## Task: Generate Complete File Content

You are generating the COMPLETE content for: ${step.apply.path}

IMPORTANT:
- Generate ONLY the file content itself (code, markup, config, data, etc.)
- DO NOT generate shell commands (mkdir, touch, npm install, cd, etc.)
- DO NOT generate instructions or numbered steps ("1. Create...", "Step 1:", "First, open...")
- DO NOT describe what you're doing - just output the actual file content
- The content should be production-ready and follow project conventions
- If this file type already exists elsewhere, maintain consistent style and structure

Analysis Steps (review workspace state before generating):
1. Check if similar files exist (look for patterns, naming conventions)
2. Identify conventions: imports, exports, formatting, code structure
3. Match the established patterns in your generated code

Your output will be written directly to the file.
`.trim();
    } else if (step.apply?.type === "appendFile") {
      outputInstruction = `
## Task: Generate Content to Append

You are appending content to: ${step.apply.path}

IMPORTANT:
- Generate ONLY the content to append (no shell commands, no instructions)
- The existing file will be read, your output appended, then written back
- Ensure your addition integrates smoothly with existing content
- Match the style and formatting of the existing file
- Your output should continue naturally from where the file currently ends
`.trim();
    } else if (step.apply?.type === "editFile") {
      outputInstruction = `
## Task: Generate Search-Replace Edit Instructions

You are editing: ${step.apply.path}

Output a JSON object with this exact structure:
{
  "old_string": "exact text to find (including 3+ lines of context)",
  "new_string": "replacement text"
}

CRITICAL RULES:
- Include at least 3 lines of context BEFORE and AFTER the target text
- Match whitespace, indentation, and newlines EXACTLY as they appear in the file
- Never escape the strings - use literal text matching
- The old_string must uniquely identify the single location to edit
- If multiple occurrences might exist, include enough context to be unique

Example:
{
  "old_string": "function calculate(x) {\\n  return x * 2;\\n}",
  "new_string": "function calculate(x, multiplier = 2) {\\n  return x * multiplier;\\n}"
}
`.trim();
    } else {
      outputInstruction = "Return the complete output for this step. Keep it focused and minimal.";
    }

    return [
      coreInstructions,
      ``,
      `# Current Task Context`,
      `Task: ${task.title}`,
      `Goal: ${task.goal}`,
      `Step Intent: ${step.intent}`,
      ``,
      `# Available State`,
      stateSlice || "(empty)",
      ``,
      outputInstruction,
    ].join("\n");
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
        temperature: step.temperature || task.temperature || 0.2,
        taskId: task.id,
        stepId: step.id,
        voteModel: providerName, // Pass vote model for paraphrasing
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
