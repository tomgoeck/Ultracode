// Minimal JSON-based state store. Holds explicit state; every step reads a slice and writes back a patch.
class StateStore {
  constructor(initialState = {}) {
    this.state = { ...initialState };
  }

  /** @returns {any} */
  snapshot() {
    return JSON.parse(JSON.stringify(this.state));
  }

  /**
   * @param {Object} patch
   */
  applyPatch(patch) {
    this.state = { ...this.state, ...patch };
    return this.state;
  }

  /**
   * @param {string} key
   * @param {(prev:any)=>any} updater
   */
  updateSection(key, updater) {
    const next = updater(this.state[key]);
    this.state[key] = next;
    return next;
  }
}

module.exports = { StateStore };
