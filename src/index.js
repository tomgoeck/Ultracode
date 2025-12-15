const { LLMRegistry, EchoProvider } = require("./llmRegistry");
const { StateStore } = require("./stateStore");
const { TaskQueue } = require("./taskQueue");
const { CommandRunner } = require("./executionGuard");
const { Orchestrator } = require("./orchestrator");
const { ProjectGuard } = require("./projectGuard");
const { planTask } = require("./planner");

async function main() {
  const llms = new LLMRegistry();
  llms.register("echo-strong", new EchoProvider({ noisy: false, model: "echo-strong" }));
  llms.register("echo-vote", new EchoProvider({ noisy: true, model: "echo-vote" }));

  const projectGuard = new ProjectGuard(process.cwd());
  const stateStore = new StateStore({
    projectRoot: process.cwd(),
    files: {},
  });

  const taskQueue = new TaskQueue();
  const commandRunner = new CommandRunner({ safetyMode: "ask" });
  const orchestrator = new Orchestrator({
    llmRegistry: llms,
    stateStore,
    commandRunner,
    projectGuard,
  });

  const task = planTask({
    id: "task-demo",
    title: "Demo: create greeting and write log",
    goal: "Produce a greeting line and write it to out/demo.log",
    model: "echo-strong",
    voteModel: "echo-vote",
    filePath: "out/demo.log",
  });

  taskQueue.add(task);
  const nextTask = taskQueue.next();
  nextTask.status = "running";
  const workspacePath = `${process.cwd()}/workspaces/${task.id}`;
  const fs = require("fs");
  fs.mkdirSync(workspacePath, { recursive: true });
  const workspaceGuard = new ProjectGuard(workspacePath);
  for (const step of nextTask.steps) {
    step.status = "running";
    const result = await orchestrator.runStep(nextTask, step, workspaceGuard);
    console.log(`Step ${step.id} lead-by:`, result.leadBy);
    console.log(`Step ${step.id} winner:`, result.winner?.output);
    if (result.applyResult) {
      console.log(`Apply result (${step.apply?.type || "state"}):`, result.applyResult);
    }
    if (result.commandResult) {
      console.log(`Command result:`, result.commandResult);
    }
  }
  nextTask.status = "completed";

  console.log("Final state snapshot:", stateStore.snapshot());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
