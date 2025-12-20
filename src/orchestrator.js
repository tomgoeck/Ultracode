const { VotingEngine } = require("./votingEngine");
const { RedFlagger } = require("./redFlagger");
const { parseActions, executeActions } = require("./actionExecutor");

function unwrapCodeFence(text) {
  if (!text || typeof text !== "string") return text;
  const m = text.trim().match(/^```[a-zA-Z0-9]*\s*\n([\s\S]*?)\n```$/);
  return m ? m[1] : text;
}

/**
 * Simplified patch application (single file, no line numbers). Uses context + removed lines
 * to find and replace a unique block. Throws if the context is not found or no change results.
 * @param {import('./projectGuard').ProjectGuard} guard
 * @param {string} relPath
 * @param {string} patch
 */
async function applySimplePatch(guard, relPath, patch) {
  const headers = Array.from(patch.matchAll(/^[+-]{3}\s+(?:a\/|b\/)?(.+)$/gm)).map((m) => m[1]);
  if (headers.length && !headers.every((p) => p.endsWith(relPath))) {
    throw new Error("Patch references unexpected paths");
  }

  const content = await guard.readFile(relPath);
  const lines = patch.split("\n");
  const hunks = [];
  let idx = 0;

  while (idx < lines.length) {
    const line = lines[idx];
    if (line.startsWith("@@")) {
      const hunk = [];
      idx++;
      while (idx < lines.length && !lines[idx].startsWith("@@")) {
        const l = lines[idx];
        if (l.startsWith("+") || l.startsWith("-") || l.startsWith(" ")) {
          hunk.push(l);
        } else if (l.startsWith("---") || l.startsWith("+++")) {
          // skip extra headers
        }
        idx++;
      }
      if (hunk.length) hunks.push(hunk);
      continue;
    }
    idx++;
  }

  if (!hunks.length) {
    throw new Error("No hunks found in patch");
  }

  let updated = content;
  for (const hunk of hunks) {
    const findLines = [];
    const replaceLines = [];
    for (const hLine of hunk) {
      const body = hLine.slice(1);
      if (hLine.startsWith(" ")) {
        findLines.push(body);
        replaceLines.push(body);
      } else if (hLine.startsWith("-")) {
        findLines.push(body);
      } else if (hLine.startsWith("+")) {
        replaceLines.push(body);
      }
    }
    const findText = findLines.join("\n");
    const replaceText = replaceLines.join("\n");

    // If no context provided, treat as full rewrite
    if (!findText.length) {
      if (!replaceText.length) {
        throw new Error("Simple patch has no findText or replaceText");
      }
      updated = replaceText;
      continue;
    }

    const pos = updated.indexOf(findText);
    if (pos === -1) {
      // As a last resort, if small context and replacement exists, rewrite entire file
      if (findLines.length <= 2 && replaceText.length) {
        updated = replaceText;
        continue;
      }
      throw new Error("Simple patch failed: context not found in file");
    }
    updated = updated.slice(0, pos) + replaceText + updated.slice(pos + findText.length);
  }

  if (updated === content) {
    throw new Error("Simple patch produced no changes");
  }

  return guard.writeFile(relPath, updated, { dryRun: false });
}

/**
 * Last-resort: reconstruct file content from patch body by keeping context/added lines,
 * dropping removed lines. Useful when git apply rejects malformed hunks.
 * @param {import('./projectGuard').ProjectGuard} guard
 * @param {string} relPath
 * @param {string} patch
 */
async function applyPatchAsNewFile(guard, relPath, patch) {
  const lines = patch.split("\n");
  const body = [];
  for (const line of lines) {
    if (line.startsWith("---") || line.startsWith("+++")) continue;
    if (line.startsWith("@@")) continue;
    if (line.startsWith("+")) {
      body.push(line.slice(1));
    } else if (line.startsWith(" ")) {
      body.push(line.slice(1));
    } else if (line.startsWith("-")) {
      continue;
    }
  }
  if (!body.length) {
    throw new Error("Could not reconstruct file from patch");
  }
  return guard.writeFile(relPath, body.join("\n"), { dryRun: false });
}

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
    snapshotStore,
  }) {
    this.llmRegistry = llmRegistry;
    this.stateStore = stateStore;
    this.commandRunner = commandRunner;
    this.projectGuard = projectGuard;
    this.auditLogger = auditLogger;
    this.eventEmitter = eventEmitter;
    this.snapshotStore = snapshotStore;
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

Preferred format: return a unified diff patch wrapped in JSON.

{
  "patch": "--- a/${step.apply.path}\\n+++ b/${step.apply.path}\\n@@ ... @@\\n-old line\\n+new line\\n"
}

Rules for patch:
- Use unified diff format with correct path header.
- Include enough context to be unique and safe.
- Do NOT replace the whole file; change only the needed lines.

If you cannot produce a patch, fall back to a minimal JSON replace:
{
  "old_string": "exact text to find (3+ lines context)",
  "new_string": "replacement"
}
But patch is strongly preferred because it is safer and reviewable.
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
      `Planner Model: ${task.planningModel || task.model || "unknown"}`,
      `Executor/Vote Model: ${step.voteModel || task.voteModel || task.model || "unknown"}`,
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
    const voteConfig = {
      k: step.k || task.k,
      initialSamples: step.initialSamples || task.initialSamples,
      maxSamples: step.maxSamples || step.nSamples || task.maxSamples || task.nSamples,
      temperature: step.temperature ?? task.temperature,
      redFlags: step.redFlags || task.redFlags,
    };

    this.snapshotStore?.recordStepStart({
      task,
      step,
      prompt,
      config: voteConfig,
      inputView: { stateRefs: step.stateRefs, goal: task.goal },
    });

    let resultObj = null;
    try {
      resultObj = await this.votingEngine.run({
        provider,
        prompt,
        k: voteConfig.k,
        initialSamples: voteConfig.initialSamples,
        maxSamples: voteConfig.maxSamples,
        redFlagRules: voteConfig.redFlags,
        temperature: voteConfig.temperature,
        taskId: task.id,
        stepId: step.id,
        voteModel: providerName, // Pass vote model for paraphrasing
      });
    } catch (err) {
      step.status = "failed";
      this.snapshotStore?.recordStepEnd(step.id, "failed", err.message);
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

    const { winner, candidates, leadBy, achievedMargin } = resultObj;
    this.snapshotStore?.recordVotes(step.id, candidates, winner?.output);

    step.candidates = candidates;
    step.winner = winner;

    // Console summary for voting to reduce blind spots in logs
    if (candidates?.length) {
      const temps = candidates
        .map((c) => c.metrics?.temperature)
        .filter((t) => t !== undefined)
        .map((t) => Number.parseFloat(t?.toFixed?.(2) || t));
      const counts = new Map();
      for (const c of candidates) {
        const key = c.output || "<empty>";
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      const top = Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([k, v]) => `"${k.slice(0, 60).replace(/\s+/g, " ")}" x${v}`);
      console.log(
        `[Voting] ${step.id}: samples=${candidates.length}, unique=${counts.size}, k=${voteConfig.k}, leadBy=${leadBy}, winnerVotes=${winner?.voteCount || 0}, marginMet=${achievedMargin}, temps=[${temps.join(
          ", "
        )}], top=${top.join(" | ")}`
      );

      // Broadcast vote summary for UI transparency
      this.emitEvent({
        type: "vote-summary",
        taskId: task.id,
        projectId: task.projectId,
        featureId: task.featureId,
        stepId: step.id,
        samples: candidates.length,
        unique: counts.size,
        k: voteConfig.k,
        leadBy,
        winnerVotes: winner?.voteCount || 0,
        marginMet: achievedMargin,
        temps,
        top,
        winnerPreview: (winner?.output || "").slice(0, 200),
      });
    }

    if (!winner) {
      step.status = "failed";
      this.snapshotStore?.recordStepEnd(step.id, "failed", "no winner");
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

    let applyResult;
    try {
      applyResult = await this.applyWinner(step, winner.output, projectGuardOverride);
      // Basic sanity: ensure something changed when we wrote/edited
      if (
        applyResult &&
        applyResult.before !== undefined &&
        applyResult.after !== undefined &&
        applyResult.before === applyResult.after
      ) {
        throw new Error("Apply produced no changes (before and after identical)");
      }
    } catch (err) {
      step.status = "failed";
      this.snapshotStore?.recordStepEnd(step.id, "failed", err.message);
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
      return { winner, leadBy, applied: false, error: err.message };
    }
    if (applyResult?.kind === "actions") {
      this.snapshotStore?.recordActions(step.id, applyResult.actions, applyResult.results);
    }

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
    this.snapshotStore?.recordStepEnd(step.id, "completed", null);
    this.appendLog({
      taskId: task.id,
      stepId: step.id,
      event: "winner",
      leadBy,
      marginMet: achievedMargin || false,
      output: winner.output,
      applyResult,
      commandResult,
    });
    this.emitEvent({
      type: "step-completed",
      taskId: task.id,
      stepId: step.id,
      leadBy,
      marginMet: achievedMargin || false,
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
    if (!step.apply || !step.apply.type) {
      // Try structured actions first; fallback to state-only storage.
      const parsed = (() => {
        try {
          return parseActions(unwrapCodeFence(output));
        } catch (err) {
          // Treat schema errors as hard failures to avoid acting on malformed output
          throw err;
        }
      })();

      if (parsed) {
        const guard = projectGuardOverride || this.projectGuard;
        if (!guard) throw new Error("ProjectGuard not configured");
        const results = await executeActions({
          actions: parsed.actions,
          guard,
          commandRunner: this.commandRunner,
          eventEmitter: this.eventEmitter,
        });
        this.stateStore.updateSection("appliedOutputs", (prev = []) => [
          ...prev,
          { taskId: step.taskId, stepId: step.id, actions: parsed.actions, results },
        ]);
        return { kind: "actions", actions: parsed.actions, results };
      }

      this.stateStore.updateSection("appliedOutputs", (prev = []) => [
        ...prev,
        { taskId: step.taskId, stepId: step.id, output },
      ]);
      return { kind: "state-only" };
    }

    const guard = projectGuardOverride || this.projectGuard;

    const cleanedOutput = unwrapCodeFence(output);

    if (step.apply.type === "writeFile") {
      if (!guard) throw new Error("ProjectGuard not configured");
      return guard.writeFile(step.apply.path, cleanedOutput, { dryRun: step.apply.dryRun });
    }
    if (step.apply.type === "appendFile") {
      if (!guard) throw new Error("ProjectGuard not configured");
      const prev = await guard.readFile(step.apply.path).catch(() => "");
      const next = `${prev}${cleanedOutput}`;
      return guard.writeFile(step.apply.path, next, { dryRun: step.apply.dryRun });
    }
    if (step.apply.type === "editFile") {
      if (!guard) throw new Error("ProjectGuard not configured");
      let instructions = null;
      try {
        instructions = JSON.parse(unwrapCodeFence(output));
      } catch (err) {
        throw new Error(`Failed to parse edit instructions JSON: ${err.message}`);
      }
      // Patch is preferred; fall back to search/replace.
      if (instructions.patch) {
        const patch = instructions.patch;
        if (typeof patch !== "string" || !patch.includes("---") || !patch.includes("+++") || !patch.includes("@@")) {
          // Try a best-effort reconstruction even if patch headers look odd
          try {
            return await applyPatchAsNewFile(guard, step.apply.path, patch);
          } catch (err) {
            throw new Error("Invalid patch format for editFile");
          }
        }
        try {
          const result = await guard.applyPatch(step.apply.path, patch);
          return result;
        } catch (err) {
          // Fallback: try a simplified patch apply (context-based replace) before failing
          const simplified = await applySimplePatch(guard, step.apply.path, patch).catch(() => null);
          if (simplified) return simplified;
          const rebuilt = await applyPatchAsNewFile(guard, step.apply.path, patch).catch(() => null);
          if (rebuilt) return rebuilt;
          throw err;
        }
      }

      const { old_string: oldStr, new_string: newStr } = instructions || {};
      if (!oldStr || newStr === undefined) {
        throw new Error("Edit instructions must include either patch or old_string/new_string");
      }
      const before = await guard.readFile(step.apply.path).catch(() => {
        throw new Error(`File not found: ${step.apply.path}`);
      });
      const occurrences = oldStr.length ? before.split(oldStr).length - 1 : 0;
      if (occurrences === 0) {
        throw new Error("old_string not found in file; edit aborted to avoid corrupting file");
      }
      if (occurrences > 1) {
        throw new Error("old_string is not unique in file; include more context to make it unique");
      }
      const after = before.replace(oldStr, newStr);
      if (after === before) {
        throw new Error("Edit produced no changes; check old_string/new_string");
      }
      const result = await guard.writeFile(step.apply.path, after, { dryRun: step.apply.dryRun });

      // Post-verify: ensure new_string is present and old_string is gone
      if (!step.apply.dryRun) {
        const finalContent = await guard.readFile(step.apply.path);
        if (finalContent.includes(oldStr)) {
          throw new Error("Edit applied but old_string still present in file");
        }
        if (!finalContent.includes(newStr)) {
          throw new Error("Edit applied but new_string not found in file");
        }
      }

      return result;
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
    throw new Error(`Unknown apply type: ${step.apply?.type}`);
  }

  emitEvent(event) {
    if (this.eventEmitter && typeof this.eventEmitter.emit === "function") {
      this.eventEmitter.emit(event);
      // Also emit a user-facing terminal log for file writes/edits
      if (event.type === "step-completed" && event.applyResult?.path) {
        const model = event.voteModel || event.task?.voteModel || event.task?.model;
        this.eventEmitter.emit({
          type: "terminal-log",
          message: `[write] ${event.applyResult.type || "apply"} -> ${event.applyResult.path}${model ? ` (model=${model})` : ""}`
        });
      }
    }
  }
}

module.exports = { Orchestrator };
