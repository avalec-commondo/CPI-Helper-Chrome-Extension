// ===========================================================================
// COMMODNO IS DEBUGGER - ZIP EXPORT HELPER
// ===========================================================================
// Exports full multi-level trace payloads, exchange properties, headers, and manifests
// into a standardized ZIP archive for offline debugging and team sharing.

const CmdZipExportHelper = {
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
    if (downloadBtn) {
      downloadBtn.innerHTML = `<i class="spinner loading icon"></i> Packaging...`;
      downloadBtn.disabled = true;
    }

    const getApi = (typeof CmdCpiApiHelper !== "undefined" && CmdCpiApiHelper.getApiUrl) ? CmdCpiApiHelper.getApiUrl : window.getApiUrl;

    try {
      const rootLog = logs[0] || {};
      const rootFlowName = (rootLog.IntegrationFlowName || rootLog.IntegrationArtifact?.Id || rootLog.MessageGuid || "iFlow").replace(/[^a-zA-Z0-9_-]/g, "_");

      const zip = new JSZip();
      const rootFolder = zip.folder("Commondo_Trace_Package");

      rootFolder.file("manifest.json", JSON.stringify(logs, null, 2));

      for (let i = 0; i < logs.length; i++) {
        const log = logs[i];
        const safeName = (log.IntegrationFlowName || log.IntegrationArtifact?.Id || log.MessageGuid || "iFlow").replace(/[^a-zA-Z0-9_-]/g, "_");
        const folderName = `${i + 1}_${safeName}`;
        const iflowFolder = rootFolder.folder(folderName);

        iflowFolder.file("log_info.json", JSON.stringify(log, null, 2));

        try {
          let steps = log.__steps || [];
          let runId = log.__runId || null;

          if (steps.length === 0 || !runId) {
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
          }

          iflowFolder.file("steps_summary.json", JSON.stringify(steps, null, 2));

          for (let s = 0; s < steps.length; s++) {
            const step = steps[s];
            const childCount = step.ChildCount || s + 1;
            const stepName = (step.StepId || step.ModelStepId || `Step_${s + 1}`).replace(/[^a-zA-Z0-9_-]/g, "_");
            const stepPrefix = `Step_${s + 1}_${stepName}`;

            try {
              const traceMsgUrl = getApi(`MessageProcessingLogRunSteps(RunId='${runId}',ChildCount=${childCount})/TraceMessages?$format=json`);
              const rawTraceData = await makeCallPromise("GET", traceMsgUrl, false);
              const traceData = (typeof rawTraceData === "string" ? JSON.parse(rawTraceData) : rawTraceData)?.d?.results || [];

              if (traceData.length > 0) {
                traceData.sort((a, b) => Number(a.TraceId) - Number(b.TraceId));
                const traceId = traceData[0].TraceId;

                // 1. Properties
                try {
                  const propsUrl = getApi(`TraceMessages(${traceId})/ExchangeProperties?$format=json`);
                  const rawP = await makeCallPromise("GET", encodeURI(propsUrl), false);
                  const resP = typeof rawP === "string" ? JSON.parse(rawP) : rawP;
                  if (resP.d && resP.d.results) {
                    iflowFolder.file(`${stepPrefix}_properties.json`, JSON.stringify(resP.d.results, null, 2));
                  }
                } catch (eP) {}

                // 2. Headers
                try {
                  const headersUrl = getApi(`TraceMessages(${traceId})/Properties?$format=json`);
                  const rawH = await makeCallPromise("GET", encodeURI(headersUrl), false);
                  const resH = typeof rawH === "string" ? JSON.parse(rawH) : rawH;
                  if (resH.d && resH.d.results) {
                    iflowFolder.file(`${stepPrefix}_headers.json`, JSON.stringify(resH.d.results, null, 2));
                  }
                } catch (eH) {}

                // 3. Body
                try {
                  const bodyUrl = getApi(`TraceMessages(${traceId})/$value`);
                  const rawBody = await makeCallPromise("GET", bodyUrl, false);
                  if (typeof rawBody === "string" && rawBody.length > 0) {
                    iflowFolder.file(`${stepPrefix}_body.txt`, rawBody);
                  }
                } catch (eB) {}
              }
            } catch (eTraceMsg) {}
          }
        } catch (errIFlow) {
          console.warn(`Error fetching steps for ${log.IntegrationFlowName}:`, errIFlow);
        }
      }

      const content = await zip.generateAsync({ type: "blob" });
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

