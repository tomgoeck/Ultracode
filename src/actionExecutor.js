const assert = require("assert");

const ALLOWED_TYPES = new Set([
  "write_file",
  "append_file",
  "apply_patch",
  "replace_range",
  "run_cmd",
  "request_info",
]);

function unwrapCodeFence(text) {
  if (!text || typeof text !== "string") return text;
  const m = text.trim().match(/^```[a-zA-Z0-9]*\s*\n([\s\S]*?)\n```$/);
  return m ? m[1] : text;
}

/**
 * Parse and basic-validate an action payload from model output.
 * @param {string} output
 * @returns {{actions: any[]}}
 */
function parseActions(output) {
  if (!output || typeof output !== "string") return null;
  const trimmed = unwrapCodeFence(output.trim());
  if (!trimmed.startsWith("{")) return null;
  let parsed = null;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("Invalid JSON output (expected actions object)");
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.actions)) {
    throw new Error("Actions payload must be { actions: [...] }");
  }
  parsed.actions.forEach((a, idx) => {
    if (!a || typeof a !== "object") throw new Error(`Action ${idx} must be an object`);
    if (!ALLOWED_TYPES.has(a.type)) throw new Error(`Unsupported action type: ${a.type}`);
  });
  return parsed;
}

/**
 * Execute parsed actions with guards.
 * @param {{ actions: any[], guard: any, commandRunner: any, eventEmitter?: any }} params
 */
async function executeActions({ actions, guard, commandRunner, eventEmitter }) {
  assert(guard, "ProjectGuard required");
  const results = [];

  for (const action of actions) {
    switch (action.type) {
      case "write_file": {
        if (!action.path || typeof action.content !== "string") {
          throw new Error("write_file requires path and content");
        }
        const res = await guard.writeFile(action.path, action.content, { dryRun: !!action.dryRun });
        results.push({ type: "write_file", path: action.path, ...res });
        break;
      }
      case "append_file": {
        if (!action.path || typeof action.content !== "string") {
          throw new Error("append_file requires path and content");
        }
        const prev = await guard.readFile(action.path).catch(() => "");
        const next = `${prev}${action.content}`;
        const res = await guard.writeFile(action.path, next, { dryRun: !!action.dryRun });
        results.push({ type: "append_file", path: action.path, ...res });
        break;
      }
      case "apply_patch": {
        if (!action.path || typeof action.patch !== "string") {
          throw new Error("apply_patch requires path and patch");
        }
        const res = await guard.applyPatch(action.path, action.patch);
        results.push({ type: "apply_patch", path: action.path, ...res });
        break;
      }
      case "replace_range": {
        const { path, start_line, end_line, new_text } = action;
        if (!path || typeof start_line !== "number" || typeof end_line !== "number" || typeof new_text !== "string") {
          throw new Error("replace_range requires path, start_line, end_line, new_text");
        }
        const res = await guard.replaceRange(path, start_line, end_line, new_text);
        results.push({ type: "replace_range", path, ...res });
        break;
      }
      case "run_cmd": {
        if (!action.cmd) throw new Error("run_cmd requires cmd");
        const runResult = await commandRunner.run(action.cmd, {
          force: !!action.allow_if_risky,
          cwd: action.cwd || guard.root,
          onData: (chunk) => {
            if (eventEmitter) {
              eventEmitter.emit({
                type: "command-output",
                data: chunk,
              });
            }
          },
        });
        results.push({ type: "run_cmd", cmd: action.cmd, result: runResult });
        break;
      }
      case "request_info": {
        results.push({ type: "request_info", question: action.question || "" });
        break;
      }
      default:
        throw new Error(`Unsupported action type: ${action.type}`);
    }
  }

  return results;
}

module.exports = { parseActions, executeActions };
