const { v4: uuidv4 } = require("crypto");

/**
 * Dynamically plans a task using the agent model to decompose the goal into atomic steps.
 * @param {object} ctx
 * @param {string} ctx.id
 * @param {string} ctx.title
 * @param {string} ctx.goal
 * @param {string} ctx.model
 * @param {string} ctx.voteModel
 * @param {string} [ctx.planningModel] - optional model for planning (defaults to ctx.model)
 * @param {any} ctx.llmRegistry - access to the LLM to generate the plan
 */
async function createPlan({ id, title, goal, model, voteModel, planningModel, llmRegistry, k, nSamples, initialSamples, temperature, redFlags }) {
  const plannerModel = planningModel || model;
  const provider = llmRegistry.get(plannerModel);
  if (!provider) {
    throw new Error(`Model ${plannerModel} not found`);
  }
  const defaultK = k || 2;
  const defaultMaxSamples = nSamples || 12; // nSamples acts as cap now
  const defaultInitialSamples = initialSamples || 2;

  // System prompt for the planner
  const prompt = `
You are a Senior Architect Agent specialized in decomposing coding tasks.
Goal: "${goal}"
Project Title: "${title}"

# Pre-Planning Analysis

BEFORE creating steps, analyze the project context:
1. **Existing Structure:** What files and directories already exist? Look for established patterns and naming conventions.
2. **Frameworks/Libraries:** What technology stack is in use? Check for package.json, requirements.txt, or similar config files.
3. **Project Layout:** Is there a src/, lib/, tests/ structure? What's the organizational pattern?
4. **Coding Style:** What language features are used? TypeScript vs JSDoc vs plain JS? Module system (ES6, CommonJS, etc.)?

Use this analysis to ensure each step's 'intent' guides the agent to:
- Analyze existing code patterns FIRST before generating new code
- Match established conventions (naming, structure, style)
- Generate idiomatic code that fits naturally into the existing codebase

# Task

Decompose the goal into a series of ATOMIC, sequential steps for a coding agent.
Each step must be self-contained and verifiable.
The agent operates in a loop: State -> Action -> New State.

Return a JSON object with this structure:
{
  "steps": [
    {
      "intent": "Exact instruction for the sub-agent (e.g. 'Create file src/index.js with basic express server')",
      "vote": true (boolean, set to true for code generation or complex logic),
      "redFlags": ["list", "of", "conditions", "to", "avoid"],
      "apply": {
        "type": "writeFile" | "appendFile",
        "path": "path/to/file.js",
        "dryRun": false (optional for writeFile)
      }
    }
  ]
}

Rules for 'apply':
1. For file creation or full content replacement, use apply: { "type": "writeFile", "path": "filename.ext" }.
   - The 'intent' MUST instruct the agent to generate the COMPLETE FILE CONTENT (e.g., "Generate complete HTML file for homepage")
   - The agent will produce the actual file content, NOT shell commands, NOT file paths
   - Example: intent="Create index.html with basic structure", apply={type:"writeFile", path:"index.html"}
   - Directories are created AUTOMATICALLY - you only specify FILES
2. For appending content to an existing file, use apply: { "type": "appendFile", "path": "filename.ext" }.
   - The agent will generate ONLY the content to append
3. NEVER create steps to "create folders" or "initialize directories" - folders are created automatically when files are written
4. NEVER use apply types other than "writeFile" or "appendFile" - NO "verify", "command", or custom types
5. NEVER instruct the agent to generate shell commands like "mkdir", "touch", "npm install" - those are execution commands, not file content
6. If 'apply' is missing, the agent's output will only be stored in the state.
7. The 'path' in 'apply' must be relative to the project root and MUST include a file extension (e.g., 'index.html', 'src/main.js', 'README.md', 'css/styles.css').

Rules:
1. Start with a plan/summary step if complex.
2. Break file creation and modification into separate steps if large.
3. Ensure the last step verifies or provides instructions on how to run.
4. Output ONLY valid JSON.

# Intent Quality Guidelines

Each step's 'intent' should provide context-aware guidance. Examples:

GOOD Intents (context-aware):
- "Create user.service.js following the existing service pattern in src/services/ with CRUD operations"
- "Generate complete package.json with dependencies matching the Node.js/Express stack"
- "Add authentication middleware to server.js following the existing middleware pattern"

BAD Intents (generic):
- "Create user service file" (no context, no location guidance)
- "Make a package.json" (no stack context)
- "Add auth" (unclear where, unclear pattern)
`;

  console.log(`[Planner] Generating plan for: ${title} (planner=${plannerModel})`);
  const response = await provider.generate(prompt, { maxTokens: 2048, temperature: 0.3 });
  console.log(`[Planner] Response length: ${response?.length || 0} chars`);

  let planData;
  try {
    // Basic cleanup for markdown code blocks (response is the text content string)
    const cleanJson = response.replace(/```json/g, "").replace(/```/g, "").trim();
    planData = JSON.parse(cleanJson);
    console.log(`[Planner] Successfully parsed plan with ${planData.steps?.length || 0} steps`);
  } catch (err) {
    console.error("Failed to parse plan JSON. Error:", err.message);
    console.error("Response preview:", response?.substring(0, 200));
    // Fallback simple plan
    planData = {
        steps: [
            { intent: `Execute the goal: ${goal}`, vote: true, redFlags: ["error", "fail"], apply: { type: "writeFile", path: "fallback-output.log" } }
        ]
    };
    console.log("[Planner] Using fallback plan");
  }

  // Map to internal Step structure
  const steps = planData.steps.map((s, idx) => ({
    id: `${id}-step-${idx + 1}`,
    taskId: id,
    intent: s.intent,
    stateRefs: ["workspace"], // default
    status: "pending",
    candidates: [],
    redFlags: s.redFlags && s.redFlags.length ? s.redFlags.map(r => ({ pattern: r })) : [],
    k: s.vote ? defaultK : 1, // Default voting config
    initialSamples: s.vote ? defaultInitialSamples : 1,
    maxSamples: s.vote ? defaultMaxSamples : 1,
    nSamples: s.vote ? defaultMaxSamples : 1, // legacy alias for UI/state
    voteModel: voteModel || model, // use specific vote model if provided
    apply: s.apply || undefined, // Pass through the apply object
  }));

  return {
    id,
    title,
    goal,
    model,
    voteModel,
    planningModel: plannerModel,
    k: defaultK,
    initialSamples: defaultInitialSamples,
    maxSamples: defaultMaxSamples,
    nSamples: defaultMaxSamples,
    temperature: temperature !== undefined ? temperature : undefined,
    redFlags: redFlags || [],
    steps
  };
}

module.exports = { createPlan };
