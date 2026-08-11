// ===========================================================================
// COMMODNO IS DEBUGGER - DEBUGGER MODAL FEATURE
// ===========================================================================
// Assembles and manages the main multi-tier trace inspection modal dialog,
// live OData correlation log loading, and internal countdown timers.

const CmdDebuggerModal = {
  state: {
    logs: [],
    selectedLog: null,
    countdownInterval: null,
  },

  /**
   * Starts or updates the live 10-minute TRACE countdown timer inside the modal.
   */
  startTraceCountdownTimer(statusMsg, successCount, totalCount, activatedAt = Date.now()) {
    if (this.state.countdownInterval) {
      clearInterval(this.state.countdownInterval);
      this.state.countdownInterval = null;
    }

    const updateCountdown = () => {
      const elapsedMs = Date.now() - activatedAt;
      const remainingMs = Math.max(0, 10 * 60 * 1000 - elapsedMs);
      const totalSec = Math.floor(remainingMs / 1000);
      const mins = Math.floor(totalSec / 60);
      const secs = totalSec % 60;
      const formatted = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;

      if (!statusMsg || !document.body.contains(statusMsg)) {
        if (CmdDebuggerModal.state.countdownInterval) {
          clearInterval(CmdDebuggerModal.state.countdownInterval);
          CmdDebuggerModal.state.countdownInterval = null;
        }
        return;
      }

      if (remainingMs > 0) {
        statusMsg.innerHTML = `
          <span style="color: #10b981; font-weight: 600;">Activated TRACE on ${successCount}/${totalCount} iFlows</span>
          <span style="display: inline-flex; align-items: center; gap: 4px; background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; border-radius: 12px; padding: 2px 8px; font-family: monospace; font-size: 0.8rem; font-weight: bold; margin-left: 8px;">
            <i class="clock outline icon" style="margin: 0; color: #059669;"></i> ${formatted}
          </span>
        `;
      } else {
        statusMsg.innerHTML = `
          <span style="color: #64748b; font-weight: 600;">TRACE Expired</span>
          <span style="display: inline-flex; align-items: center; gap: 4px; background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; border-radius: 12px; padding: 2px 8px; font-family: monospace; font-size: 0.8rem; font-weight: bold; margin-left: 8px;">
            00:00
          </span>
        `;
        if (CmdDebuggerModal.state.countdownInterval) {
          clearInterval(CmdDebuggerModal.state.countdownInterval);
          CmdDebuggerModal.state.countdownInterval = null;
        }
      }
    };

    updateCountdown();
    this.state.countdownInterval = setInterval(updateCountdown, 1000);
  },

  /**
   * Checks Chrome storage to see if TRACE was recently activated and starts countdown.
   */
  async checkExistingTraceStatus(statusMsg) {
    try {
      const rootFlow = (typeof cpiData !== "undefined" && cpiData.integrationFlowId) ? cpiData.integrationFlowId : "";
      const locId = (typeof cpiData !== "undefined" && cpiData.runtimeLocationId) ? cpiData.runtimeLocationId : "cloudintegration";
      if (!rootFlow) return;

      if (typeof storageGetPromise === "function") {
        const stored = await storageGetPromise(`${rootFlow}_${locId}_powertraceLastRefresh`);
        if (stored) {
          const lastTime = Number(stored);
          const elapsed = Date.now() - lastTime;
          if (elapsed < 10 * 60 * 1000) {
            this.startTraceCountdownTimer(statusMsg, 1, 1, lastTime);
          }
        }
      }
    } catch (e) {}
  },

  /**
   * Assembles and displays the debugger modal dialog.
   */
  async openModal(runInfo = null, pluginHelper = null) {
    let modal = document.querySelector("#cmd-debugger-modal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "cmd-debugger-modal";
      modal.className = "ui modal";
      modal.style.cssText = "width: 92vw !important; max-width: 1400px !important; border-radius: 8px; overflow: hidden;";

      modal.innerHTML = `
        <div class="header" style="display: flex; justify-content: space-between; align-items: center; background: #f8fafc; padding: 14px 20px; border-bottom: 1px solid #e2e8f0;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 1.15rem; font-weight: bold; color: #1e293b;">Commondo IS Debugger</span>
          </div>
          <div style="display: flex; align-items: center; gap: 10px;">
            <button id="cmd-modal-export-zip-btn" class="ui mini teal button">Export Traces (ZIP)</button>
            <i class="close icon cmd-modal-close" style="cursor: pointer; font-size: 1.2rem; color: #64748b;"></i>
          </div>
        </div>

        <div class="content" style="padding: 16px; background: #ffffff; max-height: 80vh; overflow: hidden; display: flex; flex-direction: column;">
          <!-- Scope Selection & Action Header -->
          <div class="ui segment" style="margin-bottom: 16px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px;">
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
              <div style="display: flex; align-items: center; gap: 12px;">
                <span style="font-weight: 600; color: #334155; font-size: 0.9rem;">Trace Scope:</span>
                <select id="cmd-flow-scope-select" class="ui compact dropdown" style="padding: 6px 10px; font-size: 0.85rem; border-radius: 4px; border: 1px solid #cbd5e1;">
                  <option value="topology" selected>Discovered Topology (Root + Children)</option>
                  <option value="package">Current Package iFlows</option>
                  <option value="current">Current iFlow Only</option>
                  <option value="all">All Deployed Tenant iFlows</option>
                </select>
                <button id="cmd-activate-trace-btn" class="ui mini primary button" style="font-weight: bold;">
                  Set TRACE
                </button>
                <button id="cmd-run-test-pd-btn" class="ui mini teal basic button" style="font-weight: bold;">
                  Test PD Discovery
                </button>
              </div>

              <div id="cmd-trace-status-message" style="font-size: 0.85rem; color: #64748b;">Ready</div>
            </div>
          </div>

          <!-- Main Layout Grid -->
          <div class="ui grid" style="margin: 0; flex: 1; min-height: 0;">
            <!-- Left Panel: Interactive Topology Map -->
            <div class="nine wide column" style="padding-left: 0; padding-right: 8px;">
              <div class="ui segment" style="height: 100%; padding: 0; border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden; display: flex; flex-direction: column;">
                <div style="padding: 10px 14px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; font-weight: 600; font-size: 0.9rem; color: #334155; display: flex; justify-content: space-between; align-items: center;">
                  <span>Interactive Topology Execution Map</span>
                  <span style="font-size: 0.75rem; color: #64748b; font-weight: normal;">(Click node to inspect execution steps)</span>
                </div>
                <div id="cmd-topology-map-container" style="flex: 1; position: relative;"></div>
              </div>
            </div>

            <!-- Right Panel: Step Execution Details & Payload Inspector -->
            <div class="seven wide column" style="padding-right: 0; padding-left: 8px;">
              <div class="ui segment" style="height: 100%; padding: 12px; border: 1px solid #e2e8f0; border-radius: 6px; overflow-y: auto;">
                <div id="cmd-step-inspector-container" style="height: 100%;">
                  <div style="padding: 40px 20px; text-align: center; color: #94a3b8;">
                    <div style="font-weight: 600; color: #64748b; font-size: 0.95rem;">Select an iFlow Node</div>
                    <div style="font-size: 0.8rem; margin-top: 4px;">Click on any node in the topology map on the left to inspect its execution steps and trace payloads.</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      `;

      document.body.appendChild(modal);

      // Event Listeners
      modal.querySelector(".cmd-modal-close").onclick = () => {
        if (CmdDebuggerModal.state.countdownInterval) {
          clearInterval(CmdDebuggerModal.state.countdownInterval);
          CmdDebuggerModal.state.countdownInterval = null;
        }
        $(modal).modal("hide");
      };

      modal.querySelector("#cmd-activate-trace-btn").onclick = async () => {
        const scope = modal.querySelector("#cmd-flow-scope-select").value;
        const statusMsg = modal.querySelector("#cmd-trace-status-message");
        if (CmdDebuggerModal.state.countdownInterval) {
          clearInterval(CmdDebuggerModal.state.countdownInterval);
          CmdDebuggerModal.state.countdownInterval = null;
        }
        statusMsg.innerHTML = `<i class="spinner loading icon"></i> Activating TRACE...`;

        if (typeof CmdTraceManager !== "undefined") {
          const results = await CmdTraceManager.bulkActivateLogLevel(scope, "TRACE", (curr, total, flow) => {
            statusMsg.textContent = `Activating TRACE (${curr}/${total}): ${flow}`;
          });
          const successCount = results.filter((r) => r.success).length;
          CmdDebuggerModal.startTraceCountdownTimer(statusMsg, successCount, results.length, Date.now());
        }
      };

      modal.querySelector("#cmd-run-test-pd-btn").onclick = () => {
        if (typeof CmdProcessDirectDiscovery !== "undefined" && CmdProcessDirectDiscovery.runProcessDirectDiscoveryTest) {
          CmdProcessDirectDiscovery.runProcessDirectDiscoveryTest();
        }
      };

      modal.querySelector("#cmd-modal-export-zip-btn").onclick = async () => {
        if (typeof CmdZipExportHelper !== "undefined") {
          await CmdZipExportHelper.exportAllTracesAsZip(CmdDebuggerModal.state.logs || []);
        }
      };
    }

    const statusMsg = modal.querySelector("#cmd-trace-status-message");
    this.checkExistingTraceStatus(statusMsg);

    $(modal).modal({
      closable: true,
      autofocus: false,
      onHidden: () => {
        if (CmdDebuggerModal.state.countdownInterval) {
          clearInterval(CmdDebuggerModal.state.countdownInterval);
          CmdDebuggerModal.state.countdownInterval = null;
        }
      },
    }).modal("show");

    await this.refreshTopologyView(runInfo, pluginHelper);
  },

  /**
   * Refreshes the topology map view with live correlation or recent message logs.
   */
  async refreshTopologyView(runInfo = null, pluginHelper = null) {
    const mapContainer = document.querySelector("#cmd-topology-map-container");
    const inspectorContainer = document.querySelector("#cmd-step-inspector-container");
    if (!mapContainer) return;

    mapContainer.innerHTML = `<div class="ui active centered inline loader" style="margin-top: 150px;"></div><div style="text-align: center; color: #666; margin-top: 10px;">Loading live message logs...</div>`;

    const getApi = (typeof CmdCpiApiHelper !== "undefined" && CmdCpiApiHelper.getApiUrl) ? CmdCpiApiHelper.getApiUrl : window.getApiUrl;
    const parseMs = (typeof CmdCpiApiHelper !== "undefined" && CmdCpiApiHelper.parseMs) ? CmdCpiApiHelper.parseMs : (ts) => (typeof ts === "number" ? ts : new Date(ts).getTime() || 0);

    let logs = [];
    let selectedTarget = null;
    const msgGuid = runInfo?.messageGuid || (typeof cpiData !== "undefined" && cpiData.messageGuid ? cpiData.messageGuid : "");

    try {
      if (msgGuid) {
        // 1. Fetch current message log
        const singleUrl = getApi(`MessageProcessingLogs('${msgGuid}')?$format=json`);
        const rawSingle = await makeCallPromise("GET", encodeURI(singleUrl), false);
        const singleRes = typeof rawSingle === "string" ? JSON.parse(rawSingle) : rawSingle;
        const mainLog = singleRes?.d || singleRes;

        if (mainLog && mainLog.MessageGuid) {
          logs.push(mainLog);
          selectedTarget = mainLog;

          // 2. Fetch full Correlation Call-Chain
          if (mainLog.CorrelationId) {
            const corrUrl = getApi(`MessageProcessingLogs?$format=json&$filter=CorrelationId eq '${mainLog.CorrelationId}'&$orderby=LogStart`);
            const rawCorr = await makeCallPromise("GET", encodeURI(corrUrl), false);
            const corrRes = typeof rawCorr === "string" ? JSON.parse(rawCorr) : rawCorr;
            const corrLogs = corrRes?.d?.results || [];
            corrLogs.forEach((cl) => {
              if (!logs.some((l) => l.MessageGuid === cl.MessageGuid)) {
                logs.push(cl);
              }
            });
          }
        }
      }

      // 3. Fallback: Recent logs for current iFlow
      if (logs.length === 0) {
        const activeIFlow = (typeof cpiData !== "undefined" && cpiData.integrationFlowId) ? cpiData.integrationFlowId : "";
        const filterClause = activeIFlow ? `&$filter=IntegrationArtifact/Id eq '${activeIFlow}'` : "";
        const logsUrl = getApi(`MessageProcessingLogs?$top=20&$orderby=LogStart desc&$format=json${filterClause}`);
        const rawLogs = await makeCallPromise("GET", encodeURI(logsUrl), false);
        const logsRes = typeof rawLogs === "string" ? JSON.parse(rawLogs) : rawLogs;
        logs = logsRes?.d?.results || [];
        selectedTarget = logs[0];
      }
    } catch (e) {
      console.warn("Failed to load logs:", e);
    }

    logs.sort((a, b) => parseMs(a.LogStart) - parseMs(b.LogStart));

    // 4. Fetch RunSteps in parallel for precise timing bounds
    await Promise.all(
      logs.map(async (log) => {
        try {
          const runsUrl = getApi(`MessageProcessingLogs('${log.MessageGuid}')/Runs?$format=json`);
          const rawRuns = await makeCallPromise("GET", encodeURI(runsUrl), false);
          const runsRes = typeof rawRuns === "string" ? JSON.parse(rawRuns) : rawRuns;
          if (runsRes.d && runsRes.d.results && runsRes.d.results.length > 0) {
            log.__runId = runsRes.d.results[0].Id;
            const stepsUrl = getApi(`MessageProcessingLogRuns('${log.__runId}')/RunSteps?$format=json&$top=300`);
            const rawSteps = await makeCallPromise("GET", encodeURI(stepsUrl), false);
            const stepsRes = typeof rawSteps === "string" ? JSON.parse(rawSteps) : rawSteps;
            log.__steps = stepsRes.d && stepsRes.d.results ? stepsRes.d.results : [];
          } else {
            log.__steps = [];
          }
        } catch (eStep) {
          log.__steps = [];
        }
      })
    );

    this.state.logs = logs;
    this.state.selectedLog = selectedTarget || logs[0];

    if (typeof CmdTopologyGraph !== "undefined") {
      CmdTopologyGraph.renderSvgColumnMap(mapContainer, logs, this.state.selectedLog, (selected) => {
        CmdDebuggerModal.state.selectedLog = selected;
        if (typeof CmdStepInspector !== "undefined") {
          CmdStepInspector.inspectStepDetails(inspectorContainer, selected);
        }
      });

      if (this.state.selectedLog && typeof CmdStepInspector !== "undefined") {
        CmdStepInspector.inspectStepDetails(inspectorContainer, this.state.selectedLog);
      }
    }
  },
};

// Expose to window namespace
if (typeof window !== "undefined") {
  window.CmdDebuggerModal = CmdDebuggerModal;
  window.openDebuggerModal = (runInfo, pluginHelper) => CmdDebuggerModal.openModal(runInfo, pluginHelper);
}
