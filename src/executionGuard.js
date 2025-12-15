const { exec } = require("child_process");

// Guards terminal execution with severity-based approvals.
class CommandRunner {
  /**
   * @param {{ safetyMode?: "auto"|"ask", policies?: Record<string, import("./types").CommandPolicy>, allowlist?: string[], denylist?: string[] }} [options]
   */
  constructor(options = {}) {
    this.safetyMode = options.safetyMode || "ask";
    this.policies = options.policies || {};
    this.allowlist = options.allowlist || [];
    this.denylist = options.denylist || [];
  }

  setSafetyMode(mode) {
    this.safetyMode = mode;
  }

  setLists({ allowlist = [], denylist = [] }) {
    this.allowlist = allowlist;
    this.denylist = denylist;
  }

  classify(command) {
    if (this.policies[command]) return this.policies[command];
    const lower = command.toLowerCase();
    if (this.denylist.some((pattern) => lower.includes(pattern.toLowerCase()))) {
      return { severity: "high", blocked: true };
    }
    if (this.allowlist.some((pattern) => lower.includes(pattern.toLowerCase()))) {
      return { severity: "low" };
    }
    if (lower.includes("rm ") || lower.includes("sudo") || lower.includes("drop database")) {
      return { severity: "high" };
    }
    if (lower.startsWith("curl") || lower.startsWith("wget") || lower.includes("http")) {
      return { severity: "med", allowNetwork: true };
    }
    return { severity: "low" };
  }

  /**
   * @returns {Promise<{status:"executed"|"needs-approval"|"blocked", severity:string, output?:string, error?:string, id?:string, command?:string}>}
   */
  run(command, options = {}) {
    const policy = this.classify(command);
    if (policy.blocked) {
      return Promise.resolve({ status: "blocked", severity: policy.severity, command });
    }
    const needsApproval = this.safetyMode === "ask" && policy.severity !== "low" && !options.force;
    if (needsApproval) {
      const id = `cmd-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
      return Promise.resolve({ status: "needs-approval", severity: policy.severity, id, command });
    }

    if (options.onData || options.stream) {
      return this.spawnStream(command, policy, options);
    }

    return new Promise((resolve) => {
      exec(command, (err, stdout, stderr) => {
        if (err) {
          resolve({ status: "executed", severity: policy.severity, error: stderr || err.message });
        } else {
          resolve({ status: "executed", severity: policy.severity, output: stdout });
        }
      });
    });
  }

  spawnStream(command, policy, options) {
    return new Promise((resolve) => {
      const child = exec(command);
      child.stdout?.on("data", (chunk) => options.onData && options.onData(chunk.toString()));
      child.stderr?.on("data", (chunk) => options.onData && options.onData(chunk.toString()));
      child.on("close", (code) => {
        resolve({
          status: "executed",
          severity: policy.severity,
          output: options.collectOutput ? undefined : undefined,
          error: code === 0 ? undefined : `exit ${code}`,
        });
      });
    });
  }
}

module.exports = { CommandRunner };
