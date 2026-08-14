// ===========================================================================
// COMMNDO IS DEBUGGER - STEP INSPECTOR VIEW (CmdStepInspectorView)
// ===========================================================================
// Renders the Execution Steps list for any selected flow node,
// displaying step names, activity, duration, properties, headers, and body payloads.

const CmdStepInspectorView = {
  /**
   * Renders execution steps and payload inspector for a selected log entry.
   */
  async inspectStepDetails(container, logEntry) {
    if (!container || !logEntry) return;

    const utils = typeof CmdUtils !== "undefined" ? CmdUtils : {};
    const escapeHtml = utils.escapeHtml || ((s) => s || "");
    const parseMs = utils.parseMs || ((ts) => (typeof ts === "number" ? ts : new Date(ts).getTime() || 0));
    const api = typeof CmdApiClient !== "undefined" ? CmdApiClient : null;
    const bpmnService = typeof CmdBpmnParserService !== "undefined" ? CmdBpmnParserService : null;
    const store = typeof CmdStateStore !== "undefined" ? CmdStateStore : null;

    let steps = logEntry.__steps || [];
    let runId = logEntry.__runId || null;

    if ((steps.length === 0 || !runId) && api) {
      container.innerHTML = `
        <div style="text-align: center; color: #64748b; margin-top: 40px;">
          <div class="ui active centered mini inline loader"></div>
          <div style="margin-top: 10px; font-size: 0.85rem;">Fetching step traces and payloads for <b>${escapeHtml(logEntry.IntegrationFlowName || logEntry.IntegrationArtifact?.Id || "Selected iFlow")}</b>...</div>
        </div>`;

      try {
        const runs = await api.fetchMessageRuns(logEntry.MessageGuid);
        if (runs && runs.length > 0) {
          runId = runs[0].Id;
          logEntry.__runId = runId;

          steps = await api.fetchRunSteps(runId, 300);
          logEntry.__steps = steps;
        }
      } catch (e) {
        console.warn("[CmdStepInspectorView] Failed to fetch steps:", e);
      }
    }

    if (!steps || steps.length === 0) {
      container.innerHTML = `
        <div style="padding: 20px; background: #fefce8; border: 1px solid #fef08a; border-radius: 6px; color: #854d0e; text-align: center;">
          <div style="font-weight: bold; margin-bottom: 4px;">No Execution Steps Found</div>
          <div style="font-size: 0.85rem;">Logged with LogLevel: <b>${escapeHtml(logEntry.LogLevel || "INFO")}</b></div>
          <div style="font-size: 0.8rem; margin-top: 6px; color: #713f12;">Set LogLevel to <b>TRACE</b> to capture step payloads.</div>
        </div>`;
      return;
    }

    const iFlowId = logEntry.IntegrationArtifact?.Id || logEntry.IntegrationFlowName || "iFlow";
    let stepNameMap = {};
    let bpmnFlowName = "";
    if (bpmnService) {
      try {
        const bpmnModel = await bpmnService.getModel(iFlowId);
        stepNameMap = bpmnModel?.steps || {};
        bpmnFlowName = bpmnModel?.flowName || "";
      } catch (eB) {}
    }

    const artifactName = (store ? store.getArtifactName(iFlowId) : "")
      || bpmnFlowName
      || logEntry.IntegrationArtifact?.Name
      || logEntry.IntegrationFlowName
      || iFlowId;

    const runGuid = logEntry.MessageGuid || logEntry.Id || "";
    const logStartMs = parseMs(logEntry.LogStart);
    const logEndMs = parseMs(logEntry.LogEnd);
    const runDurMs = (logStartMs && logEndMs && logEndMs >= logStartMs) ? (logEndMs - logStartMs) : Number(logEntry.Duration || 0);
    const runDurFormatted = utils.formatDuration ? utils.formatDuration(runDurMs) : `${runDurMs}ms`;

    const runIdHeaderHtml = runGuid
      ? `<div style="display: flex; justify-content: space-between; align-items: center; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 5px 8px; font-size: 0.76rem; color: #475569; gap: 8px;">
           <div style="display: flex; align-items: center; gap: 6px; overflow: hidden; min-width: 0;">
             <span style="font-weight: 600; flex-shrink: 0;">Instance ID:</span>
             <span style="font-family: monospace; color: #0284c7; font-weight: bold; user-select: all; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(runGuid)}</span>
           </div>
           <span style="flex-shrink: 0; font-weight: 600; color: #334155; background: #e2e8f0; border-radius: 3px; padding: 1px 6px;" title="Duration of this run">${runDurFormatted}</span>
         </div>`
      : "";

    container.innerHTML = `
      <div id="cmd-steps-list-container" style="height: 100%; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding-right: 4px;">
        ${runIdHeaderHtml}
      </div>
    `;

    const stepsListDiv = container.querySelector("#cmd-steps-list-container");

    steps.forEach((step, idx) => {
      const rawStepId = step.StepId || step.ModelStepId || `Step_${idx + 1}`;
      const baseShapeId = (step.ModelStepId || (step.StepId ? step.StepId.split("#")[0] : "") || "").trim();
      const humanName = stepNameMap[baseShapeId] || stepNameMap[baseShapeId.toLowerCase()] || stepNameMap[rawStepId];

      const displayName = humanName || baseShapeId || rawStepId;
      const techParts = [];
      if (baseShapeId && baseShapeId !== displayName) {
        techParts.push(baseShapeId);
      }
      if (step.Activity && step.Activity.toLowerCase() !== displayName.toLowerCase()) {
        techParts.push(step.Activity);
      }
      const techInfo = techParts.join(" · ");

      const childCount = step.ChildCount || idx + 1;
      const duration = step.StepStart && step.StepStop ? Math.max(0, parseMs(step.StepStop) - parseMs(step.StepStart)) : step.Duration || 0;
      const status = step.Status || "COMPLETED";

      const stepCard = document.createElement("div");
      stepCard.style.cssText = "border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px; background: #ffffff; box-shadow: 0 1px 3px rgba(0,0,0,0.04);";

      stepCard.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: baseline; font-size: 0.85rem; gap: 8px;">
          <div style="display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; flex: 1; min-width: 0;">
            <span style="color: #64748b; font-size: 0.8rem; font-weight: normal; flex-shrink: 0;">#${idx + 1}</span>
            <span style="font-weight: 600; color: #0f172a; font-size: 0.88rem; word-break: break-word;">${escapeHtml(displayName)}</span>
            ${techInfo ? `<span style="font-size: 0.72rem; color: #64748b; font-weight: normal; font-family: monospace;">(${escapeHtml(techInfo)})</span>` : ""}
          </div>
          <div style="font-size: 0.75rem; color: #64748b; flex-shrink: 0; display: flex; align-items: center; gap: 6px;">
            <span class="ui mini label ${status === "COMPLETED" ? "green" : "red"}" style="padding: 2px 6px;">${escapeHtml(status)}</span>
            <span>${duration}ms</span>
          </div>
        </div>

        <div style="margin-top: 8px; display: flex; gap: 6px;">
          <button class="ui mini button cmd-btn-props" style="padding: 5px 10px; font-size: 0.75rem; font-weight: 600;">Properties</button>
          <button class="ui mini button cmd-btn-headers" style="padding: 5px 10px; font-size: 0.75rem; font-weight: 600;">Headers</button>
          <button class="ui mini button cmd-btn-body" style="padding: 5px 10px; font-size: 0.75rem; font-weight: 600;">Body</button>
        </div>

        <div class="cmd-payload-display" style="display: none; margin-top: 8px;"></div>
      `;

      const displayBox = stepCard.querySelector(".cmd-payload-display");

      stepCard.querySelector(".cmd-btn-props").onclick = () => this.fetchStepData(runId, childCount, "properties", displayBox);
      stepCard.querySelector(".cmd-btn-headers").onclick = () => this.fetchStepData(runId, childCount, "headers", displayBox);
      stepCard.querySelector(".cmd-btn-body").onclick = () => this.fetchStepData(runId, childCount, "body", displayBox);

      stepsListDiv.appendChild(stepCard);
    });
  },

  /**
   * Fetches single step properties, headers, or body payload.
   */
  async fetchStepData(runId, childCount, type, container) {
    container.style.display = "block";
    container.innerHTML = `<div style="color: #94a3b8; font-size: 0.78rem; font-style: italic; padding: 6px;">Loading ${type}...</div>`;

    const api = typeof CmdApiClient !== "undefined" ? CmdApiClient : null;
    const codeViewer = typeof CmdCodeViewer !== "undefined" ? CmdCodeViewer : null;

    if (!api) {
      container.innerHTML = `<div style="color: #ef4444; font-size: 0.78rem;">CmdApiClient is not available.</div>`;
      return;
    }

    try {
      const traceData = await api.fetchStepTraceMessages(runId, childCount);
      if (!traceData || traceData.length === 0) {
        container.innerHTML = `<div style="color: #94a3b8; font-size: 0.78rem; font-style: italic; padding: 6px; background: #0f172a; border-radius: 4px;">No trace data recorded for this step (TRACE log level was not active during this run, or payload was not captured).</div>`;
        return;
      }

      traceData.sort((a, b) => Number(a.TraceId) - Number(b.TraceId));
      const traceId = traceData[0].TraceId;

      if (type === "properties") {
        const props = await api.fetchStepExchangeProperties(traceId);
        if (codeViewer) {
          codeViewer.renderPropertyTable(container, props, "Exchange Properties");
        } else {
          container.innerText = JSON.stringify(props, null, 2);
        }
      } else if (type === "headers") {
        const headers = await api.fetchStepHeaders(traceId);
        if (codeViewer) {
          codeViewer.renderPropertyTable(container, headers, "Headers");
        } else {
          container.innerText = JSON.stringify(headers, null, 2);
        }
      } else if (type === "body") {
        const bodyText = await api.fetchStepBodyPayload(traceId, "text");
        if (codeViewer) {
          codeViewer.renderViewer(container, bodyText || "(Empty Payload)", "Step Body Stream");
        } else {
          container.innerText = bodyText || "(Empty Payload)";
        }
      }
    } catch (err) {
      container.innerHTML = `<div style="color: #ef4444; font-size: 0.78rem;">Error loading ${type}: ${err.message || err}</div>`;
    }
  },
};

// Expose globally
if (typeof window !== "undefined") {
  window.CmdStepInspectorView = CmdStepInspectorView;
  window.CmdStepInspector = CmdStepInspectorView; // backward-compatibility alias
}
if (typeof global !== "undefined") {
  global.CmdStepInspectorView = CmdStepInspectorView;
  global.CmdStepInspector = CmdStepInspectorView;
}
