// ===========================================================================
// COMMNDO IS DEBUGGER - CORE STATE STORE (CmdStateStore)
// ===========================================================================
// Central reactive state manager and multi-tier cache store.

// Transient in-memory caches
const bpmnModelCache = new Map();
const tracePayloadCache = new Map();
const packageArtifactsCache = new Map();
const artifactNameMap = new Map();
const artifactGuidMap = new Map();
const artifactPackageMap = new Map();
let deployedArtifactsCache = null;

// Primary State
const _state = {
  rootFlowId: "",
  packageId: "",
  viewMode: "runtime", // "runtime" | "static"
  rootRuns: [],
  selectedRun: null,
  correlationLogs: [],
  logsByFlowId: {},
  topologyData: null,
  staticTopologyData: null,
  selectedNodeId: null,
  selectedNodeRunIndex: 0,
  traceActiveUntil: 0,
};

const CmdStateStore = {
  /**
   * Get current state snapshot (read-only shallow copy).
   */
  getState() {
    return { ..._state };
  },

  /**
   * Get a specific state field.
   */
  get(key) {
    return _state[key];
  },

  getCorrelationId() {
    return _state.correlationId || "";
  },

  setCorrelationId(id) {
    this.set("correlationId", id);
  },

  set(keyOrUpdates = {}, value = undefined) {
    const updates = typeof keyOrUpdates === "string" ? { [keyOrUpdates]: value } : keyOrUpdates || {};
    let changed = false;

    for (const [key, val] of Object.entries(updates)) {
      if (_state[key] !== val) {
        _state[key] = val;
        changed = true;
      }
    }

    if (changed && typeof CmdEventBus !== "undefined") {
      if (updates.selectedRun !== undefined) {
        CmdEventBus.emit(CmdEventBus.Events.RUN_SELECTED, _state.selectedRun);
      }
      if (updates.selectedNodeId !== undefined) {
        CmdEventBus.emit(CmdEventBus.Events.NODE_SELECTED, {
          nodeId: _state.selectedNodeId,
          runIndex: _state.selectedNodeRunIndex,
        });
      }
      if (updates.viewMode !== undefined) {
        CmdEventBus.emit(CmdEventBus.Events.VIEW_MODE_CHANGED, _state.viewMode);
      }
      if (updates.topologyData !== undefined || updates.staticTopologyData !== undefined) {
        CmdEventBus.emit(CmdEventBus.Events.TOPOLOGY_UPDATED, {
          viewMode: _state.viewMode,
          topology: _state.viewMode === "static" ? _state.staticTopologyData : _state.topologyData,
        });
      }
    }
  },

  // -----------------------------------------------------------------------
  // Artifact Metadata Registry
  // -----------------------------------------------------------------------

  registerArtifactName(id, name) {
    if (!id || !name) return;
    artifactNameMap.set(id, name);
    artifactNameMap.set(id.toLowerCase(), name);
    const norm = typeof CmdUtils !== "undefined" ? CmdUtils.normalizeFlowId(id) : String(id).toLowerCase();
    if (norm) artifactNameMap.set(norm, name);
  },

  getArtifactName(id) {
    if (!id) return "";
    if (artifactNameMap.has(id)) return artifactNameMap.get(id);
    if (artifactNameMap.has(id.toLowerCase())) return artifactNameMap.get(id.toLowerCase());
    const norm = typeof CmdUtils !== "undefined" ? CmdUtils.normalizeFlowId(id) : String(id).toLowerCase();
    if (artifactNameMap.has(norm)) return artifactNameMap.get(norm);
    return "";
  },

  registerArtifactPackageId(id, packageId) {
    if (!id || !packageId) return;
    artifactPackageMap.set(id, packageId);
    artifactPackageMap.set(id.toLowerCase(), packageId);
    const norm = typeof CmdUtils !== "undefined" ? CmdUtils.normalizeFlowId(id) : String(id).toLowerCase();
    if (norm) artifactPackageMap.set(norm, packageId);
  },

  getArtifactPackageId(id) {
    if (!id) return "";
    if (artifactPackageMap.has(id)) return artifactPackageMap.get(id);
    if (artifactPackageMap.has(id.toLowerCase())) return artifactPackageMap.get(id.toLowerCase());
    const norm = typeof CmdUtils !== "undefined" ? CmdUtils.normalizeFlowId(id) : String(id).toLowerCase();
    if (artifactPackageMap.has(norm)) return artifactPackageMap.get(norm);
    return "";
  },

  registerArtifactGuid(id, guid) {
    if (!id || !guid) return;
    artifactGuidMap.set(id, guid);
    artifactGuidMap.set(id.toLowerCase(), guid);
    const norm = typeof CmdUtils !== "undefined" ? CmdUtils.normalizeFlowId(id) : String(id).toLowerCase();
    if (norm) artifactGuidMap.set(norm, guid);
  },

  getArtifactGuid(id) {
    if (!id) return "";
    if (artifactGuidMap.has(id)) return artifactGuidMap.get(id);
    if (artifactGuidMap.has(id.toLowerCase())) return artifactGuidMap.get(id.toLowerCase());
    const norm = typeof CmdUtils !== "undefined" ? CmdUtils.normalizeFlowId(id) : String(id).toLowerCase();
    if (artifactGuidMap.has(norm)) return artifactGuidMap.get(norm);
    return id;
  },

  // -----------------------------------------------------------------------
  // Cache Management (with LRU/FIFO Memory Bounding)
  // -----------------------------------------------------------------------

  getCachedBpmnModel(iflowId) {
    if (!iflowId) return null;
    return bpmnModelCache.get(iflowId) || bpmnModelCache.get(iflowId.toLowerCase()) || null;
  },

  setCachedBpmnModel(iflowId, model) {
    if (iflowId && model) {
      // Remove existing keys first for clean LRU ordering
      bpmnModelCache.delete(iflowId);
      bpmnModelCache.delete(iflowId.toLowerCase());

      // LRU eviction cap: 100 entries
      while (bpmnModelCache.size >= 100) {
        const oldestKey = bpmnModelCache.keys().next().value;
        if (oldestKey !== undefined) bpmnModelCache.delete(oldestKey);
        else break;
      }
      bpmnModelCache.set(iflowId, model);
      if (iflowId.toLowerCase() !== iflowId) {
        bpmnModelCache.set(iflowId.toLowerCase(), model);
      }
    }
  },

  getCachedTracePayload(messageGuid) {
    if (!messageGuid) return null;
    return tracePayloadCache.get(messageGuid) || null;
  },

  setCachedTracePayload(messageGuid, payloadData) {
    if (messageGuid && payloadData) {
      // LRU eviction cap: 50 trace payloads
      while (tracePayloadCache.size >= 50) {
        const oldestKey = tracePayloadCache.keys().next().value;
        if (oldestKey !== undefined) tracePayloadCache.delete(oldestKey);
        else break;
      }
      tracePayloadCache.set(messageGuid, payloadData);
    }
  },

  getCachedPackageArtifacts(packageId) {
    if (!packageId) return null;
    return packageArtifactsCache.get(packageId) || null;
  },

  setCachedPackageArtifacts(packageId, artifacts) {
    if (packageId && Array.isArray(artifacts)) {
      // LRU eviction cap: 50 package lists
      while (packageArtifactsCache.size >= 50) {
        const oldestKey = packageArtifactsCache.keys().next().value;
        if (oldestKey !== undefined) packageArtifactsCache.delete(oldestKey);
        else break;
      }
      packageArtifactsCache.set(packageId, artifacts);
    }
  },

  getCachedDeployedArtifacts() {
    return deployedArtifactsCache;
  },

  setCachedDeployedArtifacts(artifacts) {
    if (Array.isArray(artifacts)) {
      deployedArtifactsCache = artifacts;
    }
  },

  /**
   * Clears transient trace and model caches for fresh data fetching.
   */
  clearTransientCaches() {
    bpmnModelCache.clear();
    tracePayloadCache.clear();
  },

  /**
   * Resets active session states (runs, correlations, topology) to prevent state bleeding.
   */
  resetSessionState() {
    _state.selectedRun = null;
    _state.correlationLogs = [];
    _state.logsByFlowId = {};
    _state.topologyData = null;
    _state.staticTopologyData = null;
    _state.selectedNodeId = null;
    _state.selectedNodeRunIndex = 0;
    this.clearTransientCaches();
  },

  /**
   * Fully resets state store and all caches (e.g. on tenant/iFlow navigation).
   */
  clearAll() {
    bpmnModelCache.clear();
    tracePayloadCache.clear();
    packageArtifactsCache.clear();
    artifactNameMap.clear();
    artifactGuidMap.clear();
    artifactPackageMap.clear();
    if (typeof CmdApiClient !== "undefined" && typeof CmdApiClient.clearCache === "function") {
      CmdApiClient.clearCache();
    }

    _state.rootFlowId = "";
    _state.packageId = "";
    _state.viewMode = "runtime";
    _state.rootRuns = [];
    _state.selectedRun = null;
    _state.correlationLogs = [];
    _state.logsByFlowId = {};
    _state.topologyData = null;
    _state.staticTopologyData = null;
    _state.selectedNodeId = null;
    _state.selectedNodeRunIndex = 0;
    _state.traceActiveUntil = 0;
  },
};

// Expose globally
if (typeof window !== "undefined") {
  window.CmdStateStore = CmdStateStore;
}
if (typeof global !== "undefined") {
  global.CmdStateStore = CmdStateStore;
}
