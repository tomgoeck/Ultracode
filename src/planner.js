const { v4: uuidv4 } = require("crypto");

/**
 * Dynamically plans a task using the agent model to decompose the goal into atomic steps.
 * @param {object} ctx
 * @param {string} ctx.id
 * @param {string} ctx.title
 * @param {string} ctx.goal
 * @param {string} ctx.model
 * @param {string} ctx.voteModel
 * @param {any} ctx.llmRegistry - access to the LLM to generate the plan
 */
async function createPlan({ id, title, goal, model, voteModel, llmRegistry, k, nSamples, temperature, redFlags }) {
  const provider = llmRegistry.get(model);
  if (!provider) {
    throw new Error(`Model ${model} not found`);
  }

  // System prompt for the planner
  const prompt = `
You are a Senior Architect Agent.
Goal: "${goal}"
Project Title: "${title}"

Your task is to decompose this goal into a series of ATOMIC, sequential steps for a coding agent.
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
1. For file creation or full content replacement, use apply: { "type": "writeFile", "path": "filename.ext" }. The agent will be instructed to generate the *full file content*.
2. For appending content to an existing file, use apply: { "type": "appendFile", "path": "filename.ext" }. The agent will be instructed to generate *only the content to append*.
3. If 'apply' is missing, the agent's output will only be stored in the state.
4. The 'intent' should clearly describe what the sub-agent should produce for the 'apply' action.
5. The 'path' in 'apply' must be relative to the project root (e.g., 'index.html', 'src/main.js').

Rules:
1. Start with a plan/summary step if complex.
2. Break file creation and modification into separate steps if large.
3. Ensure the last step verifies or provides instructions on how to run.
4. Output ONLY valid JSON.
`;

  console.log(`[Planner] Generating plan for: ${title}`);
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
    k: s.vote ? 2 : 1, // Default voting config
    nSamples: s.vote ? 3 : 1,
    voteModel: voteModel || model, // use specific vote model if provided
    apply: s.apply || undefined, // Pass through the apply object
  }));

  return {
    id,
    title,
    goal,
    model,
    voteModel,
    k: k || 2,
    nSamples: nSamples || 3,
    temperature: temperature !== undefined ? temperature : 0.2,
    redFlags: redFlags || [],
    steps
  };
}

module.exports = { createPlan };