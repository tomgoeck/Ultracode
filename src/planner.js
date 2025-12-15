// Planner stub: creates a multi-step plan (analyze, backend, frontend, README) using MAD pattern.
function planTask({ id, title, goal, model, voteModel, filePath }) {
  const backendPath = filePath || "backend/api.js";
  const frontendPath = deriveFrontendPath(filePath);
  const readmePath = "README.generated.md";
  return {
    id,
    title,
    goal,
    risk: "low",
    model,
    voteModel,
    k: 2,
    nSamples: 3,
    redFlags: [{ maxChars: 2048 }],
    steps: [
      {
        id: `${id}-plan`,
        taskId: id,
        intent: `Summarize the goal and propose a 4-6 step micro-plan to achieve: ${goal}. Output plain text plan.`,
        stateRefs: ["workspace", "projectRoot"],
        status: "pending",
        candidates: [],
        redFlags: [{ maxChars: 400 }],
        k: 2,
        nSamples: 3,
        voteModel,
        apply: { type: "statePatch", stateKey: "planNotes" },
      },
      {
        id: `${id}-backend`,
        taskId: id,
        intent: `Using planNotes, generate a minimal backend/api stub (Express-like pseudo-code or fetch handler) fulfilling: ${goal}. Output the full file content for ${backendPath}.`,
        stateRefs: ["planNotes"],
        status: "pending",
        candidates: [],
        redFlags: [{ maxChars: 4000 }],
        k: 2,
        nSamples: 3,
        voteModel,
        apply: { type: "writeFile", path: backendPath, dryRun: false },
      },
      {
        id: `${id}-frontend`,
        taskId: id,
        intent: `Create a single-page HTML/CSS front-end for the goal: ${goal}. Include hero, features, CTA. Output full HTML for ${frontendPath}.`,
        stateRefs: ["planNotes"],
        status: "pending",
        candidates: [],
        redFlags: [{ maxChars: 8000 }],
        k: 2,
        nSamples: 3,
        voteModel,
        apply: { type: "writeFile", path: frontendPath, dryRun: false },
      },
      {
        id: `${id}-readme`,
        taskId: id,
        intent: `Draft README section describing the goal, how to run the frontend/backend, and next steps. Output Markdown for ${readmePath}.`,
        stateRefs: ["planNotes"],
        status: "pending",
        candidates: [],
        redFlags: [{ maxChars: 2000 }],
        k: 2,
        nSamples: 3,
        voteModel,
        apply: { type: "writeFile", path: readmePath, dryRun: false },
      },
    ],
  };
}

function deriveFrontendPath(filePath) {
  if (!filePath) return "frontend/index.html";
  if (filePath.endsWith(".html")) return filePath;
  if (filePath.includes("/")) {
    const parts = filePath.split("/");
    parts[parts.length - 1] = "index.html";
    return parts.join("/");
  }
  return "frontend/index.html";
}

module.exports = { planTask };
