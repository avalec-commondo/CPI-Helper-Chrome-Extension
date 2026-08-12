// ===========================================================================
// COMMODNO IS DEBUGGER - DEBUGGER MODAL FEATURE
// ===========================================================================
// Assembles and manages the main multi-tier trace inspection modal dialog:
// 1. BPMN-driven Directional Topology Graph (DAG) with ProcessDirect endpoints.
// 2. Global Execution Run Selector (Correlation ID call-chain loader).
// 3. Per-Node Run Instance Dropdown (for Iterators, Splitters, and Loops).
// 4. Integrated Step Inspector and Live TRACE Countdown Timers.

const CmdDebuggerModal = {
  state: {
    rootFlowId: "",
    packageId: "",
    topologyData: null,
    rootExecutionRuns: [],
    selectedRootRun: null,
    logsByFlowId: {},
    selectedNodeId: null,
    selectedNodeRunIndex: 0,
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
          <span style="font-size: 0.8rem; font-weight: 600; color: #475569;">TRACE Active:</span>
          <span style="display: inline-flex; align-items: center; gap: 4px; background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; border-radius: 12px; padding: 3px 10px; font-family: monospace; font-size: 0.85rem; font-weight: bold;">
            <span>⏱</span> ${formatted}
          </span>
        `;
      } else {
        statusMsg.innerHTML = `
          <span style="font-size: 0.8rem; font-weight: 600; color: #64748b;">TRACE Inactive:</span>
          <span style="display: inline-flex; align-items: center; gap: 4px; background: #f1f5f9; color: #64748b; border: 1px solid #cbd5e1; border-radius: 12px; padding: 3px 10px; font-family: monospace; font-size: 0.85rem; font-weight: bold;">
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
      const rootFlow = this.state.rootFlowId || (typeof cpiData !== "undefined" && cpiData.integrationFlowId ? cpiData.integrationFlowId : "");
      const locId = (typeof cpiData !== "undefined" && cpiData.runtimeLocationId) ? cpiData.runtimeLocationId : "cloudintegration";
      if (!rootFlow) return;

      if (typeof storageGetPromise === "function") {
        const stored = await storageGetPromise(`${rootFlow}_${locId}_powertraceLastRefresh`);
        if (stored) {
          const lastTime = Number(stored);
          const elapsed = Date.now() - lastTime;
          if (elapsed < 10 * 60 * 1000) {
            this.startTraceCountdownTimer(statusMsg, 1, 1, lastTime);
            return;
          }
        }
      }
      // If not active, render inactive badge
      if (statusMsg) {
        statusMsg.innerHTML = `
          <span style="font-size: 0.8rem; font-weight: 600; color: #64748b;">TRACE Inactive:</span>
          <span style="display: inline-flex; align-items: center; gap: 4px; background: #f1f5f9; color: #64748b; border: 1px solid #cbd5e1; border-radius: 12px; padding: 3px 10px; font-family: monospace; font-size: 0.85rem; font-weight: bold;">
            00:00
          </span>
        `;
      }
    } catch (e) {}
  },

  /**
   * Assembles and displays the redesigned debugger modal dialog.
   */
  async openModal(runInfo = null, pluginHelper = null) {
    const apiHelper = typeof CmdCpiApiHelper !== "undefined" ? CmdCpiApiHelper : {};
    this.state.rootFlowId = (typeof cpiData !== "undefined" && cpiData.integrationFlowId) ? cpiData.integrationFlowId : "";
    this.state.packageId = (typeof cpiData !== "undefined" && cpiData.currentPackageId) ? cpiData.currentPackageId : (await apiHelper.resolveCurrentPackageId(this.state.rootFlowId));

    let modal = document.querySelector("#cmd-debugger-modal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "cmd-debugger-modal";
      modal.className = "ui modal";
      modal.style.cssText = "width: 94vw !important; max-width: 1550px !important; border-radius: 8px; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;";

      modal.innerHTML = `
        <!-- Modal Header -->
        <div class="header" style="display: flex; justify-content: space-between; align-items: center; background: #f8fafc; padding: 12px 20px; border-bottom: 1px solid #e2e8f0;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 1.15rem; font-weight: bold; color: #1e293b;">Commondo IS Trace Graph</span>
          </div>
          <div style="display: flex; align-items: center; gap: 10px;">
            <button id="cmd-modal-test-pd-btn" class="ui mini blue basic button" title="Run diagnostic ProcessDirect discovery test in Console" style="padding: 6px 10px; font-size: 0.8rem;">
              Test PD Discovery
            </button>
            <button id="cmd-modal-export-zip-btn" class="ui mini teal button" title="Download all trace payloads as a ZIP package" style="padding: 6px 10px; font-size: 0.8rem;">
              Export Traces (ZIP)
            </button>
            <span class="cmd-modal-close" style="cursor: pointer; font-size: 1.5rem; font-weight: bold; color: #64748b; line-height: 1; padding: 0 4px;" title="Close">&times;</span>
          </div>
        </div>

        <div class="content" style="padding: 14px 16px; background: #ffffff; max-height: 84vh; overflow: hidden; display: flex; flex-direction: column; gap: 12px;">
          
          <!-- Top Control & Selection Bar -->
          <div class="ui segment" style="margin: 0; padding: 10px 14px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
            
            <!-- Left: Global Execution Run Selector -->
            <div style="display: flex; align-items: center; gap: 10px; flex: 1; min-width: 320px;">
              <span style="font-weight: 600; color: #334155; font-size: 0.85rem; white-space: nowrap;">
                Global Run Instance:
              </span>
              <select id="cmd-global-run-select" class="ui compact dropdown" style="padding: 6px 10px; font-size: 0.85rem; border-radius: 4px; border: 1px solid #cbd5e1; flex: 1; max-width: 480px;">
                <option value="">Loading execution runs...</option>
              </select>
              <button id="cmd-global-run-refresh-btn" class="ui mini basic button" title="Refresh execution logs" style="padding: 6px 10px; font-size: 0.85rem;">
                ↻
              </button>
            </div>

            <!-- Right: TRACE Countdown Timer Badge Only -->
            <div id="cmd-trace-status-message" style="display: flex; align-items: center; gap: 6px;"></div>
          </div>

          <!-- Main Split Layout -->
          <div class="ui grid" style="margin: 0; flex: 1; min-height: 0;">
            
            <!-- Left 9-wide column: Interactive Directional Graph (DAG) -->
            <div class="nine wide column" style="padding-left: 0; padding-right: 8px;">
              <div class="ui segment" style="height: 100%; padding: 0; border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden; display: flex; flex-direction: column;">
                <div style="padding: 10px 14px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; font-weight: 600; font-size: 0.9rem; color: #334155; display: flex; justify-content: space-between; align-items: center;">
                  <span>Directional ProcessDirect Topology Map</span>
                  <span style="font-size: 0.75rem; color: #64748b; font-weight: normal;">(Click node to select and inspect)</span>
                </div>
                <div id="cmd-topology-map-container" style="flex: 1; position: relative;"></div>
              </div>
            </div>

            <!-- Right 7-wide column: Node Details, Run Instance Dropdown & Step Inspector -->
            <div class="seven wide column" style="padding-right: 0; padding-left: 8px;">
              <div class="ui segment" style="height: 100%; padding: 12px; border: 1px solid #e2e8f0; border-radius: 6px; display: flex; flex-direction: column; overflow: hidden;">
                
                <!-- Per-Node Header & Instance Selector -->
                <div id="cmd-node-inspector-header" style="margin-bottom: 10px;">
                  <div style="font-size: 0.95rem; font-weight: bold; color: #1e293b;" id="cmd-selected-node-title">No iFlow Selected</div>
                  <div id="cmd-node-instance-selector-container" style="margin-top: 6px; display: none;">
                    <label style="font-size: 0.8rem; font-weight: 600; color: #475569; margin-right: 6px;">Select Run Instance:</label>
                    <select id="cmd-node-instance-select" class="ui compact dropdown" style="padding: 4px 8px; font-size: 0.8rem; border-radius: 4px; border: 1px solid #cbd5e1; max-width: 320px;">
                    </select>
                  </div>
                </div>

                <!-- Step Inspector Container -->
                <div id="cmd-step-inspector-container" style="flex: 1; overflow-y: auto;">
                  <div style="padding: 50px 20px; text-align: center; color: #94a3b8;">
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

      // Global run selector change
      modal.querySelector("#cmd-global-run-select").onchange = async (e) => {
        const selectedGuid = e.target.value;
        const chosenRun = CmdDebuggerModal.state.rootExecutionRuns.find((r) => r.MessageGuid === selectedGuid);
        if (chosenRun) {
          CmdDebuggerModal.state.selectedRootRun = chosenRun;
          await CmdDebuggerModal.loadCorrelationLogsAndRender(chosenRun);
        }
      };

      // Global run refresh button
      modal.querySelector("#cmd-global-run-refresh-btn").onclick = async () => {
        await CmdDebuggerModal.reloadAllRunsAndTopology(runInfo);
      };

      modal.querySelector("#cmd-modal-test-pd-btn").onclick = async () => {
        if (typeof CmdProcessDirectDiscovery !== "undefined" && CmdProcessDirectDiscovery.runProcessDirectDiscoveryTest) {
          await CmdProcessDirectDiscovery.runProcessDirectDiscoveryTest(CmdDebuggerModal.state.selectedRootRun, CmdDebuggerModal.state.packageId);
        }
      };

      modal.querySelector("#cmd-modal-export-zip-btn").onclick = async () => {
        if (typeof CmdZipExportHelper !== "undefined") {
          const allLogs = Object.values(CmdDebuggerModal.state.logsByFlowId).flat();
          await CmdZipExportHelper.exportAllTracesAsZip(allLogs.length > 0 ? allLogs : (CmdDebuggerModal.state.selectedRootRun ? [CmdDebuggerModal.state.selectedRootRun] : []));
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

    await this.reloadAllRunsAndTopology(runInfo);
  },

  /**
   * Reloads BPMN topology and Root execution runs.
   */
  async reloadAllRunsAndTopology(runInfo = null) {
    const mapContainer = document.querySelector("#cmd-topology-map-container");
    const globalRunSelect = document.querySelector("#cmd-global-run-select");
    if (!mapContainer || !globalRunSelect) return;

    // Clear caches so new trace and updated flows generate a fresh graph
    if (typeof CmdTracePayloadHelper !== "undefined" && CmdTracePayloadHelper.clearCache) {
      CmdTracePayloadHelper.clearCache();
    }
    if (typeof CmdBpmnModelHelper !== "undefined" && CmdBpmnModelHelper.clearCache) {
      CmdBpmnModelHelper.clearCache();
    }

    mapContainer.innerHTML = `<div class="ui active centered inline loader" style="margin-top: 150px;"></div><div style="text-align: center; color: #666; margin-top: 10px;">Discovering ProcessDirect Topology...</div>`;
    globalRunSelect.innerHTML = `<option value="">Loading execution runs...</option>`;

    const getApi = (typeof CmdCpiApiHelper !== "undefined" && CmdCpiApiHelper.getApiUrl) ? CmdCpiApiHelper.getApiUrl : window.getApiUrl;
    const rootFlow = this.state.rootFlowId;

    // 1. Fetch Recent Execution Runs for Root Flow
    let rootRuns = [];
    try {
      const filterClause = rootFlow ? `&$filter=IntegrationArtifact/Id eq '${encodeURIComponent(rootFlow)}'` : "";
      const runsUrl = getApi(`MessageProcessingLogs?$top=20&$orderby=LogStart desc&$format=json${filterClause}`);
      const rawRes = await makeCallPromise("GET", encodeURI(runsUrl), false);
      const res = typeof rawRes === "string" ? JSON.parse(rawRes) : rawRes;
      rootRuns = res?.d?.results || [];
    } catch (e) {
      console.warn("Failed loading root runs:", e);
    }

    this.state.rootExecutionRuns = rootRuns;

    // 2. Populate Global Run Dropdown
    globalRunSelect.innerHTML = "";
    if (rootRuns.length === 0) {
      globalRunSelect.innerHTML = `<option value="">No recent execution runs found</option>`;
    } else {
      rootRuns.forEach((run, idx) => {
        const opt = document.createElement("option");
        opt.value = run.MessageGuid;

        const startStr = run.LogStart ? new Date(parseInt(run.LogStart.substr(6, 13) || Date.now())).toLocaleTimeString() : `Run #${idx + 1}`;
        const status = run.Status || "COMPLETED";
        const corrId = run.CorrelationId ? ` (Corr: ${run.CorrelationId.substring(0, 8)}...)` : "";
        opt.textContent = `${startStr} - ${status}${corrId}`;

        if (idx === 0) opt.selected = true;
        globalRunSelect.appendChild(opt);
      });
    }

    // 3. Select Initial Run & Load Correlated Logs
    let targetRun = rootRuns[0] || null;
    if (runInfo?.messageGuid) {
      const matched = rootRuns.find((r) => r.MessageGuid === runInfo.messageGuid);
      if (matched) targetRun = matched;
    }

    this.state.selectedRootRun = targetRun;
    await this.loadCorrelationLogsAndRender(targetRun);
  },

  /**
   * Loads all correlated logs for the selected root run and dynamically builds the runtime topology graph.
   */
  async loadCorrelationLogsAndRender(rootRun) {
    const mapContainer = document.querySelector("#cmd-topology-map-container");
    if (!mapContainer) return;

    const getApi = (typeof CmdCpiApiHelper !== "undefined" && CmdCpiApiHelper.getApiUrl) ? CmdCpiApiHelper.getApiUrl : window.getApiUrl;
    const logsByFlowId = {};
    let corrLogs = [];

    if (rootRun) {
      const rootFlowName = rootRun.IntegrationFlowName || rootRun.IntegrationArtifact?.Id || this.state.rootFlowId;
      corrLogs = [rootRun];

      // Fetch full correlation call-chain across tenant if CorrelationId exists
      if (rootRun.CorrelationId) {
        try {
          const corrUrl = getApi(`MessageProcessingLogs?$format=json&$filter=CorrelationId eq '${rootRun.CorrelationId}'&$orderby=LogStart`);
          const rawCorr = await makeCallPromise("GET", encodeURI(corrUrl), false);
          const corrRes = typeof rawCorr === "string" ? JSON.parse(rawCorr) : rawCorr;
          const fetchedLogs = corrRes?.d?.results || [];

          if (fetchedLogs.length > 0) {
            corrLogs = fetchedLogs;
          }
        } catch (e) {
          console.warn("Failed fetching correlation logs:", e);
        }
      }

      corrLogs.forEach((log) => {
        const flowId = log.IntegrationFlowName || log.IntegrationArtifact?.Id || "iFlow";
        if (!logsByFlowId[flowId]) logsByFlowId[flowId] = [];
        if (!logsByFlowId[flowId].some((l) => l.MessageGuid === log.MessageGuid)) {
          logsByFlowId[flowId].push(log);
        }
      });
    }

    this.state.logsByFlowId = logsByFlowId;

    // Dynamically build the exact correlation topology graph for this execution run
    const rootFlow = this.state.rootFlowId || (rootRun?.IntegrationFlowName || rootRun?.IntegrationArtifact?.Id);
    if (typeof CmdProcessDirectDiscovery !== "undefined" && CmdProcessDirectDiscovery.buildCorrelationTopology) {
      try {
        this.state.topologyData = await CmdProcessDirectDiscovery.buildCorrelationTopology(rootFlow, corrLogs, this.state.packageId);
      } catch (eBuild) {
        console.warn("Failed building correlation topology, falling back to basic:", eBuild);
        this.state.topologyData = {
          nodes: Object.keys(logsByFlowId).map((id, idx) => ({ id, level: idx === 0 ? 0 : 1, runCount: logsByFlowId[id].length })),
          edges: [],
          levels: {},
        };
      }
    }

    // Auto-select root flow or first discovered node
    if (!this.state.selectedNodeId || !this.state.topologyData?.nodes?.some((n) => n.id === this.state.selectedNodeId)) {
      this.state.selectedNodeId = this.state.topologyData?.nodes?.[0]?.id || this.state.rootFlowId;
    }

    // Render Directional Graph
    if (typeof CmdTopologyGraph !== "undefined" && CmdTopologyGraph.renderDirectionalTopology) {
      CmdTopologyGraph.renderDirectionalTopology(
        mapContainer,
        this.state.topologyData,
        this.state.logsByFlowId,
        this.state.selectedNodeId,
        (nodeId, logsForNode) => {
          this.selectNodeAndInspect(nodeId, logsForNode);
        }
      );
    }

    // Inspect initial selected node
    const initialLogs = logsByFlowId[this.state.selectedNodeId] || [];
    this.selectNodeAndInspect(this.state.selectedNodeId, initialLogs);
  },

  /**
   * Handles node selection from the directional graph and sets up the per-node instance dropdown.
   */
  selectNodeAndInspect(nodeId, logsForNode = []) {
    this.state.selectedNodeId = nodeId;
    this.state.selectedNodeRunIndex = 0;

    const titleEl = document.querySelector("#cmd-selected-node-title");
    const instanceContainer = document.querySelector("#cmd-node-instance-selector-container");
    const instanceSelect = document.querySelector("#cmd-node-instance-select");
    const inspectorContainer = document.querySelector("#cmd-step-inspector-container");

    if (titleEl) {
      const isRoot = this.state.topologyData?.nodes?.find((n) => n.id === nodeId)?.level === 0;
      titleEl.innerHTML = `
        <span style="color: ${isRoot ? "#0284c7" : "#334155"};">${nodeId}</span>
        <span class="ui mini label" style="margin-left: 6px; font-weight: normal;">${isRoot ? "ROOT FLOW" : "CHILD FLOW"}</span>
        <span style="font-size: 0.8rem; font-weight: normal; color: #64748b; margin-left: 8px;">(${logsForNode.length} run ${logsForNode.length === 1 ? "instance" : "instances"} found)</span>
      `;
    }

    // Per-node run instance dropdown (especially useful for Iterators/Splitters)
    if (instanceContainer && instanceSelect) {
      if (logsForNode.length > 1) {
        instanceContainer.style.display = "block";
        instanceSelect.innerHTML = "";

        logsForNode.forEach((log, idx) => {
          const opt = document.createElement("option");
          opt.value = idx;

          const timeStr = log.LogStart ? new Date(parseInt(log.LogStart.substr(6, 13) || Date.now())).toLocaleTimeString() : `Run #${idx + 1}`;
          const status = log.Status || "COMPLETED";
          opt.textContent = `Run #${idx + 1} of ${logsForNode.length}: ${timeStr} [${status}]`;

          if (idx === 0) opt.selected = true;
          instanceSelect.appendChild(opt);
        });

        instanceSelect.onchange = (e) => {
          const chosenIdx = parseInt(e.target.value, 10) || 0;
          this.state.selectedNodeRunIndex = chosenIdx;
          if (typeof CmdStepInspector !== "undefined" && logsForNode[chosenIdx]) {
            CmdStepInspector.inspectStepDetails(inspectorContainer, logsForNode[chosenIdx]);
          }
        };
      } else {
        instanceContainer.style.display = "none";
      }
    }

    // Inspect the selected run instance
    if (inspectorContainer) {
      if (logsForNode.length > 0) {
        const activeLog = logsForNode[this.state.selectedNodeRunIndex] || logsForNode[0];
        if (typeof CmdStepInspector !== "undefined") {
          CmdStepInspector.inspectStepDetails(inspectorContainer, activeLog);
        }
      } else {
        inspectorContainer.innerHTML = `
          <div style="padding: 40px 20px; background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 6px; text-align: center; color: #64748b; margin-top: 20px;">
            <i class="info circle icon" style="font-size: 1.5rem; color: #94a3b8; margin-bottom: 8px;"></i>
            <div style="font-weight: 600; font-size: 0.95rem;">No Execution Run Found in this Correlation</div>
            <div style="font-size: 0.8rem; margin-top: 6px; color: #64748b; max-width: 360px; margin-left: auto; margin-right: auto;">
              <b>${nodeId}</b> is part of the design-time ProcessDirect topology, but was not executed during the selected global run.
            </div>
          </div>
        `;
      }
    }
  },
};

// Expose to window namespace
if (typeof window !== "undefined") {
  window.CmdDebuggerModal = CmdDebuggerModal;
  window.openDebuggerModal = (runInfo, pluginHelper) => CmdDebuggerModal.openModal(runInfo, pluginHelper);
}
