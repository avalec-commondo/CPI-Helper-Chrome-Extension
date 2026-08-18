// ===========================================================================
// COMMNDO IS DEBUGGER - ZIP EXPORT SERVICE (CmdZipExportService)
// ===========================================================================
// High-performance consolidated trace package export engine.
// Generates:
// 1. trace_data.json - Complete indexed hierarchy of topology, flows, runs, and step traces
// 2. topology.json   - Clean DAG graph definition
// 3. viewer.html      - Standalone, self-contained offline interactive SVG topology & trace debugger

const CmdZipExportService = {
  /**
   * Bounded async worker pool to limit parallel HTTP requests (delegates to CmdUtils).
   */
  async asyncPool(poolLimit, array, iteratorFn) {
    const utils = typeof CmdUtils !== "undefined" ? CmdUtils : null;
    if (utils && utils.asyncPool) {
      return utils.asyncPool(poolLimit, array, iteratorFn);
    }
    return Promise.all(array.map(iteratorFn));
  },

  /**
   * Exports full multi-flow trace package as a downloaded .zip file.
   * @param {Object} topologyData - Discovery topology ({ nodes, edges, rootFlowId, levels, hangingNodes })
   * @param {Function} onProgress - Progress callback (completed, total, statusText)
   */
  async exportTracePackage(topologyData, onProgress = null) {
    if (typeof JSZip === "undefined") {
      throw new Error("JSZip library is not loaded.");
    }

    const api = typeof CmdApiClient !== "undefined" ? CmdApiClient : null;
    const bpmnService = typeof CmdBpmnParserService !== "undefined" ? CmdBpmnParserService : null;
    const store = typeof CmdStateStore !== "undefined" ? CmdStateStore : null;

    if (!topologyData || !topologyData.nodes || topologyData.nodes.length === 0) {
      throw new Error("No trace topology data to export.");
    }

    const rootFlowId = topologyData.rootFlowId || topologyData.nodes[0].id;
    const correlationId =
      (store && typeof store.getCorrelationId === "function" ? store.getCorrelationId() : store?.get?.("correlationId")) ||
      (typeof CmdDebuggerMainModal !== "undefined" ? CmdDebuggerMainModal.state?.correlationId : "") ||
      "";
    const zip = new JSZip();

    const totalNodes = topologyData.nodes.length;

    function reportProgress(completed, total, stepText) {
      if (typeof onProgress === "function") {
        onProgress(completed, total, stepText);
      }
    }

    reportProgress(0, totalNodes, "Collecting flow definitions and runs...");

    // 1. Build Consolidated Trace Data Object
    const traceData = {
      version: "2.0",
      generator: "Commondo IS Debugger (Consolidated Export)",
      exportTimestamp: new Date().toISOString(),
      tenantHost: api ? api.getTenantHost() : "",
      correlationId: correlationId || rootFlowId,
      rootFlowId,
      topology: {
        rootFlowId,
        nodes: topologyData.nodes.map((n) => ({
          id: n.id,
          name: n.name || n.displayName || n.id,
          displayName: n.displayName || n.name || n.id,
          description: n.description || "",
          level: n.level !== undefined ? n.level : 0,
          isRoot: Boolean(n.isRoot),
          status: n.status || "COMPLETED",
          runsCount: n.runsCount || (n.runs ? n.runs.length : 0),
          totalDuration: n.totalDuration || 0,
          hanging: n.hanging || [],
        })),
        edges: topologyData.edges || [],
        levels: topologyData.levels || {},
        hangingNodes: topologyData.hangingNodes || {},
        layout: topologyData.layout || null,
      },
      flows: {},
    };

    // 2. Parallel pre-process each flow and collect step trace jobs
    const allStepJobs = [];
    let processedFlows = 0;

    await this.asyncPool(6, topologyData.nodes, async (node) => {
      const flowId = node.id;
      const bpmnModel = bpmnService ? await bpmnService.getModel(flowId) : { steps: {} };
      const stepNamesMap = bpmnModel?.steps || {};

      const flowRuns = (node.runs && node.runs.length > 0) ? node.runs : [];

      const flowRecord = {
        id: flowId,
        name: node.name || node.displayName || flowId,
        displayName: node.displayName || node.name || flowId,
        description: node.description || "",
        level: node.level !== undefined ? node.level : 0,
        isRoot: Boolean(node.isRoot),
        status: node.status || "COMPLETED",
        runsCount: flowRuns.length,
        totalDuration: node.totalDuration || 0,
        runs: new Array(flowRuns.length),
      };

      // Load runs for this flow in parallel
      await Promise.all(flowRuns.map(async (run, rIdx) => {
        const messageGuid = run.MessageGuid || run.Id || run.MessageId;

        let duration = 0;
        if (run.Duration !== undefined && run.Duration !== null && !isNaN(Number(run.Duration)) && Number(run.Duration) > 0) {
          duration = Number(run.Duration);
        } else {
          const parseMs = (d) => {
            if (!d) return null;
            if (typeof d === "number") return d;
            if (typeof d === "string") {
              const m = d.match(/\/Date\((\d+)\)\//);
              if (m) return parseInt(m[1], 10);
              const p = Date.parse(d);
              if (!isNaN(p)) return p;
            }
            return null;
          };
          const s = parseMs(run.LogStart || run.logStart);
          const e = parseMs(run.LogEnd || run.logEnd);
          if (s !== null && e !== null && e >= s) {
            duration = e - s;
          }
        }

        const runRecord = {
          runIndex: rIdx,
          messageGuid,
          status: run.Status || "COMPLETED",
          logStart: run.LogStart,
          logEnd: run.LogEnd,
          duration,
          errorInformation: null,
          steps: [],
        };

        if (messageGuid && api) {
          // If this run failed, fetch error details
          if (run.Status === "FAILED" || run.Status === "ESCALATED" || node.status === "FAILED") {
            try {
              runRecord.errorInformation = await api.fetchErrorInformation(messageGuid);
            } catch (eErr) {}
          }

          try {
            const runs = await api.fetchMessageRuns(messageGuid);
            if (runs && runs.length > 0) {
              const runId = runs[0].Id;

              // Batch fetch run steps and all trace messages for this run in parallel
              const [runSteps, runTraceMessages] = await Promise.all([
                api.fetchRunSteps(runId).catch(() => []),
                typeof api.fetchRunTraceMessages === "function"
                  ? api.fetchRunTraceMessages(runId).catch(() => [])
                  : [],
              ]);

              // Build fast lookup map for trace messages in this run (O(1) lookup per step)
              const runTraceMap = new Map();
              (runTraceMessages || []).forEach((tm) => {
                if (tm.ChildCount !== undefined && tm.TraceId) {
                  const exProps = tm.ExchangeProperties?.results || (Array.isArray(tm.ExchangeProperties) ? tm.ExchangeProperties : null);
                  const hdrs = tm.Properties?.results || (Array.isArray(tm.Properties) ? tm.Properties : null);
                  runTraceMap.set(Number(tm.ChildCount), {
                    traceId: tm.TraceId,
                    prefetchedProperties: exProps || null,
                    prefetchedHeaders: hdrs || null,
                  });
                }
              });

              (runSteps || []).forEach((step, sIdx) => {
                if (step.ChildCount !== undefined) {
                  const rawStepId = step.StepId || step.ModelStepId || `Step_${sIdx + 1}`;
                  const baseShapeId = (step.ModelStepId || (step.StepId ? step.StepId.split("#")[0] : "") || "").trim();
                  const humanName = stepNamesMap[baseShapeId] || stepNamesMap[baseShapeId.toLowerCase()] || stepNamesMap[rawStepId];
                  const traceCount = step.TraceCount !== undefined && step.TraceCount !== null ? Number(step.TraceCount) : null;
                  const traceInfo = runTraceMap.get(Number(step.ChildCount));

                  const stepRecord = {
                    childCount: step.ChildCount,
                    stepId: rawStepId,
                    stepName: humanName || baseShapeId || rawStepId,
                    activity: step.Activity || "",
                    status: step.Status || "COMPLETED",
                    traceCount: traceCount !== null ? traceCount : 0,
                    properties: null,
                    headers: null,
                    body: null,
                  };

                  runRecord.steps.push(stepRecord);

                  // Only queue for downloading if trace is present or unknown
                  if (traceCount === null || traceCount > 0 || traceInfo) {
                    allStepJobs.push({
                      runId,
                      childCount: step.ChildCount,
                      preResolvedTraceId: traceInfo?.traceId || null,
                      prefetchedProperties: traceInfo?.prefetchedProperties || null,
                      prefetchedHeaders: traceInfo?.prefetchedHeaders || null,
                      stepRef: stepRecord,
                    });
                  }
                }
              });
            }
          } catch (eRuns) {}
        }

        flowRecord.runs[rIdx] = runRecord;
      }));

      traceData.flows[flowId] = flowRecord;
      processedFlows++;
      reportProgress(processedFlows, totalNodes, `Loaded flow models (${processedFlows}/${totalNodes})...`);
    });

    // 3. Harvest step payloads concurrently with high-throughput 24-worker pool & memory safety
    const MAX_PAYLOAD_CHARS = 2 * 1024 * 1024; // 2 MB string threshold per step
    const totalSteps = allStepJobs.length;
    let completedSteps = 0;

    if (totalSteps > 0 && api) {
      reportProgress(0, totalSteps, `Downloading step traces (0/${totalSteps})...`);

      await this.asyncPool(24, allStepJobs, async (job) => {
        try {
          let traceId = job.preResolvedTraceId;

          // If not already resolved in batch, fetch trace message for this step
          if (!traceId) {
            const traceMessages = await api.fetchStepTraceMessages(job.runId, job.childCount);
            if (traceMessages && traceMessages.length > 0) {
              traceId = traceMessages[0].TraceId;
            }
          }

          if (traceId) {
            const propsPromise = job.prefetchedProperties
              ? Promise.resolve(job.prefetchedProperties)
              : api.fetchStepExchangeProperties(traceId).catch(() => []);

            const headersPromise = job.prefetchedHeaders
              ? Promise.resolve(job.prefetchedHeaders)
              : api.fetchStepHeaders(traceId).catch(() => []);

            const bodyPromise = api.fetchStepBodyPayload(traceId, "text").catch((e) => `[Payload read error: ${e?.message || e}]`);

            const [props, headers, rawBody] = await Promise.all([propsPromise, headersPromise, bodyPromise]);

            job.stepRef.properties = props || [];
            job.stepRef.headers = headers || [];

            let safeBody = rawBody || "";
            if (typeof safeBody === "string" && safeBody.length > MAX_PAYLOAD_CHARS) {
              const originalMb = (safeBody.length / (1024 * 1024)).toFixed(2);
              safeBody = safeBody.substring(0, MAX_PAYLOAD_CHARS) +
                `\n\n--- [Payload truncated by Commondo IS Debugger: size exceeded 2MB limit (Original: ${originalMb} MB). Full payload available in SAP CPI Message Monitor] ---`;
            }
            job.stepRef.body = safeBody;
          }
        } catch (eStep) {
        } finally {
          completedSteps++;
          reportProgress(completedSteps, totalSteps, `Downloading step traces (${completedSteps}/${totalSteps})...`);
        }
      });
    }

    reportProgress(totalSteps, totalSteps, "Generating standalone offline viewer...");

    // 4. Generate topology.json & trace_data.json
    const topologyJson = JSON.stringify(traceData.topology, null, 2);
    const traceDataJson = JSON.stringify(traceData, null, 2);

    zip.file("trace_data.json", traceDataJson);
    zip.file("topology.json", topologyJson);

    // 5. Generate self-contained viewer.html from external template
    const viewerHtml = await this.generateViewerHtml(traceData);
    zip.file("viewer.html", viewerHtml);

    reportProgress(totalSteps, totalSteps, "Compressing ZIP package...");

    // Generate ZIP blob (Deflate level 6 for optimal compression of consolidated JSON)
    const zipBlob = await zip.generateAsync({
      type: "blob",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });

    // Trigger instant browser download
    const filename = `Commondo_Trace_${rootFlowId}_${Date.now()}.zip`;
    let downloadUrl = "";
    if (typeof URL !== "undefined" && URL.createObjectURL) {
      downloadUrl = URL.createObjectURL(zipBlob);
    }

    if (typeof document !== "undefined" && document.body && downloadUrl) {
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = filename;
      document.body.appendChild(link);
      if (typeof link.click === "function") {
        link.click();
      }
      setTimeout(() => {
        if (typeof URL !== "undefined" && URL.revokeObjectURL) {
          URL.revokeObjectURL(downloadUrl);
        }
        if (typeof link.remove === "function") {
          link.remove();
        }
      }, 2000);
    }

    return { filename, size: zipBlob.size };
  },

  templateCache: null,

  /**
   * Loads the standalone viewer.html template from resources.
   * Cached after first fetch for maximum performance.
   */
  async getViewerTemplateHtml() {
    if (this.templateCache) {
      return this.templateCache;
    }

    // 1. Chrome Extension runtime loader
    if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
      try {
        const templateUrl = chrome.runtime.getURL("plugins/commondoDebugger/resources/viewer.html");
        const resp = await fetch(templateUrl);
        if (resp.ok) {
          this.templateCache = await resp.text();
          return this.templateCache;
        }
      } catch (e) {}
    }

    // 2. Node.js environment loader (for test suites)
    if (typeof require !== "undefined") {
      try {
        const fs = require("fs");
        const path = require("path");
        const candidates = [
          path.resolve(__dirname, "../resources/viewer.html"),
          path.resolve(__dirname, "resources/viewer.html"),
          path.resolve(process.cwd(), "CPI-Helper-Chrome-Extension/plugins/commondoDebugger/resources/viewer.html"),
          path.resolve(process.cwd(), "plugins/commondoDebugger/resources/viewer.html"),
          path.resolve(__dirname, "../../CPI-Helper-Chrome-Extension/plugins/commondoDebugger/resources/viewer.html"),
        ];
        for (const p of candidates) {
          if (fs.existsSync(p)) {
            this.templateCache = fs.readFileSync(p, "utf8");
            return this.templateCache;
          }
        }
      } catch (e) {}
    }

    return "";
  },

  /**
   * Injects trace data into the standalone viewer.html template.
   * Runs locally in any browser with 0 external network dependencies.
   */
  async generateViewerHtml(traceData) {
    const safeJson = JSON.stringify(traceData).replace(/<\/script>/gi, "<\\/script>");
    const template = await this.getViewerTemplateHtml();

    if (template && template.includes("/* __EMBEDDED_TRACE_DATA__ */")) {
      return template.split("/* __EMBEDDED_TRACE_DATA__ */").join(safeJson);
    }

    if (template && template.includes('<script id="trace-data" type="application/json">')) {
      return template.split('<script id="trace-data" type="application/json">').join(
        `<script id="trace-data" type="application/json">\n${safeJson}`
      );
    }

    // Fallback minimal wrapper if template file could not be read
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Commondo Trace Viewer</title></head><body><script id="trace-data" type="application/json">${safeJson}</script><p>Commondo Trace Archive. Please open in Commondo IS Debugger or extract JSON.</p></body></html>`;
  },
};

// Expose globally
if (typeof window !== "undefined") {
  window.CmdZipExportService = CmdZipExportService;
}
if (typeof global !== "undefined") {
  global.CmdZipExportService = CmdZipExportService;
}
