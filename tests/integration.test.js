const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

// Import core modules
const { LLMRegistry } = require("../src/llmRegistry");
const { StateStore } = require("../src/stateStore");
const { CommandRunner } = require("../src/executionGuard");
const { Orchestrator } = require("../src/orchestrator");
const { ProjectGuard } = require("../src/projectGuard");
const { VotingEngine } = require("../src/votingEngine");
const { RedFlagger } = require("../src/redFlagger");
const { PromptParaphraser } = require("../src/promptParaphraser");
const { ResourceMonitor } = require("../src/resourceMonitor");
const { createPlan } = require("../src/planner");

// Create test workspace
const TEST_WORKSPACE = path.join(process.cwd(), "workspaces", "test-workspace");

// Helper to clean test workspace
function cleanTestWorkspace() {
  if (fs.existsSync(TEST_WORKSPACE)) {
    fs.rmSync(TEST_WORKSPACE, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_WORKSPACE, { recursive: true });
}

// Helper to create echo provider (stub for testing)
class EchoProvider {
  constructor() {
    this.name = "echo-test";
    this.model = "echo-test";
    this.callCount = 0;
  }

  async generate(prompt, options = {}) {
    this.callCount++;
    // Simulate response based on task
    if (prompt.includes("Write")) {
      return "Hello, World! This is a test file.";
    }
    if (prompt.includes("greeting")) {
      return "Greetings from the MAKER system!";
    }
    if (prompt.includes("Rephrase") || prompt.includes("rephrase")) {
      // Paraphrasing request - vary the response
      return prompt.replace(/Rephrase|rephrase/g, "Reformulate");
    }
    return `Echo: ${prompt.slice(0, 50)}... (call #${this.callCount})`;
  }

  async listModels() {
    return ["echo-test"];
  }
}

test("Integration Test Suite", async (t) => {
  // Setup
  cleanTestWorkspace();

  await t.test("File Creation Test", async () => {
    // Create LLM registry with echo provider
    const llms = new LLMRegistry();
    llms.register("echo-test", new EchoProvider());

    const stateStore = new StateStore({
      projectRoot: TEST_WORKSPACE,
      files: {},
    });

    const commandRunner = new CommandRunner({ safetyMode: "auto" });
    const projectGuard = new ProjectGuard(TEST_WORKSPACE);
    const resourceMonitor = new ResourceMonitor();
    const votingEngine = new VotingEngine({
      redFlagger: new RedFlagger(),
      resourceMonitor,
    });

    const orchestrator = new Orchestrator({
      llmRegistry: llms,
      stateStore,
      commandRunner,
      projectGuard,
      votingEngine,
    });

    // Create a simple task
    const task = {
      id: "test-task-1",
      title: "Write test file",
      goal: "Write 'Hello, World!' to test.txt",
      model: "echo-test",
      k: 1, // Single vote needed
      nSamples: 1, // One sample
      redFlags: [],
      steps: [
        {
          id: "test-step-1",
          taskId: "test-task-1",
          intent: "Write 'Hello, World!' to test.txt",
          stateRefs: [],
          status: "pending",
          k: 1,
          nSamples: 1,
          redFlags: [],
          apply: {
            type: "writeFile",
            path: "test.txt",
          },
        },
      ],
    };

    // Execute step
    const result = await orchestrator.runStep(task, task.steps[0], projectGuard);

    // Verify file was created
    const testFilePath = path.join(TEST_WORKSPACE, "test.txt");
    assert.ok(fs.existsSync(testFilePath), "test.txt should exist");

    // Verify content
    const content = fs.readFileSync(testFilePath, "utf8");
    assert.ok(content.length > 0, "File should have content");
    assert.ok(content.includes("Hello, World!"), "File should contain greeting");

    // Verify result
    assert.ok(result.winner, "Should have a winner");
    assert.ok(result.applied, "Winner should be applied");

    console.log("✅ File Creation Test passed");
  });

  await t.test("Voting Test", async () => {
    // Create a varying echo provider for voting test
    class VaryingEchoProvider {
      constructor() {
        this.name = "varying-echo";
        this.model = "varying-echo";
        this.callCount = 0;
      }

      async generate(prompt) {
        this.callCount++;
        // Return different outputs to test voting
        return `Response variant ${this.callCount}: ${prompt.slice(0, 20)}`;
      }

      async listModels() {
        return ["varying-echo"];
      }
    }

    const llms = new LLMRegistry();
    llms.register("varying-echo", new VaryingEchoProvider());

    const resourceMonitor = new ResourceMonitor();
    const votingEngine = new VotingEngine({
      redFlagger: new RedFlagger(),
      resourceMonitor,
    });

    const provider = llms.get("varying-echo");
    const result = await votingEngine.run({
      provider,
      prompt: "Write a greeting",
      k: 1, // Lower k since responses will be different
      nSamples: 3,
      redFlagRules: [],
      taskId: "test-voting",
      stepId: "step-1",
    });

    // Verify voting results
    assert.ok(result.candidates.length >= 1, "Should have at least 1 candidate");
    assert.ok(result.winner, "Should have a winner");
    assert.ok(result.leadBy >= 0, "Should have lead margin");

    // Verify resource tracking
    const metrics = resourceMonitor.getTaskMetrics("test-voting");
    assert.ok(metrics, "Should have metrics");
    assert.ok(metrics.totalTokens > 0, "Should have token count");
    assert.ok(metrics.steps.length > 0, "Should have step metrics");

    console.log("✅ Voting Test passed");
  });

  await t.test("Red-Flag Test", async () => {
    const redFlagger = new RedFlagger();

    // Test maxChars
    const longText = "x".repeat(5000);
    const flags = redFlagger.evaluate(longText, [{ maxChars: 4000 }]);
    assert.ok(flags.length > 0, "Should red-flag long text");
    assert.ok(flags[0].includes("too-long"), "Should specify too-long error");

    // Test JSON validation
    const invalidJSON = "{ this is not json }";
    const jsonFlags = redFlagger.evaluate(invalidJSON, [{ requireJson: true }]);
    assert.ok(jsonFlags.length > 0, "Should red-flag invalid JSON");
    assert.ok(jsonFlags.includes("invalid-json"), "Should specify invalid-json error");

    // Test valid JSON
    const validJSON = '{"valid": true}';
    const validFlags = redFlagger.evaluate(validJSON, [{ requireJson: true }]);
    assert.strictEqual(validFlags.length, 0, "Should not red-flag valid JSON");

    console.log("✅ Red-Flag Test passed");
  });

  await t.test("Resource Monitoring Test", async () => {
    const resourceMonitor = new ResourceMonitor();

    // Record some calls
    resourceMonitor.recordPromptCall(
      "task-1",
      "step-1",
      "gpt-4o-mini",
      "Test prompt " + "x".repeat(100),
      "Test output " + "x".repeat(200)
    );

    resourceMonitor.recordPromptCall(
      "task-1",
      "step-2",
      "gpt-4o-mini",
      "Another prompt",
      "Another output"
    );

    // Check metrics
    const metrics = resourceMonitor.getTaskMetrics("task-1");
    assert.ok(metrics, "Should have metrics");
    assert.strictEqual(metrics.steps.length, 2, "Should have 2 steps");
    assert.ok(metrics.totalTokens > 0, "Should have total tokens");
    assert.ok(metrics.totalCost > 0, "Should have cost estimate");

    // Check summary
    const summary = resourceMonitor.getSummary();
    assert.strictEqual(summary.taskCount, 1, "Should have 1 task");
    assert.ok(summary.totalTokens > 0, "Summary should have tokens");

    console.log("✅ Resource Monitoring Test passed");
  });

  await t.test("ProjectGuard Path Traversal Test", async () => {
    const projectGuard = new ProjectGuard(TEST_WORKSPACE);

    // Test safe path
    const safePath = "safe/file.txt";
    const resolved = projectGuard.resolveSafe(safePath);
    assert.ok(resolved.startsWith(TEST_WORKSPACE), "Safe path should be in workspace");

    // Test path traversal attempt
    const maliciousPath = "../../../etc/passwd";
    assert.throws(
      () => projectGuard.resolveSafe(maliciousPath),
      /Path escapes project root/,
      "Should reject path traversal"
    );

    console.log("✅ ProjectGuard Path Traversal Test passed");
  });

  await t.test("Prompt Paraphrasing Test", async () => {
    const llms = new LLMRegistry();
    llms.register("echo-test", new EchoProvider());

    const paraphraser = new PromptParaphraser(llms, "echo-test");

    const originalPrompt = "Rephrase this instruction carefully";

    // First call should return original (round 0, sample 0)
    const firstResult = await paraphraser.paraphrase(originalPrompt, 0, 0);
    assert.strictEqual(firstResult, originalPrompt, "First sample should be original");

    // Second call should paraphrase (sample 1)
    const secondResult = await paraphraser.paraphrase(originalPrompt, 0, 1);
    assert.notStrictEqual(secondResult, originalPrompt, "Second sample should differ");
    assert.ok(secondResult.includes("Reformulate"), "Should use paraphrased version");

    // Check cache
    const stats = paraphraser.getCacheStats();
    assert.ok(stats.size > 0, "Cache should have entries");

    console.log("✅ Prompt Paraphrasing Test passed");
  });

  await t.test("Command Execution Test", async () => {
    const commandRunner = new CommandRunner({ safetyMode: "auto" });

    // Test low-risk command
    const result = await commandRunner.run("echo test");
    assert.strictEqual(result.status, "executed", "Command should execute");
    assert.ok(result.output.includes("test"), "Should have output");

    // Test classification
    const lowRisk = commandRunner.classify("ls");
    assert.strictEqual(lowRisk.severity, "low", "ls should be low risk");

    const highRisk = commandRunner.classify("rm -rf /");
    assert.strictEqual(highRisk.severity, "high", "rm should be high risk");

    console.log("✅ Command Execution Test passed");
  });

  // Cleanup
  cleanTestWorkspace();
});
