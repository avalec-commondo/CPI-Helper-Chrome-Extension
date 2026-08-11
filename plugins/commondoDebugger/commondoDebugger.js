// ===========================================================================
// COMMODNO IS DEBUGGER - MAIN ENTRY POINT & COORDINATOR
// ===========================================================================
// Registers the plugin with CPI-Helper, injects UI action buttons,
// and orchestrates feature modules and shared helpers.

var currentDebuggerState = {
  logs: [],
  selectedLog: null,
};

async function openDebuggerModal(runInfo = null, pluginHelper = null) {
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
    modal.querySelector(".cmd-modal-close").onclick = () => $(modal).modal("hide");

    modal.querySelector("#cmd-activate-trace-btn").onclick = async () => {
      const scope = modal.querySelector("#cmd-flow-scope-select").value;
      const statusMsg = modal.querySelector("#cmd-trace-status-message");
      statusMsg.innerHTML = `<i class="spinner loading icon"></i> Activating TRACE...`;

      if (typeof CmdTraceManager !== "undefined") {
        const results = await CmdTraceManager.bulkActivateLogLevel(scope, "TRACE", (curr, total, flow) => {
          statusMsg.textContent = `Activating TRACE (${curr}/${total}): ${flow}`;
        });
        const successCount = results.filter((r) => r.success).length;
        statusMsg.innerHTML = `<span style="color: #10b981; font-weight: 600;">Activated TRACE on ${successCount}/${results.length} iFlows</span>`;
      }
    };

    modal.querySelector("#cmd-run-test-pd-btn").onclick = () => {
      if (typeof CmdProcessDirectDiscovery !== "undefined" && CmdProcessDirectDiscovery.runProcessDirectDiscoveryTest) {
        CmdProcessDirectDiscovery.runProcessDirectDiscoveryTest();
      }
    };

    modal.querySelector("#cmd-modal-export-zip-btn").onclick = async () => {
      if (typeof CmdZipExportHelper !== "undefined") {
        await CmdZipExportHelper.exportAllTracesAsZip(currentDebuggerState.logs || []);
      }
    };
  }

  $(modal).modal({ closable: true, autofocus: false }).modal("show");
  await refreshTopologyView(runInfo, pluginHelper);
}

async function refreshTopologyView(runInfo = null, pluginHelper = null) {
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

  currentDebuggerState.logs = logs;
  currentDebuggerState.selectedLog = selectedTarget || logs[0];

  if (typeof CmdTopologyGraph !== "undefined") {
    CmdTopologyGraph.renderSvgColumnMap(mapContainer, logs, currentDebuggerState.selectedLog, (selected) => {
      currentDebuggerState.selectedLog = selected;
      if (typeof CmdStepInspector !== "undefined") {
        CmdStepInspector.inspectStepDetails(inspectorContainer, selected);
      }
    });

    if (currentDebuggerState.selectedLog && typeof CmdStepInspector !== "undefined") {
      CmdStepInspector.inspectStepDetails(inspectorContainer, currentDebuggerState.selectedLog);
    }
  }
}

// ---------------------------------------------------------------------------
// HEADER BUTTON INJECTION (STANDARD SAP UI5 STYLE)
// ---------------------------------------------------------------------------

function injectHeaderTraceButton() {
  let area = document.querySelector("[id*='--iflowObjectPageHeader-actions']");
  if (!area) {
    area = document.querySelector(".sapUxAPObjectPageHeaderIdentifierActions");
  }
  if (!area) return;

  if (document.getElementById("__commondo_trace_all_header_btn")) return;

  const stdTraceBtn = document.getElementById("__buttonxx") || document.querySelector("[id*='--traceButton']");
  if (!stdTraceBtn) return;

  const traceBtn = document.createElement("button");
  traceBtn.id = "__commondo_trace_all_header_btn";
  traceBtn.title = "Open Commondo IS Debugger";
  traceBtn.className = "sapMBtn sapMBtnBase spcHeaderActionButton";
  traceBtn.style.cssText = "display: inline-block; float: right; margin-right: 6px;";
  traceBtn.innerHTML = `
    <span class="sapMBtnHoverable sapMBtnInner sapMBtnText sapMBtnTransparent sapMFocusable">
      <span class="sapMBtnContent">
        <bdi style="color: #0070f3; font-weight: bold;">Trace IFlows</bdi>
      </span>
    </span>
  `;

  traceBtn.onclick = async () => {
    await openDebuggerModal();
  };

  if (stdTraceBtn.parentNode) {
    stdTraceBtn.parentNode.insertBefore(traceBtn, stdTraceBtn);
  }
}

setInterval(injectHeaderTraceButton, 2000);

// ---------------------------------------------------------------------------
// PLUGIN REGISTRATION FOR CPI-HELPER
// ---------------------------------------------------------------------------

var plugin = {
  metadataVersion: "1.0.0",
  id: "commondoDebugger",
  name: "Commondo IS Debugger",
  version: "3.0.0",
  author: "Commondo",
  website: "https://commondo.eu",
  email: "info@commondo.eu",
  description: "Multi-tier iFlow trace debugger, recursive PD call-chain topology graph & trace exporter.",
  settings: {},

  messageSidebarButton: {
    icon: { type: "icon", text: "xe0b6" },
    title: "Commondo IS Debugger",
    onClick: async (pluginHelper, settings, runInfo, active) => {
      await openDebuggerModal(runInfo, pluginHelper);
    },
  },

  scriptButton: {
    icon: { type: "icon", text: "xe0b6" },
    title: "Commondo IS Debugger",
    onClick: async (pluginHelper, settings) => {
      await openDebuggerModal(null, pluginHelper);
    },
  },
};

if (typeof pluginList !== "undefined") {
  pluginList.push(plugin);
}
