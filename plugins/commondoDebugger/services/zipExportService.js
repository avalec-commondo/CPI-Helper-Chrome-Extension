// ===========================================================================
// COMMNDO IS DEBUGGER - ZIP EXPORT SERVICE (CmdZipExportService)
// ===========================================================================
// Asynchronous, concurrency-pooled JSZip archive generator for full trace packages.

const CmdZipExportService = {
  /**
   * Bounded async worker pool to limit parallel HTTP requests.
   */
  async asyncPool(poolLimit, array, iteratorFn) {
    const ret = [];
    const executing = [];
    for (const item of array) {
      const p = Promise.resolve().then(() => iteratorFn(item, array));
      ret.push(p);
      if (poolLimit <= array.length) {
        const e = p.then(() => executing.splice(executing.indexOf(e), 1));
        executing.push(e);
        if (executing.length >= poolLimit) {
          await Promise.race(executing);
        }
      }
    }
    return Promise.all(ret);
  },

  /**
   * Exports full multi-flow trace package as a downloaded .zip file.
   * @param {Object} topologyData - Discovery topology ({ nodes, edges, rootFlowId })
   * @param {Function} onProgress - Progress callback (completed, total, statusText)
   */
  async exportTracePackage(topologyData, onProgress = null) {
    if (typeof JSZip === "undefined") {
      throw new Error("JSZip library is not loaded.");
    }

    const api = typeof CmdApiClient !== "undefined" ? CmdApiClient : null;
    const bpmnService = typeof CmdBpmnParserService !== "undefined" ? CmdBpmnParserService : null;
    const traceService = typeof CmdTraceService !== "undefined" ? CmdTraceService : null;
    const utils = typeof CmdUtils !== "undefined" ? CmdUtils : null;

    if (!topologyData || !topologyData.nodes || topologyData.nodes.length === 0) {
      throw new Error("No trace topology data to export.");
    }

    const rootFlowId = topologyData.rootFlowId || topologyData.nodes[0].id;
    const zip = new JSZip();
    const pkgFolder = zip.folder("Commondo_Trace_Package");

    const totalNodes = topologyData.nodes.length;
    let completedSteps = 0;
    const estimatedTotal = totalNodes * 10;

    function reportProgress(stepName) {
      completedSteps++;
      if (typeof onProgress === "function") {
        onProgress(completedSteps, Math.max(completedSteps, estimatedTotal), stepName);
      }
    }

    reportProgress("Creating package manifest...");

    // 1. Manifest
    const manifest = {
      version: "2.0",
      generator: "Commondo IS Debugger (Modular Refactor)",
      exportTimestamp: new Date().toISOString(),
      tenantHost: api ? api.getTenantHost() : "",
      rootFlowId,
      totalFlows: totalNodes,
      nodes: topologyData.nodes.map((n) => ({
        id: n.id,
        name: n.name,
        level: n.level,
        status: n.status,
        totalDuration: n.totalDuration,
        runsCount: n.runsCount,
      })),
      edges: topologyData.edges || [],
    };
    pkgFolder.file("manifest.json", JSON.stringify(manifest, null, 2));

    // 2. Process each flow
    for (const node of topologyData.nodes) {
      const flowId = node.id;
      const flowFolder = pkgFolder.folder(flowId);

      reportProgress(`Fetching BPMN & logs for ${node.name || flowId}...`);

      // BPMN Model & step names
      const bpmnModel = bpmnService ? await bpmnService.getModel(flowId) : { steps: {} };
      const stepNamesMap = bpmnModel.steps || {};

      // Flow Log Info
      const logInfo = {
        iflowId: flowId,
        flowName: node.name || flowId,
        description: node.description || "",
        status: node.status,
        totalDuration: node.totalDuration,
        totalRuns: node.runsCount,
        runs: node.runs || [],
        hangingOutbounds: node.hanging || [],
      };
      flowFolder.file("log_info.json", JSON.stringify(logInfo, null, 2));

      // Harvest steps for primary run
      const primaryRun = node.runs?.[0];
      if (primaryRun && primaryRun.MessageGuid && api) {
        const messageGuid = primaryRun.MessageGuid;
        const runs = await api.fetchMessageRuns(messageGuid);

        if (runs.length > 0) {
          const runId = runs[0].Id;
          const runSteps = await api.fetchRunSteps(runId);

          const stepsSummary = runSteps.map((s) => ({
            stepId: s.StepId,
            stepName: stepNamesMap[s.StepId] || stepNamesMap[(s.StepId || "").toLowerCase()] || s.StepId,
            activity: s.Activity,
            status: s.Status,
            traceCount: s.TraceCount,
            childCount: s.ChildCount,
          }));
          flowFolder.file("steps_summary.json", JSON.stringify(stepsSummary, null, 2));

          const stepsFolder = flowFolder.folder("steps");

          // Harvest step payloads with worker pool limit 8
          await this.asyncPool(8, runSteps, async (step) => {
            if (step.ChildCount !== undefined) {
              try {
                const traceMessages = await api.fetchStepTraceMessages(runId, step.ChildCount);
                if (traceMessages.length > 0) {
                  const traceId = traceMessages[0].TraceId;
                  const stepPrefix = `${String(step.ChildCount).padStart(3, "0")}_${step.StepId}`;

                  const [props, headers, body] = await Promise.all([
                    api.fetchStepExchangeProperties(traceId),
                    api.fetchStepHeaders(traceId),
                    api.fetchStepBodyPayload(traceId, "text"),
                  ]);

                  if (props && props.length > 0) {
                    stepsFolder.file(`${stepPrefix}_properties.json`, JSON.stringify(props, null, 2));
                  }
                  if (headers && headers.length > 0) {
                    stepsFolder.file(`${stepPrefix}_headers.json`, JSON.stringify(headers, null, 2));
                  }
                  if (body) {
                    stepsFolder.file(`${stepPrefix}_body.txt`, body);
                  }
                }
              } catch (eStep) {}
            }
          });
        }
      }
    }

    reportProgress("Compressing ZIP archive...");

    // Generate ZIP blob (Deflate level 1 for instant compression)
    const zipBlob = await zip.generateAsync({
      type: "blob",
      compression: "DEFLATE",
      compressionOptions: { level: 1 },
    });

    // Trigger instant browser download
    const filename = `Commondo_Trace_${rootFlowId}_${Date.now()}.zip`;
    const downloadUrl = URL.createObjectURL(zipBlob);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      URL.revokeObjectURL(downloadUrl);
      link.remove();
    }, 2000);

    return { filename, size: zipBlob.size };
  },
};

// Expose globally
if (typeof window !== "undefined") {
  window.CmdZipExportService = CmdZipExportService;
}
if (typeof global !== "undefined") {
  global.CmdZipExportService = CmdZipExportService;
}
