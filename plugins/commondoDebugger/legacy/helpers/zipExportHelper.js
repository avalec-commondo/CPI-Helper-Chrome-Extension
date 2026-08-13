// ===========================================================================
// COMMODNO IS DEBUGGER - ZIP EXPORT HELPER (HIGH-PERFORMANCE PARALLEL ENGINE)
// ===========================================================================
// Exports full multi-level trace payloads, exchange properties, headers, and manifests
// into a standardized ZIP archive for offline debugging and team sharing.
// Optimized with parallel concurrency pooling (6-8 workers), Promise.all payload batching,
// and real-time step progress tracking.

const CmdZipExportHelper = {
  /**
   * Concurrency runner that executes tasks with a bounded parallel pool limit.
   */
  async asyncPool(concurrencyLimit, items, asyncWorkerFn) {
    const activePromises = new Set();
    for (const item of items) {
      const p = Promise.resolve().then(() => asyncWorkerFn(item));
      activePromises.add(p);
      const clean = () => activePromises.delete(p);
      p.then(clean, clean);
      if (activePromises.size >= concurrencyLimit) {
        await Promise.race(activePromises);
      }
    }
    return Promise.all(activePromises);
  },

  /**
   * Bundles all trace data across all flows into a downloadable ZIP archive.
   */
  async exportAllTracesAsZip(logs, pluginHelper = null) {
    if (typeof JSZip === "undefined") {
      alert("JSZip library is not loaded. Cannot export trace archive.");
      return;
    }

    if (!logs || logs.length === 0) {
      alert("No execution logs available to export.");
      return;
    }

    const downloadBtn = document.getElementById("cmd-modal-export-zip-btn");
    const setBtnProgress = (text) => {
      if (downloadBtn) downloadBtn.innerHTML = `<i class="spinner loading icon"></i> ${text}`;
    };

    if (downloadBtn) {
      downloadBtn.disabled = true;
      setBtnProgress("Preparing...");
    }

    const getApi = (typeof CmdCpiApiHelper !== "undefined" && CmdCpiApiHelper.getApiUrl) ? CmdCpiApiHelper.getApiUrl : window.getApiUrl;

    try {
      const rootLog = logs[0] || {};
      const rootFlowName = (rootLog.IntegrationFlowName || rootLog.IntegrationArtifact?.Id || rootLog.MessageGuid || "iFlow").replace(/[^a-zA-Z0-9_-]/g, "_");

      const zip = new JSZip();
      const rootFolder = zip.folder("Commondo_Trace_Package");

      rootFolder.file("manifest.json", JSON.stringify(logs, null, 2));

      // 1. Pre-fetch step lists and BPMN models for all flows concurrently
      setBtnProgress("Fetching flow steps...");
      const flowTasks = [];

      for (let i = 0; i < logs.length; i++) {
        const log = logs[i];
        const safeName = (log.IntegrationFlowName || log.IntegrationArtifact?.Id || log.MessageGuid || "iFlow").replace(/[^a-zA-Z0-9_-]/g, "_");
        const folderName = `${i + 1}_${safeName}`;
        const iflowFolder = rootFolder.folder(folderName);
        iflowFolder.file("log_info.json", JSON.stringify(log, null, 2));

        const iFlowId = log.IntegrationArtifact?.Id || log.IntegrationFlowName || "";

        flowTasks.push(async () => {
          let steps = log.__steps || [];
          let runId = log.__runId || null;

          // Fetch run steps if not already cached
          if (steps.length === 0 || !runId) {
            try {
              const runsUrl = getApi(`MessageProcessingLogs('${log.MessageGuid}')/Runs?$format=json`);
              const rawRuns = await makeCallPromise("GET", encodeURI(runsUrl), false);
              const runsRes = typeof rawRuns === "string" ? JSON.parse(rawRuns) : rawRuns;

              if (runsRes.d && runsRes.d.results && runsRes.d.results.length > 0) {
                runId = runsRes.d.results[0].Id;
                log.__runId = runId;
                const stepsUrl = getApi(`MessageProcessingLogRuns('${runId}')/RunSteps?$format=json&$top=300`);
                const rawSteps = await makeCallPromise("GET", encodeURI(stepsUrl), false);
                const stepsRes = typeof rawSteps === "string" ? JSON.parse(rawSteps) : rawSteps;
                steps = stepsRes.d && stepsRes.d.results ? stepsRes.d.results : [];
                log.__steps = steps;
              }
            } catch (eSteps) {
              console.warn(`Could not load steps for flow ${log.IntegrationFlowName}:`, eSteps);
            }
          }

          iflowFolder.file("steps_summary.json", JSON.stringify(steps, null, 2));

          // Fetch step name map from BPMN model
          let stepNameMap = {};
          if (typeof CmdBpmnModelHelper !== "undefined") {
            const cachedModel = CmdBpmnModelHelper.getBpmnModelFromCache ? CmdBpmnModelHelper.getBpmnModelFromCache(iFlowId) : null;
            if (cachedModel) {
              stepNameMap = cachedModel.steps || {};
            } else if (CmdBpmnModelHelper.fetchIFlowBpmnModel && iFlowId) {
              try {
                const fetchedModel = await CmdBpmnModelHelper.fetchIFlowBpmnModel(iFlowId);
                stepNameMap = fetchedModel?.steps || {};
              } catch (eM) {}
            }
          }

          return { log, runId, steps, iflowFolder, stepNameMap };
        });
      }

      const flowStepDataList = await Promise.all(flowTasks.map((fn) => fn()));

      // 2. Flatten all step payload download tasks across all flows
      const allStepJobs = [];
      flowStepDataList.forEach(({ log, runId, steps, iflowFolder, stepNameMap }) => {
        if (!runId || !steps || steps.length === 0) return;

        steps.forEach((step, sIdx) => {
          const childCount = step.ChildCount || sIdx + 1;
          const rawStepId = step.StepId || step.ModelStepId || `Step_${sIdx + 1}`;
          const baseShapeId = (step.ModelStepId || (step.StepId ? step.StepId.split("#")[0] : "") || "").trim();
          const humanName = stepNameMap[baseShapeId] || stepNameMap[baseShapeId.toLowerCase()] || stepNameMap[rawStepId];
          const cleanName = (humanName || baseShapeId || rawStepId).replace(/[^a-zA-Z0-9_-]/g, "_");
          const stepPrefix = `Step_${sIdx + 1}_${cleanName}`;

          allStepJobs.push({
            runId,
            childCount,
            stepPrefix,
            iflowFolder,
          });
        });
      });

      const totalSteps = allStepJobs.length;
      let completedSteps = 0;

      if (totalSteps > 0) {
        setBtnProgress(`Packaging (0/${totalSteps})...`);

        // 3. Process step payload downloads in parallel with a bounded concurrency pool (8 parallel streams)
        await this.asyncPool(8, allStepJobs, async (job) => {
          try {
            const traceMsgUrl = getApi(`MessageProcessingLogRunSteps(RunId='${job.runId}',ChildCount=${job.childCount})/TraceMessages?$format=json`);
            const rawTraceData = await makeCallPromise("GET", traceMsgUrl, false);
            const traceData = (typeof rawTraceData === "string" ? JSON.parse(rawTraceData) : rawTraceData)?.d?.results || [];

            if (traceData.length > 0) {
              traceData.sort((a, b) => Number(a.TraceId) - Number(b.TraceId));
              const traceId = traceData[0].TraceId;

              // Fetch Properties, Headers, and Body in PARALLEL for this step
              const propsUrl = getApi(`TraceMessages(${traceId})/ExchangeProperties?$format=json`);
              const headersUrl = getApi(`TraceMessages(${traceId})/Properties?$format=json`);
              const bodyUrl = getApi(`TraceMessages(${traceId})/$value`);

              const [rawP, rawH, rawBody] = await Promise.all([
                makeCallPromise("GET", encodeURI(propsUrl), false).catch(() => null),
                makeCallPromise("GET", encodeURI(headersUrl), false).catch(() => null),
                makeCallPromise("GET", bodyUrl, false).catch(() => null),
              ]);

              if (rawP) {
                const resP = typeof rawP === "string" ? JSON.parse(rawP) : rawP;
                if (resP?.d?.results) {
                  job.iflowFolder.file(`${job.stepPrefix}_properties.json`, JSON.stringify(resP.d.results, null, 2));
                }
              }

              if (rawH) {
                const resH = typeof rawH === "string" ? JSON.parse(rawH) : rawH;
                if (resH?.d?.results) {
                  job.iflowFolder.file(`${job.stepPrefix}_headers.json`, JSON.stringify(resH.d.results, null, 2));
                }
              }

              if (rawBody && typeof rawBody === "string" && rawBody.length > 0) {
                job.iflowFolder.file(`${job.stepPrefix}_body.txt`, rawBody);
              }
            }
          } catch (eStep) {
            console.warn(`Error capturing payload for ${job.stepPrefix}:`, eStep);
          } finally {
            completedSteps++;
            setBtnProgress(`Packaging (${completedSteps}/${totalSteps})...`);
          }
        });
      }

      // 4. Generate ZIP archive using fast DEFLATE level 1 (compresses in ~50ms without freezing)
      setBtnProgress("Compressing ZIP...");
      const content = await zip.generateAsync({
        type: "blob",
        compression: "DEFLATE",
        compressionOptions: { level: 1 },
      });

      const a = document.createElement("a");
      a.href = URL.createObjectURL(content);
      a.download = `Commondo_Full_Trace_${rootFlowName}_${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      alert("Error creating ZIP archive: " + err.message);
    } finally {
      if (downloadBtn) {
        downloadBtn.innerHTML = `<i class="download icon"></i> Export Traces (ZIP)`;
        downloadBtn.disabled = false;
      }
    }
  },
};

// Expose to window namespace
if (typeof window !== "undefined") {
  window.CmdZipExportHelper = CmdZipExportHelper;
}

