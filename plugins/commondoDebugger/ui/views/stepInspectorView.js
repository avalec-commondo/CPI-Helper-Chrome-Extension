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
    let errorInfo = logEntry.__errorInfo || null;

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

    // 1. Sort steps deterministically by ChildCount (with fallback to StepStart)
    if (steps && Array.isArray(steps) && steps.length > 1) {
      steps.sort((a, b) => {
        const aChild = Number(a.ChildCount || 0);
        const bChild = Number(b.ChildCount || 0);
        if (aChild && bChild && aChild !== bChild) {
          return aChild - bChild;
        }
        const aStart = parseMs(a.StepStart);
        const bStart = parseMs(b.StepStart);
        if (aStart && bStart && aStart !== bStart) {
          return aStart - bStart;
        }
        return 0;
      });
    }

    const iFlowId = logEntry.IntegrationArtifact?.Id || logEntry.IntegrationFlowName || "iFlow";
    let stepNameMap = {};
    let exceptionShapes = {};
    let bpmnFlowName = "";
    if (bpmnService) {
      try {
        const bpmnModel = await bpmnService.getModel(iFlowId);
        stepNameMap = bpmnModel?.steps || {};
        exceptionShapes = bpmnModel?.exceptionShapes || {};
        bpmnFlowName = bpmnModel?.flowName || "";
      } catch (eB) {
        console.debug("[CmdStepInspectorView] BPMN model query skipped/failed:", eB);
      }
    }

    const artifactName = (store ? store.getArtifactName(iFlowId) : "") || bpmnFlowName || logEntry.IntegrationArtifact?.Name || logEntry.IntegrationFlowName || iFlowId;

    const traceService = typeof CmdTraceService !== "undefined" ? CmdTraceService : null;
    let bpmnModel = { steps: stepNameMap, exceptionShapes: exceptionShapes, flowName: bpmnFlowName };
    let analysis = {
      isFailed: logEntry.Status === "FAILED" || logEntry.Status === "ESCALATED" || Boolean(logEntry.LastError),
      hasHandledException: false,
      failedSteps: (steps || []).filter((s) => s.Status === "FAILED" || s.Status === "ERROR" || Boolean(s.ErrorMessage)),
      triggerStepTitle: "a processing step",
      errorInfo: logEntry.LastError || "",
    };

    if (traceService && traceService.analyzeRunExceptions) {
      analysis = await traceService.analyzeRunExceptions(logEntry, steps, bpmnModel, runId);
    }

    const runGuid = logEntry.MessageGuid || logEntry.Id || "";
    const logStartMs = parseMs(logEntry.LogStart);
    const logEndMs = parseMs(logEntry.LogEnd);
    const runDurMs = logStartMs && logEndMs && logEndMs >= logStartMs ? logEndMs - logStartMs : Number(logEntry.Duration || 0);
    const runDurFormatted = utils.formatDuration ? utils.formatDuration(runDurMs) : `${runDurMs}ms`;

    // Parent lineage badge definition
    const parentFlow = logEntry._callerFlowId;
    const parentGuid = logEntry._callerMessageGuid || logEntry.PredecessorMessageGuid;
    const parentBadgeHtml = parentFlow
      ? `<span style="font-size: 0.72rem; color: #4338ca; background: #e0e7ff; border: 1px solid #c7d2fe; border-radius: 3px; padding: 1px 6px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 170px;" title="Called by parent flow: ${escapeHtml(parentFlow)}${parentGuid ? ` (GUID: ${escapeHtml(parentGuid)})` : ""}">Parent: ${escapeHtml(parentFlow)}</span>`
      : `<span style="font-size: 0.72rem; color: #047857; background: #d1fae5; border: 1px solid #a7f3d0; border-radius: 3px; padding: 1px 6px; font-weight: 600;" title="Initial flow execution or root trigger">Root Trigger</span>`;

    const runIdHeaderHtml = runGuid
      ? `<div style="display: flex; justify-content: space-between; align-items: center; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 5px 8px; font-size: 0.76rem; color: #475569; gap: 8px;">
           <div style="display: flex; align-items: center; gap: 6px; overflow: hidden; min-width: 0; flex: 1;">
             <span style="font-weight: 600; flex-shrink: 0;">Instance:</span>
             <span style="font-family: monospace; color: #0284c7; font-weight: bold; user-select: all; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(runGuid)}">${escapeHtml(runGuid)}</span>
             ${parentBadgeHtml}
           </div>
           <span style="flex-shrink: 0; font-weight: 600; color: #334155; background: #e2e8f0; border-radius: 3px; padding: 1px 6px;" title="Duration of this run">${runDurFormatted}</span>
         </div>`
      : "";

    const failedSteps = analysis.failedSteps || [];

    // Red Banner for Unhandled Fatal Failure
    let errorBannerHtml = "";
    if (analysis.isFailed && (analysis.errorInfo || failedSteps.length > 0)) {
      const multiStepWarning =
        failedSteps.length > 1
          ? `<div style="font-size: 0.74rem; color: #7f1d1d; margin-bottom: 6px; font-weight: 600;">
             Multiple failed steps detected (${failedSteps.length} failures across branches):
             <ul style="margin: 3px 0 0 16px; padding: 0;">
               ${failedSteps
                 .map((fs) => {
                   const fid = fs.ModelStepId || fs.StepId?.split("#")[0] || fs.StepId;
                   const fn = stepNameMap[fid] || fs.StepId;
                   return `<li><b>${escapeHtml(fn)}</b>: ${escapeHtml(fs.ErrorMessage || "Failed")}</li>`;
                 })
                 .join("")}
             </ul>
           </div>`
          : "";

      errorBannerHtml = `
        <div class="cmd-error-banner" style="background: #fef2f2; border: 1px solid #f87171; border-radius: 6px; padding: 10px; box-shadow: 0 1px 3px rgba(239, 68, 68, 0.08);">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <div style="font-weight: 700; color: #991b1b; font-size: 0.82rem; display: flex; align-items: center; gap: 6px;">
              <span class="ui mini red label" style="padding: 2px 6px; font-weight: bold;">FAILED</span>
              <span>${failedSteps.length > 1 ? `Multiple Execution Exceptions (${failedSteps.length})` : "Execution Exception"}</span>
            </div>
            <button class="ui mini compact button cmd-copy-error-btn" style="padding: 3px 8px; font-size: 0.72rem; background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5;">Copy Error</button>
          </div>
          ${multiStepWarning}
          <div class="cmd-error-text" style="font-family: monospace; font-size: 0.74rem; line-height: 1.35; color: #7f1d1d; background: #ffffff; border: 1px solid #fecaca; border-radius: 4px; padding: 8px; max-height: 140px; overflow-y: auto; white-space: pre-wrap; word-break: break-all; user-select: all;">${escapeHtml(analysis.errorInfo || "Execution failed.")}</div>
        </div>`;
    } else if (analysis.hasHandledException) {
      // Amber Banner for Caught / Handled Exception
      const triggerStepTitle = analysis.triggerStepTitle || "a processing step";
      const caughtMsg = analysis.errorInfo || `An exception occurred during execution and was caught by the Exception Subprocess.`;

      const multiStepHandledWarning =
        failedSteps.length > 1
          ? `<div style="font-size: 0.74rem; color: #78350f; margin-bottom: 6px;">
             <b>${failedSteps.length} exceptions caught across parallel branches:</b>
             <ul style="margin: 3px 0 0 16px; padding: 0;">
               ${failedSteps
                 .map((fs) => {
                   const fid = fs.ModelStepId || fs.StepId?.split("#")[0] || fs.StepId;
                   const fn = stepNameMap[fid] || fs.StepId;
                   return `<li><b>${escapeHtml(fn)}</b>: ${escapeHtml(fs.ErrorMessage || "Caught Exception")}</li>`;
                 })
                 .join("")}
             </ul>
           </div>`
          : `<div style="font-size: 0.76rem; color: #78350f; margin-bottom: 6px;">
             An exception was triggered on <b>${escapeHtml(triggerStepTitle)}</b>, and was caught &amp; handled by the flow's Exception Subprocess (Overall flow status: <b>COMPLETED</b>).
           </div>`;

      errorBannerHtml = `
        <div class="cmd-error-banner" style="background: #fffbeb; border: 1px solid #f59e0b; border-radius: 6px; padding: 10px; box-shadow: 0 1px 3px rgba(245, 158, 11, 0.08);">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <div style="font-weight: 700; color: #b45309; font-size: 0.82rem; display: flex; align-items: center; gap: 6px;">
              <span class="ui mini yellow label" style="padding: 2px 6px; font-weight: bold; background: #f59e0b; color: #ffffff;">CAUGHT EXCEPTION</span>
              <span>Handled by Exception Subprocess</span>
            </div>
            <button class="ui mini compact button cmd-copy-error-btn" style="padding: 3px 8px; font-size: 0.72rem; background: #fef3c7; color: #92400e; border: 1px solid #fde68a;">Copy Exception</button>
          </div>
          ${multiStepHandledWarning}
          <div class="cmd-error-text" style="font-family: monospace; font-size: 0.74rem; line-height: 1.35; color: #92400e; background: #ffffff; border: 1px solid #fde68a; border-radius: 4px; padding: 8px; max-height: 140px; overflow-y: auto; white-space: pre-wrap; word-break: break-all; user-select: all;">${escapeHtml(caughtMsg)}</div>
        </div>`;
    }

    if (!steps || steps.length === 0) {
      container.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 8px; padding-bottom: 30px;">
          ${runIdHeaderHtml}
          ${errorBannerHtml}
          <div style="padding: 16px; background: #fefce8; border: 1px solid #fef08a; border-radius: 6px; color: #854d0e; text-align: center; margin-top: 4px;">
            <div style="font-weight: bold; margin-bottom: 4px;">No Step Trace Payloads Available</div>
            <div style="font-size: 0.82rem;">Logged with LogLevel: <b>${escapeHtml(logEntry.LogLevel || "INFO")}</b></div>
            <div style="font-size: 0.78rem; margin-top: 6px; color: #713f12;">Set LogLevel to <b>TRACE</b> before triggering the flow to record intermediate step payloads.</div>
          </div>
        </div>`;

      const copyBtn = container.querySelector(".cmd-copy-error-btn");
      if (copyBtn) {
        copyBtn.onclick = () => {
          const errText = container.querySelector(".cmd-error-text")?.innerText || "";
          navigator.clipboard.writeText(errText).then(() => {
            copyBtn.innerText = "Copied!";
            setTimeout(() => {
              copyBtn.innerText = "Copy Exception";
            }, 2000);
          });
        };
      }
      return;
    }

    container.innerHTML = `
      <div id="cmd-steps-list-container" style="display: flex; flex-direction: column; gap: 8px; padding-bottom: 40px; box-sizing: border-box;">
        ${runIdHeaderHtml}
        ${errorBannerHtml}
      </div>
    `;

    const copyBtn = container.querySelector(".cmd-copy-error-btn");
    if (copyBtn) {
      copyBtn.onclick = () => {
        const errText = container.querySelector(".cmd-error-text")?.innerText || "";
        navigator.clipboard.writeText(errText).then(() => {
          copyBtn.innerText = "Copied!";
          setTimeout(() => {
            copyBtn.innerText = analysis.isFailed ? "Copy Error" : "Copy Exception";
          }, 2000);
        });
      };
    }

    const stepsListDiv = container.querySelector("#cmd-steps-list-container");
    const isFlowFailed = Boolean(analysis.isFailed);

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

      const isStepFailed = status === "FAILED" || status === "ERROR" || Boolean(step.ErrorMessage);
      const isInsideExceptionSubprocess =
        exceptionShapes[baseShapeId] ||
        exceptionShapes[baseShapeId.toLowerCase()] ||
        String(step.Activity || "")
          .toLowerCase()
          .includes("errorstart") ||
        String(step.Activity || "")
          .toLowerCase()
          .includes("exceptionsubprocess");

      let cardStyle = "border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px; background: #ffffff; box-shadow: 0 1px 3px rgba(0,0,0,0.04);";
      let statusBadgeClass = "green";
      let statusBadgeText = escapeHtml(status);

      if (isStepFailed) {
        cardStyle = isFlowFailed
          ? "border: 1px solid #f87171; border-radius: 6px; padding: 10px; background: #fff5f5; box-shadow: 0 1px 3px rgba(239,68,68,0.08);"
          : "border: 1px solid #f59e0b; border-radius: 6px; padding: 10px; background: #fffbeb; box-shadow: 0 1px 3px rgba(245,158,11,0.08);";
        statusBadgeClass = isFlowFailed ? "red" : "yellow";
        statusBadgeText = isFlowFailed ? "FAILED" : "CAUGHT ERROR";
      }

      const exceptionSubprocessTag = isInsideExceptionSubprocess
        ? `<span style="font-size: 0.7rem; color: #b45309; background: #fef3c7; border: 1px solid #fde68a; border-radius: 3px; padding: 1px 5px; font-weight: 600; margin-left: 4px;">Exception Subprocess</span>`
        : "";

      const stepErrorMessageHtml = step.ErrorMessage
        ? `<div style="margin-top: 6px; padding: 6px 8px; background: ${isFlowFailed ? "#fee2e2" : "#fef3c7"}; border: 1px solid ${isFlowFailed ? "#fca5a5" : "#fde68a"}; border-radius: 4px; font-size: 0.74rem; color: ${isFlowFailed ? "#991b1b" : "#92400e"}; font-family: monospace; word-break: break-all;">
             <b>${isFlowFailed ? "Error" : "Caught Exception"}:</b> ${escapeHtml(step.ErrorMessage)}
           </div>`
        : "";

      const stepCard = document.createElement("div");
      stepCard.style.cssText = cardStyle + " flex-shrink: 0; box-sizing: border-box;";

      stepCard.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: baseline; font-size: 0.85rem; gap: 8px;">
          <div style="display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; flex: 1; min-width: 0;">
            <span style="color: #64748b; font-size: 0.8rem; font-weight: normal; flex-shrink: 0;">#${idx + 1}</span>
            <span style="font-weight: 600; color: #0f172a; font-size: 0.88rem; word-break: break-word;">${escapeHtml(displayName)}</span>
            ${techInfo ? `<span style="font-size: 0.72rem; color: #64748b; font-weight: normal; font-family: monospace;">(${escapeHtml(techInfo)})</span>` : ""}
            ${exceptionSubprocessTag}
          </div>
          <div style="font-size: 0.75rem; color: #64748b; flex-shrink: 0; display: flex; align-items: center; gap: 6px;">
            <span class="ui mini label ${statusBadgeClass}" style="padding: 2px 6px;">${statusBadgeText}</span>
            <span>${duration}ms</span>
          </div>
        </div>

        ${stepErrorMessageHtml}

        <div style="margin-top: 8px; display: flex; gap: 6px;">
          <button class="ui mini button cmd-btn-props" style="padding: 5px 10px; font-size: 0.75rem; font-weight: 600;">Properties</button>
          <button class="ui mini button cmd-btn-headers" style="padding: 5px 10px; font-size: 0.75rem; font-weight: 600;">Headers</button>
          <button class="ui mini button cmd-btn-body" style="padding: 5px 10px; font-size: 0.75rem; font-weight: 600;">Body</button>
        </div>

        <div class="cmd-payload-display" style="display: none; margin-top: 8px;"></div>
      `;

      const displayBox = stepCard.querySelector(".cmd-payload-display");
      const btnProps = stepCard.querySelector(".cmd-btn-props");
      const btnHeaders = stepCard.querySelector(".cmd-btn-headers");
      const btnBody = stepCard.querySelector(".cmd-btn-body");

      const handleToggle = (type, btn) => {
        const isCurrentlyOpen = displayBox.style.display === "block";
        const currentType = stepCard.__activeType;

        // Reset styling on all 3 buttons
        [btnProps, btnHeaders, btnBody].forEach((b) => {
          if (b) {
            b.classList.remove("active", "primary");
            b.style.background = "";
            b.style.color = "";
            b.style.borderColor = "";
          }
        });

        if (isCurrentlyOpen && currentType === type) {
          // Toggle Closed
          displayBox.style.display = "none";
          displayBox.innerHTML = "";
          stepCard.__activeType = null;
          return;
        }

        // Toggle Open / Switch Type
        stepCard.__activeType = type;
        if (btn) {
          btn.classList.add("active", "primary");
          btn.style.background = "#0284c7";
          btn.style.color = "#ffffff";
          btn.style.borderColor = "#0284c7";
        }
        this.fetchStepData(runId, childCount, type, displayBox);
      };

      if (btnProps) btnProps.onclick = () => handleToggle("properties", btnProps);
      if (btnHeaders) btnHeaders.onclick = () => handleToggle("headers", btnHeaders);
      if (btnBody) btnBody.onclick = () => handleToggle("body", btnBody);

      if (stepsListDiv) stepsListDiv.appendChild(stepCard);
    });
  },

  /**
   * Fetches single step properties, headers, or body payload using CmdTraceService.
   */
  async fetchStepData(runId, childCount, type, container) {
    container.style.display = "block";
    container.innerHTML = `<div style="color: #94a3b8; font-size: 0.78rem; font-style: italic; padding: 6px;">Loading ${type}...</div>`;

    const traceService = typeof CmdTraceService !== "undefined" ? CmdTraceService : null;
    const codeViewer = typeof CmdCodeViewer !== "undefined" ? CmdCodeViewer : null;

    if (!traceService || !traceService.fetchStepPayload) {
      container.innerHTML = `<div style="color: #ef4444; font-size: 0.78rem;">CmdTraceService is not available.</div>`;
      return;
    }

    try {
      const data = await traceService.fetchStepPayload(runId, childCount, type);
      if (data === null || data === undefined) {
        container.innerHTML = `<div style="color: #94a3b8; font-size: 0.78rem; font-style: italic; padding: 6px; background: #0f172a; border-radius: 4px;">No trace data recorded for this step (TRACE log level was not active during this run, or payload was not captured).</div>`;
        return;
      }

      if (type === "properties" || type === "headers") {
        const title = type === "properties" ? "Exchange Properties" : "Headers";
        if (codeViewer) {
          codeViewer.renderPropertyTable(container, data, title);
        } else {
          container.innerText = JSON.stringify(data, null, 2);
        }
      } else if (type === "body") {
        if (codeViewer) {
          codeViewer.renderViewer(container, data || "(Empty Payload)", "Step Body Stream");
        } else {
          container.innerText = data || "(Empty Payload)";
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
