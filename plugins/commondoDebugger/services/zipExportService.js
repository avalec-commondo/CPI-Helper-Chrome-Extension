// ===========================================================================
// COMMNDO IS DEBUGGER - ZIP EXPORT SERVICE (CmdZipExportService)
// ===========================================================================
// Asynchronous, concurrency-pooled JSZip archive generator for full trace packages.

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

    function reportProgress(completed, total, stepText) {
      if (typeof onProgress === "function") {
        onProgress(completed, total, stepText);
      }
    }

    reportProgress(0, totalNodes, "Creating package manifest...");

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

    // 2. Pre-process each flow and collect step download jobs
    reportProgress(0, totalNodes, "Fetching flow step definitions...");
    const allStepJobs = [];

    for (let fIdx = 0; fIdx < topologyData.nodes.length; fIdx++) {
      const node = topologyData.nodes[fIdx];
      const flowId = node.id;
      const flowFolder = pkgFolder.folder(flowId);

      reportProgress(fIdx + 1, totalNodes, `Loading flow structure (${fIdx + 1}/${totalNodes})...`);

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

      // Harvest steps for all runs
      const flowRuns = (node.runs && node.runs.length > 0) ? node.runs : [];
      const isMultiRun = flowRuns.length > 1;

      for (let rIdx = 0; rIdx < flowRuns.length; rIdx++) {
        const run = flowRuns[rIdx];
        const messageGuid = run.MessageGuid || run.Id || run.MessageId;
        if (!messageGuid || !api) continue;

        // Dedicated target folder for this run
        const targetFolder = isMultiRun
          ? flowFolder.folder(`Run_${String(rIdx + 1).padStart(2, "0")}`)
          : flowFolder;

        // If this specific run failed or flow is failed
        if (run.Status === "FAILED" || run.Status === "ESCALATED" || node.status === "FAILED") {
          try {
            const errText = await api.fetchErrorInformation(messageGuid);
            if (errText) {
              targetFolder.file("error_information.txt", errText);
            }
          } catch (eErr) {}
        }

        try {
          const runs = await api.fetchMessageRuns(messageGuid);
          if (runs && runs.length > 0) {
            const runId = runs[0].Id;
            const runSteps = await api.fetchRunSteps(runId);

            const stepsSummary = (runSteps || []).map((s) => ({
              stepId: s.StepId,
              stepName: stepNamesMap[s.StepId] || stepNamesMap[(s.StepId || "").toLowerCase()] || s.StepId,
              activity: s.Activity,
              status: s.Status,
              traceCount: s.TraceCount,
              childCount: s.ChildCount,
            }));
            targetFolder.file("steps_summary.json", JSON.stringify(stepsSummary, null, 2));

            const stepsFolder = targetFolder.folder("steps");

            (runSteps || []).forEach((step, sIdx) => {
              if (step.ChildCount !== undefined) {
                const rawStepId = step.StepId || step.ModelStepId || `Step_${sIdx + 1}`;
                const baseShapeId = (step.ModelStepId || (step.StepId ? step.StepId.split("#")[0] : "") || "").trim();
                const humanName = stepNamesMap[baseShapeId] || stepNamesMap[baseShapeId.toLowerCase()] || stepNamesMap[rawStepId];
                const cleanName = (humanName || baseShapeId || rawStepId).replace(/[^a-zA-Z0-9_-]/g, "_");
                const stepPrefix = `${String(step.ChildCount).padStart(3, "0")}_${cleanName}`;

                allStepJobs.push({
                  runId,
                  childCount: step.ChildCount,
                  stepPrefix,
                  stepsFolder,
                });
              }
            });
          }
        } catch (eRuns) {}
      }
    }

    // 3. Harvest step payloads concurrently with live progress tracking
    const totalSteps = allStepJobs.length;
    let completedSteps = 0;

    if (totalSteps > 0) {
      reportProgress(0, totalSteps, `Packaging (0/${totalSteps})...`);

      await this.asyncPool(8, allStepJobs, async (job) => {
        try {
          const traceMessages = await api.fetchStepTraceMessages(job.runId, job.childCount);
          if (traceMessages.length > 0) {
            const traceId = traceMessages[0].TraceId;

            const [props, headers, body] = await Promise.all([
              api.fetchStepExchangeProperties(traceId),
              api.fetchStepHeaders(traceId),
              api.fetchStepBodyPayload(traceId, "text"),
            ]);

            if (props && props.length > 0) {
              job.stepsFolder.file(`${job.stepPrefix}_properties.json`, JSON.stringify(props, null, 2));
            }
            if (headers && headers.length > 0) {
              job.stepsFolder.file(`${job.stepPrefix}_headers.json`, JSON.stringify(headers, null, 2));
            }
            if (body) {
              job.stepsFolder.file(`${job.stepPrefix}_body.txt`, body);
            }
          }
        } catch (eStep) {} finally {
          completedSteps++;
          reportProgress(completedSteps, totalSteps, `Packaging (${completedSteps}/${totalSteps})...`);
        }
      });
    }

    reportProgress(totalSteps, totalSteps, "Compressing ZIP...");

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
