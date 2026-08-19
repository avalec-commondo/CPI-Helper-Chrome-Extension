// ===========================================================================
// COMMNDO IS DEBUGGER - CORE UTILITIES (CmdUtils)
// ===========================================================================
// Pure utility functions for safe timestamp parsing, duration formatting,
// HTML escaping, string normalization, Java properties unescaping, dynamic
// expression resolution, and cross-context Chrome storage access.

const CmdUtils = {
  /**
   * Safely parses any SAP CPI timestamp into epoch milliseconds.
   * Supports:
   * - Number: 1786110756397
   * - Numeric string: "1786110756397"
   * - SAP OData format: "/Date(1786110756397)/" or "/Date(1786110756397+0200)/"
   * - ISO 8601 strings: "2026-08-13T11:01:11.500Z", "2026-08-13T11:01:11"
   * Returns 0 for null/undefined/invalid values.
   */
  parseMs(ts) {
    if (ts === null || ts === undefined || ts === "") return 0;
    if (typeof ts === "number") return isNaN(ts) ? 0 : ts;

    const str = String(ts).trim();
    if (!str) return 0;

    // 1. Pure numeric string (epoch)
    if (/^-?\d+$/.test(str)) {
      const num = parseInt(str, 10);
      return isNaN(num) ? 0 : num;
    }

    // 2. SAP OData /Date(1234567890)/ or /Date(1234567890+0200)/
    const odataMatch = str.match(/\/Date\((-?\d+)(?:[+-]\d+)?\)\//i);
    if (odataMatch && odataMatch[1]) {
      const num = parseInt(odataMatch[1], 10);
      return isNaN(num) ? 0 : num;
    }

    // 3. ISO Date string (e.g. "2026-08-13T11:01:11.500Z")
    const parsedEpoch = new Date(str).getTime();
    return isNaN(parsedEpoch) ? 0 : parsedEpoch;
  },

  /**
   * Formats timestamp into localized time string (e.g. "11:01:11").
   */
  formatTime(ts) {
    const ms = this.parseMs(ts);
    if (!ms) return "";
    try {
      return new Date(ms).toLocaleTimeString();
    } catch (e) {
      return String(ts);
    }
  },

  /**
   * Formats timestamp into localized date & time string.
   */
  formatDateTime(ts) {
    const ms = this.parseMs(ts);
    if (!ms) return "";
    try {
      return new Date(ms).toLocaleString();
    } catch (e) {
      return String(ts);
    }
  },

  /**
   * Formats millisecond duration into a clean human-readable string.
   * Examples: 0ms, 450ms, 1.25s, 3m 20s, 1h 15m
   */
  formatDuration(ms) {
    if (ms === null || ms === undefined || isNaN(ms) || ms <= 0) return "0ms";
    if (ms < 1000) return `${Math.round(ms)}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
    const mins = Math.floor(ms / 60000);
    const secs = Math.round((ms % 60000) / 1000);
    if (mins < 60) return `${mins}m ${secs}s`;
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `${hours}h ${remMins}m`;
  },

  /**
   * Safely escapes HTML special characters to prevent XSS.
   */
  escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  },

  /**
   * Unescapes Java/SAP `.properties` values (e.g. `\=`, `\:`, `\/`, `\\`).
   */
  unescapeJavaProperty(val) {
    if (!val || typeof val !== "string") return val || "";
    return val
      .replace(/\\=/g, "=")
      .replace(/\\:/g, ":")
      .replace(/\\\//g, "/")
      .replace(/\\\\/g, "\\")
      .replace(/\\t/g, "\t")
      .replace(/\\r/g, "\r")
      .replace(/\\n/g, "\n")
      .replace(/\\u([0-9a-fA-F]{4})/g, (m, hex) => String.fromCharCode(parseInt(hex, 16)));
  },

  /**
   * Evaluates dynamic Camel/CPI expressions like ${property.name} or ${header.name}.
   */
  resolveDynamicExpression(expr, properties = {}, headers = {}) {
    if (!expr || typeof expr !== "string") return expr || "";
    return expr
      .replace(/\$\{property\.([^}]+)\}/gi, (match, key) => {
        const k = key.trim();
        return properties[k] !== undefined ? properties[k] : match;
      })
      .replace(/\$\{(?:header|inheader)\.([^}]+)\}/gi, (match, key) => {
        const k = key.trim();
        return headers[k] !== undefined ? headers[k] : (properties[k] !== undefined ? properties[k] : match);
      });
  },

  /**
   * Normalizes iFlow IDs and names for fuzzy matching.
   * Removes underscores, hyphens, spaces, and lowercases.
   */
  normalizeFlowId(id) {
    if (!id) return "";
    return String(id).trim().toLowerCase().replace(/[\s\-_]+/g, "");
  },

  /**
   * Matches two endpoint addresses ignoring leading/trailing slashes and case.
   * e.g. "/p6/report" matches "p6/report/"
   */
  matchEndpointAddress(a1, a2) {
    if (!a1 || !a2) return false;
    const s1 = String(a1).trim().toLowerCase().replace(/^\/+|\/+$/g, "");
    const s2 = String(a2).trim().toLowerCase().replace(/^\/+|\/+$/g, "");
    return Boolean(s1 && s2 && s1 === s2);
  },

  /**
   * Concurrency-bounded asynchronous worker pool to limit parallel HTTP requests.
   * Preserves execution order and caps active concurrent promises to poolLimit.
   * @param {number} poolLimit - Max concurrent promises
   * @param {Array} array - Input items array
   * @param {Function} iteratorFn - Async function (item, index, array) => Promise<any>
   * @returns {Promise<Array>} Ordered array of resolved results
   */
  async asyncPool(poolLimit, array, iteratorFn) {
    if (!Array.isArray(array) || array.length === 0) return [];
    const limit = Math.max(1, poolLimit || 4);
    const ret = [];
    const executing = [];
    for (let i = 0; i < array.length; i++) {
      const item = array[i];
      const p = Promise.resolve().then(() => iteratorFn(item, i, array));
      ret.push(p);
      if (limit <= array.length) {
        const e = p.finally(() => {
          const idx = executing.indexOf(e);
          if (idx !== -1) executing.splice(idx, 1);
        });
        executing.push(e);
        if (executing.length >= limit) {
          await Promise.race(executing);
        }
      }
    }
    return Promise.all(ret);
  },

  // -------------------------------------------------------------------------
  // Unified Storage Access (CPI Helper Promise & Chrome Storage API)
  // -------------------------------------------------------------------------

  /**
   * Asynchronously retrieves a key or all keys from local extension storage.
   */
  async storageGet(key = null) {
    try {
      if (typeof storageGetPromise === "function" && key) {
        const res = await storageGetPromise(key);
        if (res !== undefined && res !== null) {
          if (typeof res === "object" && res[key] !== undefined) return res[key];
          return res;
        }
      }
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        return new Promise((resolve) => {
          chrome.storage.local.get(key, (items) => {
            if (!items) resolve(null);
            else if (key && typeof key === "string") resolve(items[key] !== undefined ? items[key] : null);
            else resolve(items);
          });
        });
      }
    } catch (e) {
      console.warn(`[CmdUtils] storageGet failed for key "${key}":`, e);
    }
    return null;
  },

  /**
   * Asynchronously stores a key-value pair or object in local extension storage.
   */
  async storageSet(keyOrObject, val = null) {
    try {
      const payload = typeof keyOrObject === "string" ? { [keyOrObject]: val } : keyOrObject;
      if (typeof storageSetPromise === "function") {
        await storageSetPromise(payload);
        return true;
      }
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        return new Promise((resolve) => {
          chrome.storage.local.set(payload, () => resolve(true));
        });
      }
    } catch (e) {
      console.warn(`[CmdUtils] storageSet failed:`, e);
    }
    return false;
  },

  /**
   * Asynchronously removes keys from local extension storage.
   */
  async storageRemove(keys) {
    try {
      const list = Array.isArray(keys) ? keys : [keys];
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        return new Promise((resolve) => {
          chrome.storage.local.remove(list, () => resolve(true));
        });
      }
    } catch (e) {
      console.warn("[CmdUtils] storageRemove failed:", e);
    }
    return false;
  },
};

// Expose globally
if (typeof window !== "undefined") {
  window.CmdUtils = CmdUtils;
  window.parseMs = (ts) => CmdUtils.parseMs(ts);
  window.escapeHtml = (s) => CmdUtils.escapeHtml(s);
}
if (typeof global !== "undefined") {
  global.CmdUtils = CmdUtils;
}
