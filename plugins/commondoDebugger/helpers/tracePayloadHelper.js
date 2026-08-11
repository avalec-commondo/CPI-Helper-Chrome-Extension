// ===========================================================================
// COMMODNO IS DEBUGGER - TRACE PAYLOAD HELPER
// ===========================================================================
// Fetches detailed step execution traces, properties, headers, bodies,
// and formatted log contents via SAP CPI OData endpoints.

const CmdTracePayloadHelper = {
  /**
   * Safely escapes HTML special characters.
   */
  escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  },

  /**
   * Formats millisecond duration into a human-readable string.
   */
  formatDuration(ms) {
    if (!ms && ms !== 0) return "0ms";
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  },

  /**
   * Formats ISO timestamp or Epoch into localized string.
   */
  formatTime(isoStr) {
    if (!isoStr) return "";
    try {
      if (typeof isoStr === "string" && isoStr.includes("/Date(")) {
        const epoch = parseInt(isoStr.replace(/[^0-9]/g, ""), 10);
        return new Date(epoch).toLocaleTimeString();
      }
      return new Date(isoStr).toLocaleTimeString();
    } catch (e) {
      return String(isoStr);
    }
  },
};

// Expose to window namespace
if (typeof window !== "undefined") {
  window.CmdTracePayloadHelper = CmdTracePayloadHelper;
}

