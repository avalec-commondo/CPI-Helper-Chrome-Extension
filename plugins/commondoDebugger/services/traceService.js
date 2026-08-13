// ===========================================================================
// COMMNDO IS DEBUGGER - TRACE SERVICE (CmdTraceService)
// ===========================================================================
// Unified OData step harvester, payload streamer, and bulk TRACE log level manager.
// Centralizes all CPI Helper native setLogLevel, storage keep-alive, and active trace checks.

const CmdTraceService = {
  /**
   * Harvests all trace headers, exchange properties, and executed step IDs
   * for a message run in parallel. Cached in CmdStateStore.
   * @param {string} messageGuid - Message Processing Log GUID
   * @param {boolean} forceRefresh - Ignore cache if true
   * @returns {Promise<{ properties: Object, headers: Object, executedStepIds: Set }>}
   */
  async fetchRunTraceHeadersAndProperties(messageGuid, forceRefresh = false) {
    if (!messageGuid) return { properties: {}, headers: {}, executedStepIds: new Set() };

    const store = typeof CmdStateStore !== "undefined" ? CmdStateStore : null;
    if (!forceRefresh && store) {
      const cached = store.getCachedTracePayload(messageGuid);
      if (cached) return cached;
    }

    const api = typeof CmdApiClient !== "undefined" ? CmdApiClient : null;
    if (!api) return { properties: {}, headers: {}, executedStepIds: new Set() };

    const properties = {};
    const headers = {};
    const executedStepIds = new Set();

    try {
      const runs = await api.fetchMessageRuns(messageGuid);
      if (runs.length === 0) return { properties, headers, executedStepIds };

      const runId = runs[0].Id;
      const steps = await api.fetchRunSteps(runId);

      steps.forEach((s) => {
        if (s.StepId) {
          executedStepIds.add(s.StepId);
          executedStepIds.add(s.StepId.toLowerCase());
        }
      });

      const tracedSteps = steps.filter((s) => (s.TraceCount && parseInt(s.TraceCount, 10) > 0) || s.ChildCount !== undefined);

      const stepChunks = [];
      for (let i = 0; i < tracedSteps.length; i += 6) {
        stepChunks.push(tracedSteps.slice(i, i + 6));
      }

      for (const chunk of stepChunks) {
        await Promise.all(
          chunk.map(async (step) => {
            try {
              const traceMessages = await api.fetchStepTraceMessages(runId, step.ChildCount);
              if (traceMessages.length > 0) {
                const traceId = traceMessages[0].TraceId;

                const [propsData, headersData] = await Promise.all([
                  api.fetchStepExchangeProperties(traceId),
                  api.fetchStepHeaders(traceId),
                ]);

                if (Array.isArray(propsData)) {
                  propsData.forEach((p) => {
                    const k = p.Name || p.Key || p.name;
                    const v = p.Value !== undefined ? p.Value : p.value;
                    if (k) properties[k] = v;
                  });
                }

                if (Array.isArray(headersData)) {
                  headersData.forEach((h) => {
                    const k = h.Name || h.Key || h.name;
                    const v = h.Value !== undefined ? h.Value : h.value;
                    if (k) headers[k] = v;
                  });
                }
              }
            } catch (eStep) {}
          })
        );
      }
    } catch (err) {
      console.warn(`[CmdTraceService] Trace harvesting error for ${messageGuid}:`, err);
    }

    const payloadResult = { properties, headers, executedStepIds };
    if (store) {
      store.setCachedTracePayload(messageGuid, payloadResult);
    }
    return payloadResult;
  },

  // -----------------------------------------------------------------------
  // Bulk TRACE / INFO Log Level Activation & Storage Synchronization
  // -----------------------------------------------------------------------

  /**
   * Sets log level (TRACE | DEBUG | INFO | ERROR) for an individual iFlow.
   * Handles native CPI-Helper setLogLevel, Operations fallback, and storage sync.
   */
  async setFlowLogLevel(iflowId, logLevel = "TRACE") {
    if (!iflowId) return { ok: false, iflowId, error: "Empty iFlow ID" };
    const cleanLevel = String(logLevel).toUpperCase();
    let ok = false;

    // 1. Primary: Native CPI-Helper setLogLevel function
    if (typeof setLogLevel === "function") {
      try {
        await setLogLevel(cleanLevel, iflowId);
        ok = true;
      } catch (eNative) {
        console.warn(`[CmdTraceService] Native setLogLevel failed for ${iflowId}:`, eNative);
      }
    }

    // 2. Fallback: CmdApiClient Operations command
    if (!ok && typeof CmdApiClient !== "undefined") {
      const res = await CmdApiClient.setMplLogLevel(iflowId, cleanLevel);
      if (res.ok) ok = true;
    }

    // 3. Synchronize storage keep-alive and UI button state
    if (ok) {
      const isActive = cleanLevel === "TRACE" || cleanLevel === "DEBUG";
      await this.syncStorageKeepAlive(iflowId, isActive);

      // If this is the active flow on screen, update UI elements
      const activeFlow = (typeof cpiData !== "undefined" && cpiData.integrationFlowId) ? cpiData.integrationFlowId : "";
      if (iflowId === activeFlow) {
        const stdBtn = document.querySelector(".cpiHelper_traceButton, [id*='traceButton'], #button134345-BDI-content");
        const timerBadge = document.getElementById("__commondo_header_trace_timer");
        if (isActive) {
          if (stdBtn && !stdBtn.classList.contains("cpiHelper_powertrace")) stdBtn.classList.add("cpiHelper_powertrace");
        } else {
          if (stdBtn) stdBtn.classList.remove("cpiHelper_powertrace");
          if (timerBadge) timerBadge.style.display = "none";
        }
      }
    }

    return { ok, iflowId, logLevel: cleanLevel };
  },

  /**
   * Executes batch log level activation across multiple iFlows in parallel.
   */
  async executeBatchLogLevel(iflowIds = [], logLevel = "TRACE", onProgress = null) {
    const list = Array.isArray(iflowIds) ? iflowIds.filter(Boolean) : [];
    if (list.length === 0) return { total: 0, succeeded: 0, failed: 0, results: [] };

    const results = [];
    let completed = 0;
    const poolSize = 5;

    for (let i = 0; i < list.length; i += poolSize) {
      const chunk = list.slice(i, i + poolSize);
      const chunkResults = await Promise.all(
        chunk.map(async (id) => {
          const r = await this.setFlowLogLevel(id, logLevel);
          completed++;
          if (typeof onProgress === "function") {
            onProgress(completed, list.length, id);
          }
          return r;
        })
      );
      results.push(...chunkResults);
    }

    const succeeded = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok).length;

    if (logLevel === "TRACE" && succeeded > 0) {
      if (typeof CmdHeaderTraceButton !== "undefined" && CmdHeaderTraceButton.updateHeaderTraceTimer) {
        CmdHeaderTraceButton.updateHeaderTraceTimer(Date.now());
      }
    }

    if (typeof CmdEventBus !== "undefined") {
      CmdEventBus.emit(CmdEventBus.Events.TRACE_STATUS_CHANGED, {
        logLevel,
        succeeded,
        failed,
        total: list.length,
      });
    }

    const actionText = logLevel === "TRACE" ? "TRACE activated" : "Set to INFO";
    if (typeof showToast === "function") {
      showToast(`${actionText} for ${succeeded} iFlow(s).`, "Trace Manager", succeeded > 0 ? "success" : "warning");
    }

    return { total: list.length, succeeded, failed, results };
  },

  /**
   * Synchronizes CPI Helper keep-alive Chrome Storage keys so TRACE remains active.
   */
  async syncStorageKeepAlive(iflowId, isActive = true) {
    if (!iflowId) return;
    const utils = typeof CmdUtils !== "undefined" ? CmdUtils : null;
    const tenant = typeof CmdApiClient !== "undefined" ? CmdApiClient.getTenantHost() : "";
    const currentLocId = (typeof cpiData !== "undefined" && cpiData.runtimeLocationId) ? cpiData.runtimeLocationId : (tenant.replace(/[^a-zA-Z0-9]/g, "") || "cloudintegration");

    const val = isActive ? Date.now().toString() : null;

    const keysObj = {
      [`${iflowId}_powertraceLastRefresh`]: val,
      [`${iflowId}_${currentLocId}_powertraceLastRefresh`]: val,
      [`${iflowId}_cloudintegration_powertraceLastRefresh`]: val,
    };

    if (utils) {
      await utils.storageSet(keysObj);
    }
  },

  /**
   * Reads Chrome storage to identify all iFlows currently under active TRACE (within 10 minutes).
   * @returns {Promise<Set<string>>} Set of active flow IDs
   */
  async getActiveTracedFlowsFromStorage() {
    const activeSet = new Set();
    const utils = typeof CmdUtils !== "undefined" ? CmdUtils : null;
    if (!utils) return activeSet;

    try {
      const storageItems = await utils.storageGet(null);
      if (!storageItems || typeof storageItems !== "object") return activeSet;

      const now = Date.now();
      const tenMins = 10 * 60 * 1000;

      Object.keys(storageItems).forEach((k) => {
        if (k.includes("powertraceLastRefresh")) {
          const ts = Number(storageItems[k]);
          if (ts && now - ts < tenMins) {
            const prefix = k.split("_powertraceLastRefresh")[0];
            if (prefix) {
              activeSet.add(prefix);
              const clean = prefix.replace(/_(cloudintegration|undefined|[a-zA-Z0-9_-]+)$/, "");
              if (clean) activeSet.add(clean);
            }
          }
        }
      });
    } catch (e) {}

    return activeSet;
  },
};

// Expose globally
if (typeof window !== "undefined") {
  window.CmdTraceService = CmdTraceService;
}
if (typeof global !== "undefined") {
  global.CmdTraceService = CmdTraceService;
}
