/**
 * FeaturePlanner: Decomposes a feature into atomic subtasks.
 * Two-stage agent:
 *  1) Ask the model which files to inspect.
 *  2) Read those files and feed snippets + file tree into the planning prompt.
 */

/**
 * Build the system prompt for feature planning.
 * @param {Object} context
 * @returns {string}
 */
function buildPlannerPrompt(feature, context, fileSnippets = []) {
  const { projectMd, completedFeatures, fileTree, dependencies, richContext } = context;

  // Use rich context if available, otherwise fallback to legacy
  const guidelines = richContext?.guidelines || projectMd || "";
  const completed = richContext?.completedFeatures || completedFeatures || [];
  const files = richContext?.fileTree || fileTree || [];
  const deps = richContext?.dependencies || dependencies || [];

  let prompt = `You are a Senior Software Architect Agent. Your task is to decompose a feature into atomic, sequential subtasks.

## Project Guidelines
${guidelines || "No project guidelines available."}

## Current File Structure
${files.length > 0 ? files.slice(0, 200).join("\n") : "Empty project"}
${files.length > 200 ? `\n... and ${files.length - 200} more files` : ""}

## Previously Completed Features
${
  completed.length > 0
    ? completed.map((f) => `- **${f.name}** (Priority ${f.priority || "N/A"}): ${f.technicalSummary || "No summary"}\n  Files: ${f.files?.join(", ") || "N/A"}`).join("\n")
    : "No features completed yet."
}

## Dependencies (Already Completed)
${
  deps.length > 0
    ? deps.map((d) => `- ${d.name}: ${d.technicalSummary || "completed"}`).join("\n")
    : "No dependencies for this feature."
}

## Feature to Implement
**Name:** ${feature.name}
**Description:** ${feature.description || "No description"}
**Priority:** ${feature.priority}
**Definition of Done:** ${feature.dod || "Feature is fully implemented and working"}

## File Context (requested by planner)
${fileSnippets.length ? fileSnippets.join("\n\n") : "No additional file context provided."}

## Your Task
Decompose this feature into atomic subtasks. Each subtask should:
1. Do ONE thing only (single file creation/modification)
2. Be independently testable
3. Build on previous subtasks logically
4. Include clear, actionable intent

## Output Format
Return a JSON object with this exact structure:

\`\`\`json
{
  "subtasks": [
    {
      "intent": "Create the login form component with email and password fields",
      "apply": {
        "type": "writeFile",
        "path": "src/components/LoginForm.jsx"
      }
    },
    {
      "intent": "Add form validation logic using the existing validator utility",
      "apply": {
        "type": "writeFile",
        "path": "src/utils/loginValidator.js"
      }
    }
  ]
}
\`\`\`

## Apply Types
- \`writeFile\`: Create or replace a file completely
- \`appendFile\`: Add content to an existing file
- \`editFile\`: Make targeted edits to an existing file (for small changes)

## Guidelines
- Start with foundational work (types, interfaces, utilities)
- Then build components/modules
- End with integration and wiring
- Keep each subtask focused and minimal
- Use descriptive file paths based on the project structure
- Reference existing patterns from completed features

## Important for React/Web Projects
- If this is a React project foundation/setup feature, ALWAYS include:
  - package.json with all dependencies
  - public/index.html (required for React apps)
  - tailwind.config.js (if TailwindCSS is mentioned)
  - postcss.config.js (if TailwindCSS is mentioned)
  - src/index.js or src/index.jsx as entry point
  - src/index.css with Tailwind imports
  - Basic App.jsx component structure
- For create-react-app style projects, public/index.html must have a div with id="root"
- Include all configuration files needed to run the project

Generate the subtasks now:`;

  return prompt;
}

/**
 * Parse the planner response to extract subtasks.
 * @param {string} response
 * @returns {Array<Object>}
 */
function parseSubtasks(response) {
  // Try to extract JSON from response
  const jsonMatch = response.match(/```json\n?([\s\S]*?)```/);
  let jsonStr = jsonMatch ? jsonMatch[1] : response;

  // Clean up the JSON string
  jsonStr = jsonStr.trim();

  // Try to find JSON object if not in code block
  if (!jsonStr.startsWith("{")) {
    const objMatch = jsonStr.match(/\{[\s\S]*"subtasks"[\s\S]*\}/);
    if (objMatch) {
      jsonStr = objMatch[0];
    }
  }

  try {
    const parsed = JSON.parse(jsonStr);
    if (parsed.subtasks && Array.isArray(parsed.subtasks)) {
      return parsed.subtasks.map((st) => ({
        intent: st.intent || "Unknown intent",
        apply: {
          type: st.apply?.type || "writeFile",
          path: st.apply?.path || null,
        },
      }));
    }
  } catch (e) {
    console.error("[FeaturePlanner] Failed to parse JSON:", e.message);
  }

  // Fallback: create a single subtask
  return [
    {
      intent: `Implement feature: ${response.substring(0, 100)}...`,
      apply: {
        type: "writeFile",
        path: "src/feature-output.txt",
      },
    },
  ];
}

/**
 * Plan a feature into subtasks (agent-style: inspect files, then plan).
 * @param {Object} opts
 * @param {Object} opts.feature - The feature to plan
 * @param {Object} opts.project - The project
 * @param {Object} opts.context - Context (projectMd, featuresJson, completedFeatures)
 * @param {import('./llmRegistry').LLMRegistry} opts.llmRegistry
 * @param {string} opts.plannerModel - Name of the planner model to use
 * @param {Array<string>} [opts.fallbackModels]
 * @param {string|null} [opts.projectPath] - Absolute path to project root (for file reads)
 * @returns {Promise<Array<Object>>} Array of subtasks
 */
async function planFeature({
  feature,
  project,
  context,
  llmRegistry,
  plannerModel,
  configStore,
  fallbackModels = [],
  projectPath = null,
  onProgress = () => {},
}) {
  const { ProjectGuard } = require("./projectGuard");

  // Ensure provider is registered (dynamic registration for "provider:model" format)
  const ensureProvider = (modelStr) => {
    if (!modelStr || typeof modelStr !== "string") return null;
    if (!modelStr.includes(":")) return modelStr;
    const [providerType, modelName] = modelStr.split(":", 2);
    const providerKey = `${providerType}:${modelName}`;
    if (llmRegistry.has(providerKey)) return providerKey;

    // Register on-demand
    const { createProvider } = require("./providerFactory");
    const keys = configStore ? configStore.getKeys() : {};
    const apiKey = keys[providerType];
    const cfg = {
      name: providerKey,
      type: providerType,
      apiKey,
      model: modelName,
    };
    llmRegistry.register(providerKey, createProvider(cfg));
    console.log(`[FeaturePlanner] Auto-registered provider: ${providerKey}`);
    return providerKey;
  };

  const primaryModel = ensureProvider(plannerModel);
  const tryModels = Array.from(
    new Set([primaryModel, ...fallbackModels.map((m) => ensureProvider(m)).filter(Boolean)])
  ).filter(Boolean);

  console.log(`[FeaturePlanner] Planning feature: ${feature.name}`);
  console.log(`[FeaturePlanner] Using model(s): ${tryModels.join(", ")}`);
  onProgress(`planning: start (models=${tryModels.join(", ")})`);

  // ---- Stage 1: Iterative inspect/read (agent-like, up to MAX_ROUNDS) ----
  const MAX_ROUNDS = 5;
  const MAX_INSPECT_TOTAL = 20;
  const MAX_INSPECT_PER_ROUND = 8;
  const SNIPPET_LIMIT = 8000; // capture larger snippets when reading files
  const fileSnippets = [];
  const fileTree = context.richContext?.fileTree || context.fileTree || [];
  const inspected = new Set();
  const findMatchingFiles = (tree, keywords = [], limit = 8, skip = new Set()) => {
    const results = [];
    const seen = new Set();
    for (const term of keywords) {
      const lower = term.toLowerCase();
      for (const p of tree) {
        if (seen.has(p) || skip.has(p)) continue;
        if (p.toLowerCase().includes(lower)) {
          results.push(p);
          seen.add(p);
          if (results.length >= limit) return results;
        }
      }
    }
    return results;
  };

  if (projectPath && fileTree.length > 0 && primaryModel) {
    const guard = new ProjectGuard(projectPath);
    let rounds = 0;
    let done = false;

    while (!done && rounds < MAX_ROUNDS && fileSnippets.length < MAX_INSPECT_TOTAL) {
      rounds += 1;
      const remaining = MAX_INSPECT_TOTAL - inspected.size;
      const perRoundCap = Math.min(MAX_INSPECT_PER_ROUND, remaining);
      if (perRoundCap <= 0) break;

      const inspectedList = Array.from(inspected);
      const inspectPrompt = `You are a planning agent. Choose files to inspect and optional filename search terms. You can iterate up to ${MAX_ROUNDS} rounds; request "done": true when you have enough context.

## Feature
- Name: ${feature.name}
- Description: ${feature.description || "No description"}
- Priority: ${feature.priority}

## Already inspected (skip these)
${inspectedList.length ? inspectedList.join("\\n") : "(none)"}

## File Tree (truncated)
${fileTree.slice(0, 200).join("\n")}
${fileTree.length > 200 ? `...and ${fileTree.length - 200} more` : ""}

Rules:
- Only choose files that appear in the provided file tree.
- Focus on entrypoints, routing, API handlers, config, and any files likely impacted.
- If you have enough context, return {"inspect": [], "search": [], "done": true}.
- Limit inspect list to ${perRoundCap} this round.
- You may also provide "search" terms to find files by filename (case-insensitive contains match).

Return JSON only:
\`\`\`json
{ "inspect": ["src/index.js", "src/App.jsx"], "search": ["header", "nav"], "done": false }
\`\`\``;

      const inspectModels = [primaryModel];
      let inspectTargets = [];
      let searchTerms = [];
      let declaredDone = false;

      for (const model of inspectModels) {
        const provider = llmRegistry.get(model);
        if (!provider) continue;
        try {
          onProgress(`planning: inspect-request (round=${rounds}, model=${model})`);
          const resp = await provider.generate(inspectPrompt, { temperature: 0.2, maxTokens: 1600 });
          const match = resp.match(/```json\\s*([\\s\\S]*?)```/);
          const jsonStr = (match ? match[1] : resp || "").trim();
          const parsed = JSON.parse(jsonStr);
          const candidates = Array.isArray(parsed)
            ? parsed
            : Array.isArray(parsed.inspect)
            ? parsed.inspect
            : [];
          const searches = Array.isArray(parsed.search) ? parsed.search : [];
          searchTerms = searches
            .map((s) => (typeof s === "string" ? s.trim() : null))
            .filter(Boolean);
          inspectTargets = candidates
            .map((p) => (typeof p === "string" ? p.trim() : null))
            .filter(Boolean);
          declaredDone = !!parsed.done;
          onProgress(
            `planning: inspect-response (round=${rounds}, model=${model}, inspect=${inspectTargets.length}, search=${searchTerms.length}, done=${declaredDone})`
          );
          break;
        } catch (err) {
          console.warn(`[FeaturePlanner] Inspect stage failed on ${model}: ${err.message}`);
          onProgress(`planning: inspect-error (round=${rounds}, model=${model}, error=${err.message})`);
        }
      }

      // Deduplicate and only keep paths from fileTree, skipping already inspected
      const allowed = new Set(fileTree);
      const uniqueTargets = [];
      for (const p of inspectTargets) {
        if (allowed.has(p) && !inspected.has(p) && !uniqueTargets.includes(p) && uniqueTargets.length < perRoundCap) {
          uniqueTargets.push(p);
        }
      }

      // Augment with filename search (from "search" terms or feature keywords)
      const searchKeywords = [...searchTerms];
      if (searchKeywords.length === 0) {
        const inferred = `${feature.name} ${feature.description || ""}`
          .split(/[^a-zA-Z0-9]+/)
          .filter((t) => t && t.length > 3);
        searchKeywords.push(...inferred.slice(0, 4));
      }
      if (uniqueTargets.length < perRoundCap && searchKeywords.length > 0) {
        const matches = findMatchingFiles(fileTree, searchKeywords, perRoundCap - uniqueTargets.length, inspected);
        for (const p of matches) {
          if (!uniqueTargets.includes(p) && !inspected.has(p)) {
            uniqueTargets.push(p);
            if (uniqueTargets.length >= perRoundCap) break;
          }
        }
      }
      onProgress(`planning: reading ${uniqueTargets.length} file(s) (round=${rounds})`);

      // Read snippets for each target
      for (const relPath of uniqueTargets) {
        try {
          onProgress(`planning: read ${relPath}`);
          const content = await guard.readFile(relPath);
          const snippet = content.length > SNIPPET_LIMIT ? content.slice(0, SNIPPET_LIMIT) : content;
          fileSnippets.push(`### ${relPath}\n\`\`\`\n${snippet}\n\`\`\``);
          inspected.add(relPath);
        } catch (err) {
          console.warn(`[FeaturePlanner] Could not read ${relPath}: ${err.message}`);
          onProgress(`planning: read-failed ${relPath} (${err.message})`);
        }
      }

      if (fileSnippets.length > 0) {
        console.log(`[FeaturePlanner] Collected ${fileSnippets.length} file snippet(s) for planning.`);
        onProgress(`planning: collected ${fileSnippets.length} snippet(s)`);
      }

      if (declaredDone || uniqueTargets.length === 0) {
        done = true;
      }
    }
  }

  // ---- Stage 2: Plan subtasks with gathered context ----
  const prompt = buildPlannerPrompt(feature, context, fileSnippets);
  let bestSubtasks = null;
  let lastError = null;

  for (const m of tryModels) {
    try {
      const provider = llmRegistry.get(m);
      if (!provider) {
        lastError = new Error(`Planner model not found: ${m}`);
        continue;
      }

      onProgress(`planning: generate subtasks (model=${m})`);
      const response = await provider.generate(prompt, {
        temperature: 0.3,
        maxTokens: 12000,
      });

      if (!response || !response.trim()) {
        lastError = new Error(`Empty response from model ${m}`);
        continue;
      }

      const subtasks = parseSubtasks(response);
      const looksFallback =
        subtasks.length === 1 &&
        (subtasks[0].intent?.startsWith("Implement feature:") ||
          subtasks[0].apply?.path === "src/feature-output.txt");

      console.log(
        `[FeaturePlanner] Model ${m} produced ${subtasks.length} subtasks${looksFallback ? " (fallback-like)" : ""}`
      );
      onProgress(`planning: model ${m} produced ${subtasks.length} subtasks${looksFallback ? " (fallback)" : ""}`);

      // Prefer non-fallback results with more than 1 subtask
      if (!looksFallback && subtasks.length > 1) {
        bestSubtasks = subtasks;
        break;
      }

      // Keep best candidate so far
      bestSubtasks = bestSubtasks || subtasks;
    } catch (err) {
      lastError = err;
      console.error(`[FeaturePlanner] Error with model ${m}:`, err.message);
      onProgress(`planning: error (model=${m}, error=${err.message})`);
    }
  }

  const finalSubtasks =
    bestSubtasks && bestSubtasks.length > 0
      ? bestSubtasks
      : [{ intent: `Implement feature: ${feature.name}`, apply: { type: "writeFile", path: "src/feature-output.txt" } }];

  // Validate subtasks
  const validatedSubtasks = finalSubtasks.map((st, idx) => {
    return {
      intent: st.intent || `Subtask ${idx + 1}`,
      apply: {
        type: st.apply?.type || "writeFile",
        path: st.apply?.path || `src/subtask-${idx + 1}-output.txt`,
      },
    };
  });

  if (!bestSubtasks && lastError) {
    console.warn("[FeaturePlanner] Falling back to minimal subtasks due to errors:", lastError.message);
    onProgress(`planning: fallback subtasks (error=${lastError.message})`);
  } else {
    onProgress(`planning: finished with ${validatedSubtasks.length} subtasks`);
  }

  return validatedSubtasks;
}

/**
 * Add a subtask to an existing feature (for chat-based additions).
 * @param {Object} opts
 * @param {Object} opts.feature - The feature
 * @param {string} opts.requirement - The new requirement from user
 * @param {Object} opts.context - Context
 * @param {import('./llmRegistry').LLMRegistry} opts.llmRegistry
 * @param {string} opts.plannerModel
 * @returns {Promise<Array<Object>>} New subtasks to add
 */
async function addSubtasksFromRequirement({ feature, requirement, existingSubtasks, context, llmRegistry, plannerModel, configStore }) {
  // Ensure provider is registered (same logic as planFeature)
  const ensureProvider = (modelStr) => {
    if (!modelStr.includes(':')) {
      return modelStr;
    }
    const [providerType, modelName] = modelStr.split(':', 2);
    const providerKey = `${providerType}:${modelName}`;
    if (llmRegistry.has(providerKey)) return providerKey;

    const { createProvider } = require('./providerFactory');
    const keys = configStore ? configStore.getKeys() : {};
    const apiKey = keys[providerType];
    const cfg = {
      name: providerKey,
      type: providerType,
      apiKey,
      model: modelName,
    };
    llmRegistry.register(providerKey, createProvider(cfg));
    console.log(`[FeaturePlanner] Auto-registered provider: ${providerKey}`);
    return providerKey;
  };

  const modelToUse = ensureProvider(plannerModel);

  const provider = llmRegistry.get(modelToUse);
  if (!provider) {
    throw new Error(`Planner model not found: ${modelToUse}`);
  }

  const existingSubtasksText = existingSubtasks
    .map((st, idx) => `${idx + 1}. ${st.intent} (${st.status})`)
    .join("\n");

  const prompt = `You are a Senior Software Architect Agent. You need to add new subtasks to an existing feature based on a new requirement.

## Feature
**Name:** ${feature.name}
**Description:** ${feature.description || "No description"}

## Existing Subtasks
${existingSubtasksText || "No existing subtasks"}

## New Requirement
${requirement}

## Project Guidelines
${context.richContext?.guidelines || context.projectMd || "No project guidelines available."}

## Current File Structure
${
  (context.richContext?.fileTree || context.fileTree || []).length > 0
    ? (context.richContext?.fileTree || context.fileTree || []).slice(0, 20).join("\n")
    : "Empty project"
}

## Your Task
Generate ONLY the new subtasks needed to fulfill this requirement. Don't duplicate existing subtasks.

Return a JSON object:
\`\`\`json
{
  "subtasks": [
    {
      "intent": "Clear description of what to do",
      "apply": {
        "type": "writeFile",
        "path": "src/path/to/file.js"
      }
    }
  ]
}
\`\`\`

Generate only the NEW subtasks:`;

  const response = await provider.generate(prompt, {
    temperature: 0.3,
    maxTokens: 1000,
  });

  return parseSubtasks(response);
}

module.exports = {
  planFeature,
  addSubtasksFromRequirement,
  buildPlannerPrompt,
  parseSubtasks,
};
