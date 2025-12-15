// Lightweight in-memory task queue with pause/cancel controls.
class TaskQueue {
  constructor() {
    this.tasks = [];
  }

  add(task) {
    this.tasks.push({ ...task, status: "pending" });
    return task.id;
  }

  list() {
    return [...this.tasks];
  }

  /**
   * Returns the next pending task, optionally filtered by predicate.
   * @param {(task:any)=>boolean} [predicate]
   */
  next(predicate) {
    return this.tasks.find(
      (task) => task.status === "pending" && (!predicate || predicate(task))
    );
  }

  updateStatus(taskId, status) {
    const task = this.tasks.find((t) => t.id === taskId);
    if (task) task.status = status;
    return task;
  }

  pause(taskId) {
    return this.updateStatus(taskId, "paused");
  }

  cancel(taskId) {
    return this.updateStatus(taskId, "cancelled");
  }
}

module.exports = { TaskQueue };
