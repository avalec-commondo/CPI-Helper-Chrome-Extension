// ===========================================================================
// COMMODNO IS DEBUGGER - TRACE PAYLOAD HELPER
// ===========================================================================
// Fetches detailed step execution traces, properties, headers, bodies,
// and formatted log contents via SAP CPI OData endpoints.

const tracePayloadCache = new Map();

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

  /**
   * Clears the trace payload cache for a fresh run/session.
   */
  clearCache() {
    tracePayloadCache.clear();
  },

  /**
   * Fetches all exchange properties and headers captured during a trace execution run.
   * Cached per MessageGuid. Parallelized with Promise.all for high performance.
   * Returns: { properties: Object, headers: Object }
   */
  async fetchRunTraceHeadersAndProperties(messageGuid, forceRefresh = false) {
    if (!messageGuid) return { properties: {}, headers: {} };
    if (!forceRefresh && tracePayloadCache.has(messageGuid)) {
      return tracePayloadCache.get(messageGuid);
    }

    const properties = {};
    const headers = {};
    const executedStepIds = new Set();

    const urlExt = typeof cpiData !== "undefined" && cpiData.urlExtension ? cpiData.urlExtension : "";
    const runtimeExt = typeof cpiData !== "undefined" && cpiData.runtimePathExtension ? cpiData.runtimePathExtension : "";
    const odataBase = "/" + urlExt + runtimeExt + "odata/api/v1/";
    const absPath = typeof absolutePath === "function" ? absolutePath : (url) => url;

    async function callOData(relPath) {
      try {
        const fullUrl = absPath(odataBase + relPath.replace(/^\/+/, ""));
        const resp = await fetch(fullUrl, {
          method: "GET",
          headers: { Accept: "application/json" },
          credentials: "include",
        });
        if (!resp.ok) return null;
        const data = await resp.json();
        return data?.d?.results || data?.d || data?.value || data || [];
      } catch (e) {
        return null;
      }
    }

    try {
      // 1. Custom Header Properties & Runs in parallel
      const [custItems, runs] = await Promise.all([
        callOData(`MessageProcessingLogs('${encodeURIComponent(messageGuid)}')/CustomHeaderProperties?$format=json`),
        callOData(`MessageProcessingLogs('${encodeURIComponent(messageGuid)}')/Runs?$format=json`),
      ]);

      if (Array.isArray(custItems)) {
        custItems.forEach((c) => {
          if (c.Name && c.Value) {
            headers[c.Name] = c.Value;
            headers[c.Name.toLowerCase()] = c.Value;
          }
        });
      }

      const runList = Array.isArray(runs) ? runs : [];
      const collectedTraceIds = new Set();

      // 2. Fetch RunSteps for all runs in parallel
      const runStepPromises = runList.map((run) =>
        run.Id ? callOData(`MessageProcessingLogRuns('${encodeURIComponent(run.Id)}')/RunSteps?$format=json&$top=300`) : Promise.resolve([])
      );
      const allRunSteps = await Promise.all(runStepPromises);

      // Collect steps to inspect
      const stepInspectTasks = [];
      allRunSteps.forEach((steps, runIdx) => {
        const runId = runList[runIdx]?.Id;
        const stepList = Array.isArray(steps) ? steps : [];
        stepList.forEach((step) => {
          const childCount = step.ChildCount;
          if (childCount === undefined || !runId) return;

          // Parallel query for step details + trace messages
          stepInspectTasks.push(
            Promise.all([
              callOData(`MessageProcessingLogRunSteps(RunId='${encodeURIComponent(runId)}',ChildCount=${childCount})/TraceMessages?$format=json`),
              callOData(`MessageProcessingLogRunSteps(RunId='${encodeURIComponent(runId)}',ChildCount=${childCount})/?$expand=RunStepProperties&$format=json`),
            ]).then(([traceData, stepDetails]) => {
              if (Array.isArray(traceData)) {
                traceData.forEach((td) => {
                  if (td.TraceId) collectedTraceIds.add(String(td.TraceId));
                });
              }
              const stepProps = stepDetails?.RunStepProperties?.results || stepDetails?.RunStepProperties || [];
              if (Array.isArray(stepProps)) {
                stepProps.forEach((sp) => {
                  if (sp.Name) {
                    properties[sp.Name] = sp.Value;
                    properties[sp.Name.toLowerCase()] = sp.Value;
                    if (sp.Name.toLowerCase() === "traceids" && sp.Value) {
                      const mIds = String(sp.Value).match(/\d+/g);
                      if (mIds) mIds.forEach((id) => collectedTraceIds.add(id));
                    }
                  }
                });
              }
            })
          );
        });
      });

      // Execute step inspections in parallel
      await Promise.all(stepInspectTasks);

      // Collect all executed step IDs from RunSteps
      allRunSteps.forEach((steps) => {
        (Array.isArray(steps) ? steps : []).forEach((step) => {
          if (step.StepId) executedStepIds.add(step.StepId);
          if (step.ModelStepId) executedStepIds.add(step.ModelStepId);
          if (step.ActivityId) executedStepIds.add(step.ActivityId);
          if (step.BranchId) executedStepIds.add(step.BranchId);
        });
      });

      // 3. Fetch ExchangeProperties and Properties for all Trace IDs in parallel
      const traceIdArray = Array.from(collectedTraceIds);
      if (traceIdArray.length > 0) {
        // Probe first trace ID to check if trace data is still alive
        const testProp = await callOData(`TraceMessages(${traceIdArray[0]})/ExchangeProperties?$format=json`);
        if (testProp === null) {
          console.log(`%c[Trace Payload] TraceMessages(${traceIdArray[0]}) returned null -- trace data expired`, "color: #f59e0b;");
        } else {
          if (Array.isArray(testProp)) {
            testProp.forEach((p) => {
              if (p.Name) {
                properties[p.Name] = p.Value;
                properties[p.Name.toLowerCase()] = p.Value;
              }
            });
          }
          // Fetch the remaining in parallel
          const remainingIds = traceIdArray.slice(1);
          const traceTasks = remainingIds.flatMap((traceId) => [
            callOData(`TraceMessages(${traceId})/ExchangeProperties?$format=json`).then((items) => {
              if (Array.isArray(items)) {
                items.forEach((p) => {
                  if (p.Name) {
                    properties[p.Name] = p.Value;
                    properties[p.Name.toLowerCase()] = p.Value;
                  }
                });
              }
            }),
            callOData(`TraceMessages(${traceId})/Properties?$format=json`).then((items) => {
              if (Array.isArray(items)) {
                items.forEach((h) => {
                  if (h.Name) {
                    headers[h.Name] = h.Value;
                    headers[h.Name.toLowerCase()] = h.Value;
                  }
                });
              }
            }),
          ]);
          await Promise.all(traceTasks);
        }
      }
    } catch (e) {
      console.warn("Failed fetching trace headers/properties for", messageGuid, e);
    }

    const executedStepsList = Array.from(executedStepIds || []);
    console.log(`%c[Trace Payload Extraction] MessageGuid "${messageGuid}" -> Properties: ${Object.keys(properties).length}, Headers: ${Object.keys(headers).length}, ExecutedSteps: ${executedStepsList.length}`, "color: #3b82f6; font-weight: bold;", { properties, headers, executedSteps: executedStepsList });

    const result = { properties, headers, executedStepIds: executedStepsList };
    tracePayloadCache.set(messageGuid, result);
    return result;
  },
};

// Expose to window namespace
if (typeof window !== "undefined") {
  window.CmdTracePayloadHelper = CmdTracePayloadHelper;
}

