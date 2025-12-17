/**
 * FeaturePlanner: Decomposes a feature into atomic subtasks.
 * Uses the project context (project.md, features.json) to generate subtasks.
 */

/**
 * Build the system prompt for feature planning.
 * @param {Object} context
 * @returns {string}
 */
function buildPlannerPrompt(feature, context) {
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
${files.length > 0 ? files.slice(0, 30).join("\n") : "Empty project"}
${files.length > 30 ? `\n... and ${files.length - 30} more files` : ""}

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
 * Plan a feature into subtasks.
 * @param {Object} opts
 * @param {Object} opts.feature - The feature to plan
 * @param {Object} opts.project - The project
 * @param {Object} opts.context - Context (projectMd, featuresJson, completedFeatures)
 * @param {import('./llmRegistry').LLMRegistry} opts.llmRegistry
 * @param {string} opts.plannerModel - Name of the planner model to use
 * @returns {Promise<Array<Object>>} Array of subtasks
 */
async function planFeature({ feature, project, context, llmRegistry, plannerModel }) {
  // Get the planner provider
  const provider = llmRegistry.get(plannerModel);
  if (!provider) {
    throw new Error(`Planner model not found: ${plannerModel}`);
  }

  // Build the prompt
  const prompt = buildPlannerPrompt(feature, context);

  console.log(`[FeaturePlanner] Planning feature: ${feature.name}`);
  console.log(`[FeaturePlanner] Using model: ${plannerModel}`);

  // Generate the plan
  const response = await provider.generate(prompt, {
    temperature: 0.3,
    maxTokens: 2000,
  });

  // Parse subtasks
  const subtasks = parseSubtasks(response);

  console.log(`[FeaturePlanner] Generated ${subtasks.length} subtasks`);

  // Validate subtasks
  const validatedSubtasks = subtasks.map((st, idx) => {
    // Ensure each subtask has required fields
    return {
      intent: st.intent || `Subtask ${idx + 1}`,
      apply: {
        type: st.apply?.type || "writeFile",
        path: st.apply?.path || `src/subtask-${idx + 1}-output.txt`,
      },
    };
  });

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
async function addSubtasksFromRequirement({ feature, requirement, existingSubtasks, context, llmRegistry, plannerModel }) {
  const provider = llmRegistry.get(plannerModel);
  if (!provider) {
    throw new Error(`Planner model not found: ${plannerModel}`);
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
