// ===========================================================================
// COMMODNO IS DEBUGGER - STEP INSPECTOR FEATURE
// ===========================================================================
// Renders the Execution Steps list for any selected flow node,
// displaying step names, activity, duration, properties, headers, and body payloads.

const CmdStepInspector = {
  /**
   * Renders execution steps and payload inspector for a selected log entry.
   */
  async inspectStepDetails(container, logEntry) {
    if (!container || !logEntry) return;

    const payloadHelper = typeof CmdTracePayloadHelper !== "undefined" ? CmdTracePayloadHelper : {};
    const escapeHtml = payloadHelper.escapeHtml || ((s) => s || "");
    const getApi = (typeof CmdCpiApiHelper !== "undefined" && CmdCpiApiHelper.getApiUrl) ? CmdCpiApiHelper.getApiUrl : window.getApiUrl;
    const parseMs = (typeof CmdCpiApiHelper !== "undefined" && CmdCpiApiHelper.parseMs) ? CmdCpiApiHelper.parseMs : (ts) => (typeof ts === "number" ? ts : new Date(ts).getTime() || 0);

    let steps = logEntry.__steps || [];
    let runId = logEntry.__runId || null;

    if (steps.length === 0 || !runId) {
      container.innerHTML = `
        <div style="text-align: center; color: #64748b; margin-top: 40px;">
          <div class="ui active centered mini inline loader"></div>
          <div style="margin-top: 10px; font-size: 0.85rem;">Fetching step traces and payloads for <b>${escapeHtml(logEntry.IntegrationFlowName || "Selected iFlow")}</b>...</div>
        </div>`;

      try {
        const runsUrl = getApi(`MessageProcessingLogs('${logEntry.MessageGuid}')/Runs?$format=json`);
        const rawRuns = await makeCallPromise("GET", encodeURI(runsUrl), false);
        const runsRes = typeof rawRuns === "string" ? JSON.parse(rawRuns) : rawRuns;
        if (runsRes.d && runsRes.d.results && runsRes.d.results.length > 0) {
          runId = runsRes.d.results[0].Id;
          logEntry.__runId = runId;

          const stepsUrl = getApi(`MessageProcessingLogRuns('${runId}')/RunSteps?$format=json&$top=300`);
          const rawSteps = await makeCallPromise("GET", encodeURI(stepsUrl), false);
          const stepsRes = typeof rawSteps === "string" ? JSON.parse(rawSteps) : rawSteps;
          if (stepsRes.d && stepsRes.d.results) {
            steps = stepsRes.d.results;
            logEntry.__steps = steps;
          }
        }
      } catch (e) {
        console.warn("Failed to fetch steps:", e);
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

    const wrapper = document.createElement("div");
    wrapper.style.cssText = "height: 100%; display: flex; flex-direction: column; min-height: 0;";
    wrapper.innerHTML = `
      <div style="flex-shrink: 0; margin-bottom: 10px; font-size: 0.85rem; color: #334155; background: #f1f5f9; padding: 8px 12px; border-radius: 6px; border-left: 4px solid #0070f3;">
        <div style="font-weight: bold; font-size: 0.92rem; margin-bottom: 3px;">${escapeHtml(logEntry.IntegrationFlowName || iFlowId)}</div>
        <div style="color: #64748b; font-size: 0.78rem;">
          <b>Status:</b> ${escapeHtml(logEntry.Status)} | <b>LogLevel:</b> ${escapeHtml(logEntry.LogLevel || "INFO")} | <b>Steps:</b> ${steps.length}
        </div>
      </div>
      <div id="cmd-steps-list-container" style="flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding-right: 4px;"></div>
    `;

    container.innerHTML = "";
    container.appendChild(wrapper);

    const stepsListDiv = container.querySelector("#cmd-steps-list-container");

    steps.forEach((step, idx) => {
      const stepName = step.StepId || step.ModelStepId || `Step_${idx + 1}`;
      const childCount = step.ChildCount || idx + 1;
      const duration = step.StepStart && step.StepStop ? Math.max(0, parseMs(step.StepStop) - parseMs(step.StepStart)) : step.Duration || 0;
      const status = step.Status || "COMPLETED";

      const stepCard = document.createElement("div");
      stepCard.style.cssText = "border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px; background: #ffffff; box-shadow: 0 1px 3px rgba(0,0,0,0.04);";

      stepCard.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.85rem;">
          <div style="font-weight: 600; color: #1e293b;">
            <span style="color: #64748b; margin-right: 6px;">#${idx + 1}</span>
            ${escapeHtml(stepName)}
            <span style="font-weight: normal; font-size: 0.75rem; color: #64748b; margin-left: 4px;">(${escapeHtml(step.Activity || "")})</span>
          </div>
          <div style="font-size: 0.75rem; color: #64748b;">
            <span class="ui mini label ${status === "COMPLETED" ? "green" : "red"}" style="padding: 2px 6px;">${escapeHtml(status)}</span>
            <span style="margin-left: 6px;">${duration}ms</span>
          </div>
        </div>

        <div style="margin-top: 8px; display: flex; gap: 6px;">
          <button class="ui mini button cmd-btn-props" style="padding: 5px 10px; font-size: 0.75rem; font-weight: 600;">Properties</button>
          <button class="ui mini button cmd-btn-headers" style="padding: 5px 10px; font-size: 0.75rem; font-weight: 600;">Headers</button>
          <button class="ui mini button cmd-btn-body" style="padding: 5px 10px; font-size: 0.75rem; font-weight: 600;">Body</button>
        </div>

        <div class="cmd-payload-display" style="display: none; margin-top: 8px; background: #0f172a; color: #f8fafc; padding: 10px; border-radius: 4px; font-family: monospace; font-size: 0.75rem; max-height: 220px; overflow: auto; white-space: pre-wrap;"></div>
      `;

      const displayBox = stepCard.querySelector(".cmd-payload-display");

      stepCard.querySelector(".cmd-btn-props").onclick = () => CmdStepInspector.fetchStepDataNative(runId, childCount, "properties", displayBox);
      stepCard.querySelector(".cmd-btn-headers").onclick = () => CmdStepInspector.fetchStepDataNative(runId, childCount, "headers", displayBox);
      stepCard.querySelector(".cmd-btn-body").onclick = () => CmdStepInspector.fetchStepDataNative(runId, childCount, "body", displayBox);

      stepsListDiv.appendChild(stepCard);
    });
  },

  /**
   * Fetches single step properties, headers, or body payload.
   */
  async fetchStepDataNative(runId, childCount, type, container) {
    container.style.display = "block";
    container.innerText = "Loading " + type + "...";

    const getApi = (typeof CmdCpiApiHelper !== "undefined" && CmdCpiApiHelper.getApiUrl) ? CmdCpiApiHelper.getApiUrl : window.getApiUrl;

    try {
      const traceMsgUrl = getApi(`MessageProcessingLogRunSteps(RunId='${runId}',ChildCount=${childCount})/TraceMessages?$format=json`);
      const rawTraceData = await makeCallPromise("GET", traceMsgUrl, false);
      const traceData = (typeof rawTraceData === "string" ? JSON.parse(rawTraceData) : rawTraceData)?.d?.results || [];

      if (traceData.length === 0) {
        container.innerText = "No trace data recorded for this step (TRACE log level was not active during this run, or payload was not captured).";
        return;
      }

      traceData.sort((a, b) => Number(a.TraceId) - Number(b.TraceId));
      const traceId = traceData[0].TraceId;

      if (type === "properties") {
        const propsUrl = getApi(`TraceMessages(${traceId})/ExchangeProperties?$format=json`);
        const rawP = await makeCallPromise("GET", encodeURI(propsUrl), false);
        const resP = typeof rawP === "string" ? JSON.parse(rawP) : rawP;
        const props = resP.d && resP.d.results ? resP.d.results : [];
        container.innerText = props.length > 0 ? props.map((p) => `${p.Name}: ${p.Value}`).join("\n") : "No exchange properties recorded for this step.";
      } else if (type === "headers") {
        const headersUrl = getApi(`TraceMessages(${traceId})/Properties?$format=json`);
        const rawH = await makeCallPromise("GET", encodeURI(headersUrl), false);
        const resH = typeof rawH === "string" ? JSON.parse(rawH) : rawH;
        const headers = resH.d && resH.d.results ? resH.d.results : [];
        container.innerText = headers.length > 0 ? headers.map((h) => `${h.Name}: ${h.Value}`).join("\n") : "No headers recorded for this step.";
      } else if (type === "body") {
        const bodyUrl = getApi(`TraceMessages(${traceId})/$value`);
        const rawBody = await makeCallPromise("GET", bodyUrl, false);
        container.innerText = typeof rawBody === "string" && rawBody.length > 0 ? rawBody : "(Empty payload body)";
      }
    } catch (err) {
      container.innerText = "Error loading " + type + ": " + err.message;
    }
  },
};

// Expose to window namespace
if (typeof window !== "undefined") {
  window.CmdStepInspector = CmdStepInspector;
}

