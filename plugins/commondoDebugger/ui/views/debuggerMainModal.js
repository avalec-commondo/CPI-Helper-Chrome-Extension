// ===========================================================================
// COMMNDO IS DEBUGGER - MAIN DEBUGGER MODAL (CmdDebuggerMainModal)
// ===========================================================================
// Master coordinator modal dialog hosting the interactive SVG topology graph,
// execution run selector, static vs runtime architecture switcher, live trace
// timer countdown badge, step execution drawer, and full ZIP export.

const CmdDebuggerMainModal = {
  state: {
    rootFlowId: "",
    packageId: "",
    viewMode: "runtime", // "runtime" | "static"
    topologyData: null,
    staticTopologyData: null,
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
  startTraceCountdownTimer(statusMsg, activatedAt = Date.now()) {
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

      if (!statusMsg) {
        if (CmdDebuggerMainModal.state.countdownInterval) {
          clearInterval(CmdDebuggerMainModal.state.countdownInterval);
          CmdDebuggerMainModal.state.countdownInterval = null;
        }
        return;
      }

      if (remainingMs > 0) {
        statusMsg.innerHTML = `
          <span style="font-size: 0.8rem; font-weight: 600; color: #475569;">TRACE Active:</span>
          <span style="display: inline-flex; align-items: center; gap: 4px; background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; border-radius: 12px; padding: 3px 10px; font-family: monospace; font-size: 0.85rem; font-weight: bold;">
            ${formatted}
          </span>
        `;
      } else {
        statusMsg.innerHTML = `
          <span style="font-size: 0.8rem; font-weight: 600; color: #64748b;">TRACE Inactive:</span>
          <span style="display: inline-flex; align-items: center; gap: 4px; background: #f1f5f9; color: #64748b; border: 1px solid #cbd5e1; border-radius: 12px; padding: 3px 10px; font-family: monospace; font-size: 0.85rem; font-weight: bold;">
            00:00
          </span>
        `;
        if (CmdDebuggerMainModal.state.countdownInterval) {
          clearInterval(CmdDebuggerMainModal.state.countdownInterval);
          CmdDebuggerMainModal.state.countdownInterval = null;
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
      const utils = typeof CmdUtils !== "undefined" ? CmdUtils : {};
      const rootFlow = this.state.rootFlowId || (typeof cpiData !== "undefined" && cpiData.integrationFlowId ? cpiData.integrationFlowId : "");
      const locId = typeof cpiData !== "undefined" && cpiData.runtimeLocationId ? cpiData.runtimeLocationId : "cloudintegration";
      if (!rootFlow) return;

      const storageKey = `${rootFlow}_${locId}_powertraceLastRefresh`;
      const stored = utils.storageGet ? await utils.storageGet(storageKey) : null;
      if (stored) {
        const lastTime = Number(stored);
        const elapsed = Date.now() - lastTime;
        if (elapsed < 10 * 60 * 1000) {
          this.startTraceCountdownTimer(statusMsg, lastTime);
          return;
        }
      }

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
   * Assembles and displays the debugger modal dialog.
   */
  async openModal(runInfo = null) {
    const api = typeof CmdApiClient !== "undefined" ? CmdApiClient : null;
    const utils = typeof CmdUtils !== "undefined" ? CmdUtils : {};
    const escapeHtml = utils.escapeHtml || ((s) => s || "");

    this.state.rootFlowId = typeof cpiData !== "undefined" && cpiData.integrationFlowId ? cpiData.integrationFlowId : "";
    this.state.packageId = typeof cpiData !== "undefined" && cpiData.currentPackageId ? cpiData.currentPackageId : api ? await api.resolveCurrentPackageId(this.state.rootFlowId) : "";

    let modal = document.querySelector("#cmd-debugger-modal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "cmd-debugger-modal";
      modal.className = "ui modal";
      modal.style.cssText =
        "width: 95vw !important; max-width: 1600px !important; height: 90vh !important; min-height: 650px !important; max-height: 950px !important; display: flex !important; flex-direction: column !important; border-radius: 8px; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;";

      modal.innerHTML = `
        <!-- Modal Header -->
        <div class="header" style="flex-shrink: 0; display: flex; justify-content: space-between; align-items: center; background: #f8fafc; padding: 10px 20px; border-bottom: 1px solid #e2e8f0;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <span style="font-size: 1.15rem; font-weight: bold; color: #1e293b;">Commondo IS Trace Graph</span>
            
            <!-- View Mode Switcher -->
            <div class="ui mini buttons" id="cmd-view-mode-buttons">
              <button id="cmd-view-mode-runtime" class="ui positive mini button active" title="Show active executed call chain for selected run" style="padding: 5px 10px; font-size: 0.78rem; font-weight: 600;">
                Runtime Path
              </button>
              <button id="cmd-view-mode-static" class="ui mini button" title="Show all static ProcessDirect connections across package iFlows" style="padding: 5px 10px; font-size: 0.78rem; font-weight: 600;">
                Static Architecture
              </button>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 10px;">
            <button id="cmd-modal-export-zip-btn" class="ui mini teal button" title="Download all trace payloads as a ZIP package" style="padding: 6px 10px; font-size: 0.8rem;">
              Export Traces (ZIP)
            </button>
            <span class="cmd-modal-close" style="cursor: pointer; font-size: 1.5rem; font-weight: bold; color: #64748b; line-height: 1; padding: 0 4px;" title="Close">&times;</span>
          </div>
        </div>

        <div class="content" style="flex: 1 !important; min-height: 0 !important; height: 100% !important; padding: 12px 16px !important; background: #ffffff; overflow: hidden !important; display: flex !important; flex-direction: column !important; gap: 10px !important;">
          
          <!-- Top Control & Selection Bar -->
          <div class="ui segment" style="flex-shrink: 0; margin: 0; padding: 8px 14px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
            
            <!-- Left: Global Execution Run Selector -->
            <div id="cmd-global-run-container" style="display: flex; align-items: center; gap: 10px; flex: 1; min-width: 320px; transition: opacity 0.2s ease;">
              <span style="font-weight: 600; color: #334155; font-size: 0.85rem; white-space: nowrap;">
                Global Run Instance:
              </span>
              <select id="cmd-global-run-select" class="ui compact dropdown" style="padding: 6px 10px; font-size: 0.85rem; border-radius: 4px; border: 1px solid #cbd5e1; flex: 1; max-width: 480px;">
                <option value="">Loading latest executions...</option>
              </select>
            </div>

            <!-- Right: Jump to iFlow & Countdown Badge -->
            <div style="display: flex; align-items: center; gap: 12px;">
              <button id="cmd-modal-jump-iflow-btn" class="ui mini button" style="background: #0070f3 !important; color: #ffffff !important; font-weight: 600; padding: 6px 12px; font-size: 0.8rem;" title="Open currently selected iFlow in SAP CPI Designer (new tab)">
                Jump to iFlow
              </button>
              <div id="cmd-trace-status-msg" style="display: flex; align-items: center; gap: 6px;"></div>
            </div>
          </div>

          <!-- Main Split View: Left Topology Map (65%) vs Right Step Inspector (35%) -->
          <div style="flex: 1; min-height: 0; display: flex; gap: 12px; width: 100%; height: 100%; overflow: hidden;">
            
            <!-- Left: SVG Topology Map Canvas -->
            <div id="cmd-topology-canvas-container" style="flex: 13; min-width: 0; height: 100%; border: 1px solid #e2e8f0; border-radius: 6px; position: relative; overflow: hidden; background: #f8fafc;">
              <div style="display: flex; align-items: center; justify-content: center; height: 100%; color: #64748b;">
                <div class="ui active centered inline loader"></div>
                <span style="margin-left: 10px; font-size: 0.9rem;">Discovering ProcessDirect call topology...</span>
              </div>
            </div>

            <!-- Right: Step Execution Inspector -->
            <div id="cmd-step-inspector-container" style="flex: 7; min-width: 320px; max-width: 480px; height: 100%; border: 1px solid #e2e8f0; border-radius: 6px; background: #ffffff; display: flex; flex-direction: column; overflow: hidden;">
              
              <!-- Inspector Header -->
              <div id="cmd-inspector-header" style="flex-shrink: 0; background: #f1f5f9; padding: 10px 14px; border-bottom: 1px solid #e2e8f0; display: flex; flex-direction: column; gap: 8px;">
                <div style="font-weight: 600; color: #1e293b; font-size: 0.88rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                  <span id="cmd-inspector-title">Step Trace Inspector</span>
                </div>
                <div id="cmd-inspector-run-selector" style="display: none; width: 100%;">
                  <select id="cmd-node-run-select" class="ui fluid dropdown" style="width: 100%; padding: 5px 8px; font-size: 0.78rem; border-radius: 4px; border: 1px solid #cbd5e1; background: #ffffff;"></select>
                </div>
              </div>

              <!-- Inspector Body / Step List -->
              <div id="cmd-inspector-content" style="flex: 1; min-height: 0; overflow-y: auto; padding: 10px;">
                <div style="color: #64748b; font-size: 0.85rem; text-align: center; margin-top: 60px;">
                  Click any iFlow card on the left to inspect its execution steps and trace payloads.
                </div>
              </div>

            </div>

          </div>

        </div>
      `;

      document.body.appendChild(modal);

      // Event: Close Modal
      modal.querySelectorAll(".cmd-modal-close").forEach((btn) => {
        btn.onclick = () => {
          if (typeof $ !== "undefined" && typeof $(modal).modal === "function") {
            $(modal).modal("hide");
          } else {
            modal.style.display = "none";
          }
        };
      });

      // Event: Jump to iFlow in SAP CPI Designer
      modal.querySelector("#cmd-modal-jump-iflow-btn").onclick = () => {
        const targetFlowId = CmdDebuggerMainModal.state.selectedNodeId || CmdDebuggerMainModal.state.rootFlowId;
        if (!targetFlowId) {
          alert("No iFlow selected.");
          return;
        }
        if (api && api.buildDesignUrl) {
          const url = api.buildDesignUrl(targetFlowId, CmdDebuggerMainModal.state.packageId);
          window.open(url, "_blank");
        }
      };

      // Event: Export Trace Package (ZIP)
      modal.querySelector("#cmd-modal-export-zip-btn").onclick = async () => {
        const zipService = typeof CmdZipExportService !== "undefined" ? CmdZipExportService : null;
        if (!zipService) return;

        const currentTopo = CmdDebuggerMainModal.state.viewMode === "static" ? CmdDebuggerMainModal.state.staticTopologyData : CmdDebuggerMainModal.state.topologyData;

        if (!currentTopo || !currentTopo.nodes || currentTopo.nodes.length === 0) {
          alert("No topology data available to export.");
          return;
        }

        const exportBtn = modal.querySelector("#cmd-modal-export-zip-btn");
        const originalHtml = exportBtn.innerHTML;
        exportBtn.disabled = true;

        const setBtnProgress = (text) => {
          exportBtn.innerHTML = `<i class="spinner loading icon" style="margin-right: 4px;"></i> ${text}`;
        };

        setBtnProgress("Preparing...");

        try {
          await zipService.exportTracePackage(currentTopo, (done, total, text) => {
            setBtnProgress(text);
          });
        } catch (eZip) {
          alert("Export failed: " + eZip.message);
        } finally {
          exportBtn.disabled = false;
          exportBtn.innerHTML = originalHtml;
        }
      };

      // Event: Switch View Mode (Runtime Path vs Static Architecture)
      modal.querySelector("#cmd-view-mode-runtime").onclick = () => {
        if (CmdDebuggerMainModal.state.viewMode === "runtime") return;
        CmdDebuggerMainModal.state.viewMode = "runtime";
        modal.querySelector("#cmd-view-mode-runtime").className = "ui positive mini button active";
        modal.querySelector("#cmd-view-mode-static").className = "ui mini button";
        modal.querySelector("#cmd-global-run-container").style.opacity = "1";
        modal.querySelector("#cmd-global-run-container").style.pointerEvents = "auto";
        CmdDebuggerMainModal.renderCurrentView();
      };

      modal.querySelector("#cmd-view-mode-static").onclick = async () => {
        if (CmdDebuggerMainModal.state.viewMode === "static") return;
        CmdDebuggerMainModal.state.viewMode = "static";
        modal.querySelector("#cmd-view-mode-static").className = "ui positive mini button active";
        modal.querySelector("#cmd-view-mode-runtime").className = "ui mini button";
        modal.querySelector("#cmd-global-run-container").style.opacity = "0.4";
        modal.querySelector("#cmd-global-run-container").style.pointerEvents = "none";
        await CmdDebuggerMainModal.loadStaticArchitecture();
      };
    }

    // Initialize trace countdown status
    const statusMsg = modal.querySelector("#cmd-trace-status-msg");
    this.checkExistingTraceStatus(statusMsg);

    // Show Semantic UI Modal
    if (typeof $ !== "undefined" && typeof $(modal).modal === "function") {
      $(modal).modal({ closable: true, observeChanges: true }).modal("show");
    } else {
      modal.style.display = "flex";
    }

    // Load initial runtime data
    await this.loadRuntimeExecutions(runInfo);
  },

  /**
   * Loads recent execution runs for the active root flow and populates dropdown.
   */
  async loadRuntimeExecutions(preferredRun = null) {
    const modal = document.querySelector("#cmd-debugger-modal");
    if (!modal) return;

    const api = typeof CmdApiClient !== "undefined" ? CmdApiClient : null;
    const utils = typeof CmdUtils !== "undefined" ? CmdUtils : {};
    const runSelect = modal.querySelector("#cmd-global-run-select");

    if (!api || !this.state.rootFlowId) {
      runSelect.innerHTML = `<option value="">No active iFlow detected</option>`;
      return;
    }

    runSelect.innerHTML = `<option value="">Loading execution runs...</option>`;

    try {
      const logs = await api.fetchMessageLogs(this.state.rootFlowId, 25);
      this.state.rootExecutionRuns = Array.isArray(logs) ? logs : [];

      if (this.state.rootExecutionRuns.length === 0) {
        runSelect.innerHTML = `<option value="">No execution runs recorded for ${utils.escapeHtml(this.state.rootFlowId)}</option>`;
        const canvas = modal.querySelector("#cmd-topology-canvas-container");
        canvas.innerHTML = `
          <div style="text-align: center; color: #64748b; margin-top: 150px;">
            <div style="font-size: 1rem; font-weight: 600; margin-bottom: 6px;">No Message Logs Found</div>
            <div style="font-size: 0.85rem;">Execute or trigger <b>${utils.escapeHtml(this.state.rootFlowId)}</b> in SAP CPI to view call-chain trace.</div>
          </div>`;
        return;
      }

      runSelect.innerHTML = "";
      this.state.rootExecutionRuns.forEach((run, idx) => {
        const opt = document.createElement("option");
        opt.value = run.CorrelationId || run.MessageGuid;

        const dateStr = utils.formatDateTime ? utils.formatDateTime(run.LogStart) : new Date(run.LogStart).toLocaleString();
        const status = run.Status || "COMPLETED";
        const instanceId = run.MessageGuid || run.Id || run.CorrelationId || "";

        opt.textContent = `#${idx + 1} | ${dateStr} | Status: ${status} | ID: ${instanceId}`;
        runSelect.appendChild(opt);
      });

      // Select preferred or latest run
      let targetRun = this.state.rootExecutionRuns[0];
      if (preferredRun && preferredRun.MessageGuid) {
        const found = this.state.rootExecutionRuns.find((r) => r.MessageGuid === preferredRun.MessageGuid);
        if (found) targetRun = found;
      }
      this.state.selectedRootRun = targetRun;
      runSelect.value = targetRun.CorrelationId || targetRun.MessageGuid;

      runSelect.onchange = async () => {
        const chosen = this.state.rootExecutionRuns.find((r) => (r.CorrelationId || r.MessageGuid) === runSelect.value);
        if (chosen) {
          this.state.selectedRootRun = chosen;
          await this.loadRuntimeTopologyForRun(chosen);
        }
      };

      await this.loadRuntimeTopologyForRun(targetRun);
    } catch (e) {
      console.warn("[CmdDebuggerMainModal] Failed to load runs:", e);
      runSelect.innerHTML = `<option value="">Failed to load runs: ${e.message}</option>`;
    }
  },

  /**
   * Fetches correlation logs and discovers runtime topology for the selected message run.
   */
  async loadRuntimeTopologyForRun(runLog) {
    const modal = document.querySelector("#cmd-debugger-modal");
    if (!modal || !runLog) return;

    const api = typeof CmdApiClient !== "undefined" ? CmdApiClient : null;
    const pdEngine = typeof CmdPdDiscoveryEngine !== "undefined" ? CmdPdDiscoveryEngine : null;
    const canvas = modal.querySelector("#cmd-topology-canvas-container");

    canvas.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: center; height: 100%; color: #64748b;">
        <div class="ui active centered inline loader"></div>
      </div>`;

    const corrId = runLog.CorrelationId || runLog.MessageGuid;
    let correlationLogs = [runLog];

    if (api && runLog.CorrelationId) {
      try {
        const fetched = await api.fetchCorrelationLogs(runLog.CorrelationId);
        if (Array.isArray(fetched) && fetched.length > 0) {
          correlationLogs = fetched;
        }
      } catch (eLogs) {}
    }

    // Group logs by flow ID
    this.state.logsByFlowId = {};
    correlationLogs.forEach((l) => {
      const fid = l.IntegrationArtifact?.Id || l.IntegrationFlowName || this.state.rootFlowId;
      if (!this.state.logsByFlowId[fid]) this.state.logsByFlowId[fid] = [];
      this.state.logsByFlowId[fid].push(l);
    });

    if (pdEngine) {
      this.state.topologyData = await pdEngine.discoverTopology(this.state.rootFlowId, correlationLogs);
    } else {
      this.state.topologyData = {
        rootFlowId: this.state.rootFlowId,
        nodes: [{ id: this.state.rootFlowId, level: 0 }],
        edges: [],
      };
    }

    this.renderCurrentView();
  },

  /**
   * Discovers and renders the static package-wide architecture.
   */
  async loadStaticArchitecture() {
    const modal = document.querySelector("#cmd-debugger-modal");
    if (!modal) return;

    const staticEngine = typeof CmdStaticArchitectureEngine !== "undefined" ? CmdStaticArchitectureEngine : null;
    const canvas = modal.querySelector("#cmd-topology-canvas-container");

    canvas.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: center; height: 100%; color: #64748b;">
        <div class="ui active centered inline loader"></div>
        <span style="margin-left: 10px; font-size: 0.9rem;">Discovering package ProcessDirect architecture via BFS...</span>
      </div>`;

    if (staticEngine && this.state.rootFlowId && this.state.packageId) {
      this.state.staticTopologyData = await staticEngine.discoverStaticArchitecture(this.state.rootFlowId, this.state.packageId);
    }

    this.renderCurrentView();
  },

  /**
   * Renders the current topology (Runtime or Static) on the SVG canvas.
   */
  renderCurrentView() {
    const modal = document.querySelector("#cmd-debugger-modal");
    if (!modal) return;

    const graphView = typeof CmdTopologyGraphView !== "undefined" ? CmdTopologyGraphView : null;
    const canvas = modal.querySelector("#cmd-topology-canvas-container");
    const currentTopo = this.state.viewMode === "static" ? this.state.staticTopologyData : this.state.topologyData;

    if (!graphView || !currentTopo) return;

    graphView.renderDirectionalTopology(canvas, currentTopo, this.state.logsByFlowId, this.state.selectedNodeId, (nodeId, logsForNode, extraInfo) => {
      this.selectTopologyNode(nodeId, logsForNode, extraInfo);
    });
  },

  /**
   * Selects a node on the topology graph and renders its step details in the right drawer.
   */
  async selectTopologyNode(nodeId, logsForNode = [], extraInfo = null) {
    this.state.selectedNodeId = nodeId;
    const modal = document.querySelector("#cmd-debugger-modal");
    if (!modal) return;

    const utils = typeof CmdUtils !== "undefined" ? CmdUtils : {};
    const escapeHtml = utils.escapeHtml || ((s) => s || "");
    const stepInspector = typeof CmdStepInspectorView !== "undefined" ? CmdStepInspectorView : null;

    const titleElem = modal.querySelector("#cmd-inspector-title");
    const runSelectorDiv = modal.querySelector("#cmd-inspector-run-selector");
    const nodeRunSelect = modal.querySelector("#cmd-node-run-select");
    const contentDiv = modal.querySelector("#cmd-inspector-content");

    if (extraInfo && extraInfo.isHanging) {
      const items = extraInfo.hangings && extraInfo.hangings.length > 0 ? extraInfo.hangings : [extraInfo];
      titleElem.innerText = items.length === 1 ? `Unresolved: ${items[0].address || items[0].rawAddress}` : `${items.length} Unresolved Outbounds`;
      runSelectorDiv.style.display = "none";

      const itemsHtml = items
        .map(
          (it, idx) => `
        <div style="margin-top: 8px; padding: 10px; background: #ffffff; border: 1px solid #fed7aa; border-radius: 4px;">
          <div style="font-size: 0.85rem; font-family: monospace; font-weight: bold; color: #9a3412;">#${idx + 1}: ${escapeHtml(it.address || it.rawAddress)}</div>
          <div style="font-size: 0.78rem; color: #64748b; margin-top: 4px;">Channel: ${escapeHtml(it.channelName || "ProcessDirect")} ${it.isDynamic ? "(Dynamic Expression)" : "(Static)"}</div>
        </div>
      `
        )
        .join("");

      contentDiv.innerHTML = `
        <div style="padding: 16px; background: #fffdf5; border: 1px solid #fef08a; border-radius: 6px; color: #854d0e;">
          <div style="font-weight: bold; font-size: 0.95rem; margin-bottom: 6px;">Unresolved ProcessDirect Endpoint(s)</div>
          <div style="font-size: 0.82rem; color: #713f12;">Caller Flow: <b>${escapeHtml(extraInfo.callerId)}</b></div>
          <div style="font-size: 0.78rem; margin-top: 4px; color: #a16207;">These endpoints were invoked by the caller, but no matching inbound receiver was found or executed in this correlation run.</div>
          <div style="margin-top: 10px;">${itemsHtml}</div>
        </div>`;
      this.renderCurrentView();
      return;
    }

    const store = typeof CmdStateStore !== "undefined" ? CmdStateStore : null;
    const humanName =
      logsForNode[0]?.IntegrationArtifact?.Name ||
      logsForNode[0]?.IntegrationFlowName ||
      (store ? store.getArtifactName(nodeId) : "") ||
      nodeId;

    titleElem.innerText = humanName;
    titleElem.title = `Technical ID: ${nodeId}`;

    if (!logsForNode || logsForNode.length === 0) {
      runSelectorDiv.style.display = "none";
      contentDiv.innerHTML = `
        <div style="padding: 16px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; color: #64748b; text-align: center;">
          <div style="font-weight: bold; margin-bottom: 4px;">Not Executed in This Run</div>
          <div style="font-size: 0.8rem;">No message logs recorded for <b>${escapeHtml(nodeId)}</b> in this correlation chain.</div>
        </div>`;
      this.renderCurrentView();
      return;
    }

    if (logsForNode.length > 1) {
      runSelectorDiv.style.display = "block";
      nodeRunSelect.innerHTML = "";
      logsForNode.forEach((l, idx) => {
        const opt = document.createElement("option");
        const runId = l.MessageGuid || l.Id || "";
        const parseMs = (dt) => {
          if (utils && utils.parseMs) return utils.parseMs(dt);
          const match = String(dt).match(/\d+/);
          return match ? parseInt(match[0], 10) : new Date(dt).getTime() || 0;
        };
        const s = parseMs(l.LogStart);
        const e = parseMs(l.LogEnd);
        const durMs = (s && e && e >= s) ? (e - s) : Number(l.Duration || 0);
        const durStr = utils && utils.formatDuration ? utils.formatDuration(durMs) : `${durMs}ms`;

        opt.value = String(idx);
        opt.textContent = `Run #${idx + 1} | ${durStr} | ${l.Status || "COMPLETED"}${runId ? ` | ID: ${runId}` : ""}`;
        nodeRunSelect.appendChild(opt);
      });
      nodeRunSelect.value = "0";
      nodeRunSelect.onchange = () => {
        const selectedIdx = parseInt(nodeRunSelect.value, 10);
        if (stepInspector && logsForNode[selectedIdx]) {
          stepInspector.inspectStepDetails(contentDiv, logsForNode[selectedIdx]);
        }
      };
    } else {
      runSelectorDiv.style.display = "none";
    }

    if (stepInspector) {
      await stepInspector.inspectStepDetails(contentDiv, logsForNode[0]);
    }

    this.renderCurrentView();
  },
};

// Expose globally
if (typeof window !== "undefined") {
  window.CmdDebuggerMainModal = CmdDebuggerMainModal;
  window.CmdDebuggerModal = CmdDebuggerMainModal; // backward-compatibility alias
}
if (typeof global !== "undefined") {
  global.CmdDebuggerMainModal = CmdDebuggerMainModal;
  global.CmdDebuggerModal = CmdDebuggerMainModal;
}
