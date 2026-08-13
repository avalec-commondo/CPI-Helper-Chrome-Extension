// ===========================================================================
// COMMNDO IS DEBUGGER - CORE EVENT BUS (CmdEventBus)
// ===========================================================================
// Lightweight, decoupled Publish-Subscribe event bus for inter-module communication.

const CmdEventBus = {
  _listeners: new Map(),

  // Standard system events
  Events: {
    RUN_SELECTED: "debugger:run_selected",
    NODE_SELECTED: "debugger:node_selected",
    VIEW_MODE_CHANGED: "debugger:view_mode_changed",
    TRACE_STATUS_CHANGED: "debugger:trace_status_changed",
    TOPOLOGY_UPDATED: "debugger:topology_updated",
    MODAL_OPENED: "debugger:modal_opened",
    MODAL_CLOSED: "debugger:modal_closed",
    DATA_REFRESH_REQUESTED: "debugger:data_refresh_requested",
  },

  /**
   * Subscribes a handler to an event.
   * Returns an unsubscribe function.
   * @param {string} eventName
   * @param {Function} handler
   * @returns {Function} Unsubscribe callback
   */
  on(eventName, handler) {
    if (typeof handler !== "function") return () => {};
    if (!this._listeners.has(eventName)) {
      this._listeners.set(eventName, new Set());
    }
    this._listeners.get(eventName).add(handler);

    return () => this.off(eventName, handler);
  },

  /**
   * Unsubscribes a handler from an event.
   * @param {string} eventName
   * @param {Function} handler
   */
  off(eventName, handler) {
    if (!this._listeners.has(eventName)) return;
    const set = this._listeners.get(eventName);
    set.delete(handler);
    if (set.size === 0) {
      this._listeners.delete(eventName);
    }
  },

  /**
   * Publishes an event with payload data to all subscribers.
   * @param {string} eventName
   * @param {any} data
   */
  emit(eventName, ...args) {
    if (!this._listeners.has(eventName)) return;
    const set = this._listeners.get(eventName);
    set.forEach((handler) => {
      try {
        handler(...args);
      } catch (err) {
        console.error(`[CmdEventBus] Error in handler for event "${eventName}":`, err);
      }
    });
  },

  /**
   * Subscribes to an event for exactly one invocation.
   * @param {string} eventName
   * @param {Function} handler
   */
  once(eventName, handler) {
    const unsubscribe = this.on(eventName, (...args) => {
      unsubscribe();
      handler(...args);
    });
    return unsubscribe;
  },

  /**
   * Clears all registered event listeners.
   */
  clearAll() {
    this._listeners.clear();
  },
};

// Expose globally
if (typeof window !== "undefined") {
  window.CmdEventBus = CmdEventBus;
}
if (typeof global !== "undefined") {
  global.CmdEventBus = CmdEventBus;
}
