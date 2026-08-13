// ===========================================================================
// COMMNDO IS DEBUGGER - COMPLETE API CLIENT METHOD TEST RUNNER
// ===========================================================================
// Directly executes all 18 methods on CmdApiClient against the active tenant
// and displays a formatted diagnostic table on screen and in console.

const CmdTestEndpointRunner = {
  async runAllTests() {
    console.clear();
    console.log("%c=================================================", "color: #0070f3; font-weight: bold;");
    console.log("%c[Commondo Debugger] Testing All 18 CmdApiClient Methods", "color: #0070f3; font-weight: bold; font-size: 14px;");
    console.log("%c=================================================", "color: #0070f3; font-weight: bold;");

    const api = typeof CmdApiClient !== "undefined" ? CmdApiClient : null;
    if (!api) {
      console.error("[CmdTestEndpointRunner] CmdApiClient is not loaded.");
      return;
    }

    const host = api.getTenantHost();
    const isNeo = api.isNeo();
    const isCF = api.isCloudFoundry();
    const platform = isNeo ? "SAP Neo" : (isCF ? "Cloud Foundry (BTP)" : "Edge Integration Cell");
    const activeIFlow = (typeof cpiData !== "undefined" && cpiData.integrationFlowId) ? cpiData.integrationFlowId : "";
    let activePackage = (typeof cpiData !== "undefined" && cpiData.currentPackageId) ? cpiData.currentPackageId : "";

    console.log(`Tenant Host: %c${host}`, "font-weight: bold;");
    console.log(`Platform: %c${platform}`, "font-weight: bold; color: #10b981;");
    console.log(`Active iFlow: %c${activeIFlow || "(None open - navigate to an iFlow for full test)"}`, "font-weight: bold; color: #8b5cf6;");
    console.log(`Active Package: %c${activePackage || "(Auto-resolving...)"}`, "font-weight: bold; color: #0284c7;");

    const results = [];

    async function runMethodTest(num, name, fn) {
      const startTime = Date.now();
      try {
        const data = await fn();
        const duration = Date.now() - startTime;
        let count = "-";
        const ok = data !== null && data !== undefined;

        if (Array.isArray(data)) {
          count = `${data.length} items (${duration}ms)`;
        } else if (data instanceof ArrayBuffer) {
          count = `${(data.byteLength / 1024).toFixed(1)} KB Binary (${duration}ms)`;
        } else if (typeof data === "string") {
          count = data.length > 50 ? `${(data.length / 1024).toFixed(1)} KB Text (${duration}ms)` : `"${data}" (${duration}ms)`;
        } else if (data && typeof data === "object") {
          const keys = Object.keys(data);
          count = `Object (${keys.length} keys, ${duration}ms)`;
        } else if (typeof data === "boolean") {
          count = `${data} (${duration}ms)`;
        } else {
          count = `null (${duration}ms)`;
        }

        results.push({
          Method: testName,
          Status: ok ? "[PASS]" : "[FAIL]",
          Result: count,
          Data: data,
        });
        return data;
      } catch (e) {
        results.push({
          Method: testName,
          Status: "[ERROR]",
          Result: e.message,
          Data: null,
        });
        return null;
      }
    }

    // -------------------------------------------------------------
    // Group 1: Environment & Deployed Artifacts
    // -------------------------------------------------------------
    await runMethodTest("1", "api.fetchDeployedArtifacts()", () => api.fetchDeployedArtifacts(true));

    // -------------------------------------------------------------
    // Group 2: Message Logs & Correlation Tree
    // -------------------------------------------------------------
    const logs = await runMethodTest("2", "api.fetchMessageLogs(activeIFlow, 5)", () => api.fetchMessageLogs(activeIFlow, 5));

    const sampleLog = Array.isArray(logs) && logs.length > 0 ? logs[0] : null;
    const sampleGuid = sampleLog?.MessageGuid || null;
    const sampleCorrId = sampleLog?.CorrelationId || null;

    if (sampleCorrId) {
      await runMethodTest("3", "api.fetchCorrelationLogs(correlationId)", () => api.fetchCorrelationLogs(sampleCorrId));
    } else {
      results.push({ Method: "3. api.fetchCorrelationLogs(correlationId)", Status: "ℹ SKIP", Result: "No correlation logs found", Data: null });
    }

    // -------------------------------------------------------------
    // Group 3: Execution Runs, Steps & Custom Headers
    // -------------------------------------------------------------
    let sampleRunId = null;
    if (sampleGuid) {
      const runs = await runMethodTest("4", "api.fetchMessageRuns(messageGuid)", () => api.fetchMessageRuns(sampleGuid));
      sampleRunId = Array.isArray(runs) && runs.length > 0 ? runs[0]?.Id : null;

      await runMethodTest("5", "api.fetchCustomHeaderProperties(messageGuid)", () => api.fetchCustomHeaderProperties(sampleGuid));
    } else {
      results.push({ Method: "4. api.fetchMessageRuns(messageGuid)", Status: "ℹ SKIP", Result: "No message run found", Data: null });
      results.push({ Method: "5. api.fetchCustomHeaderProperties(messageGuid)", Status: "ℹ SKIP", Result: "No message run found", Data: null });
    }

    let sampleChildCount = null;
    if (sampleRunId) {
      const steps = await runMethodTest("6", "api.fetchRunSteps(runId, 10)", () => api.fetchRunSteps(sampleRunId, 10));
      sampleChildCount = Array.isArray(steps) && steps.length > 0 && steps[0]?.ChildCount !== undefined ? steps[0].ChildCount : 1;
    } else {
      results.push({ Method: "6. api.fetchRunSteps(runId, 10)", Status: "ℹ SKIP", Result: "No run ID available", Data: null });
    }

    let sampleTraceId = null;
    if (sampleRunId && sampleChildCount !== null) {
      const traceMsgs = await runMethodTest("7", "api.fetchStepTraceMessages(runId, childCount)", () => api.fetchStepTraceMessages(sampleRunId, sampleChildCount));
      sampleTraceId = Array.isArray(traceMsgs) && traceMsgs.length > 0 ? traceMsgs[0]?.TraceId : null;
    } else {
      results.push({ Method: "7. api.fetchStepTraceMessages(runId, childCount)", Status: "ℹ SKIP", Result: "No run step available", Data: null });
    }

    // -------------------------------------------------------------
    // Group 4: Step Payloads (ExchangeProperties, Headers, Body)
    // -------------------------------------------------------------
    if (sampleTraceId) {
      await runMethodTest("8", "api.fetchStepExchangeProperties(traceId)", () => api.fetchStepExchangeProperties(sampleTraceId));
      await runMethodTest("9", "api.fetchStepHeaders(traceId)", () => api.fetchStepHeaders(sampleTraceId));
      await runMethodTest("10", "api.fetchStepBodyPayload(traceId, 'text')", () => api.fetchStepBodyPayload(sampleTraceId, "text"));
    } else {
      results.push({ Method: "8. api.fetchStepExchangeProperties(traceId)", Status: "ℹ SKIP", Result: "Trace token expired / Run was INFO level", Data: null });
      results.push({ Method: "9. api.fetchStepHeaders(traceId)", Status: "ℹ SKIP", Result: "Trace token expired / Run was INFO level", Data: null });
      results.push({ Method: "10. api.fetchStepBodyPayload(traceId, 'text')", Status: "ℹ SKIP", Result: "Trace token expired / Run was INFO level", Data: null });
    }

    // -------------------------------------------------------------
    // Group 5: Workspace Packages & Artifacts
    // -------------------------------------------------------------
    const pkgs = await runMethodTest("11", "api.fetchWorkspacePackages()", () => api.fetchWorkspacePackages());

    if (!activePackage && Array.isArray(pkgs) && pkgs.length > 0) {
      activePackage = pkgs[0].technicalName || pkgs[0].name || pkgs[0].Name || "";
    }

    await runMethodTest("12", "api.resolveCurrentPackageId(activeIFlow)", () => api.resolveCurrentPackageId(activeIFlow));
    await runMethodTest("13", "api.resolveWorkspaceGuid(activePackage)", () => api.resolveWorkspaceGuid(activePackage));

    if (activePackage) {
      await runMethodTest("14", "api.fetchPackageArtifacts(activePackage)", () => api.fetchPackageArtifacts(activePackage));
    } else {
      results.push({ Method: "14. api.fetchPackageArtifacts(activePackage)", Status: "ℹ SKIP", Result: "No package available", Data: null });
    }

    // -------------------------------------------------------------
    // Group 6: Modeler JSON & Artifact ZIP Download
    // -------------------------------------------------------------
    if (isCF && activeIFlow) {
      await runMethodTest("15", "api.fetchModelerJson(activeIFlow, activePackage)", () => api.fetchModelerJson(activeIFlow, activePackage));
    } else {
      results.push({ Method: "15. api.fetchModelerJson(activeIFlow, activePackage)", Status: isCF ? "ℹ SKIP" : "ℹ N/A (Neo uses ZIP)", Result: isCF ? "No active iFlow" : "Platform is Neo", Data: null });
    }

    if (isNeo && activeIFlow) {
      await runMethodTest("16", "api.fetchArtifactZip(activeIFlow, 'active')", () => api.fetchArtifactZip(activeIFlow, "active"));
    } else {
      results.push({ Method: "16. api.fetchArtifactZip(activeIFlow, 'active')", Status: isNeo ? "ℹ SKIP" : "ℹ N/A (CF uses JSON)", Result: isNeo ? "No active iFlow" : "Platform is CF", Data: null });
    }

    // -------------------------------------------------------------
    // Group 7: Design-time URL Builder
    // -------------------------------------------------------------
    await runMethodTest("17", "api.buildDesignUrl(activeIFlow, activePackage)", () => api.buildDesignUrl(activeIFlow, activePackage));

    // -------------------------------------------------------------
    // Group 8: TRACE Log Level Command
    // -------------------------------------------------------------
    if (activeIFlow) {
      await runMethodTest("18", "api.setMplLogLevel(activeIFlow, 'INFO')", () => api.setMplLogLevel(activeIFlow, "INFO"));
    } else {
      results.push({ Method: "18. api.setMplLogLevel(activeIFlow, 'INFO')", Status: "ℹ SKIP", Result: "No active iFlow open", Data: null });
    }

    console.log("\n");
    console.table(results.map((r) => ({ Method: r.Method, Status: r.Status, Result: r.Result })));
    console.log("%c=================================================", "color: #0070f3; font-weight: bold;");

    // Render floating on-screen dialog
    this.renderOnScreenDialog(platform, host, activeIFlow, results);
  },

  renderOnScreenDialog(platform, host, activeIFlow, results) {
    const old = document.getElementById("__cmd_endpoint_test_modal");
    if (old) old.remove();

    const modal = document.createElement("div");
    modal.id = "__cmd_endpoint_test_modal";
    modal.style.cssText = "position: fixed; top: 20px; right: 20px; width: 750px; max-width: 95vw; background: #ffffff; border: 2px solid #0070f3; border-radius: 8px; box-shadow: 0 8px 30px rgba(0,0,0,0.35); z-index: 999999; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; overflow: hidden;";

    let rowsHtml = "";
    results.forEach((r) => {
      const isPass = r.Status.includes("PASS");
      const isSkip = r.Status.includes("SKIP") || r.Status.includes("N/A");
      const statusColor = isPass ? "#10b981" : (isSkip ? "#64748b" : "#ef4444");
      const bgColor = isPass ? "#fff" : (isSkip ? "#f8fafc" : "#fef2f2");

      rowsHtml += `
        <tr style="border-bottom: 1px solid #f1f5f9; background: ${bgColor};">
          <td style="padding: 7px 10px; font-weight: 600; font-size: 0.8rem; color: #1e293b; font-family: monospace;">${r.Method}</td>
          <td style="padding: 7px 10px; font-weight: bold; font-size: 0.8rem; color: ${statusColor}; white-space: nowrap;">${r.Status}</td>
          <td style="padding: 7px 10px; font-size: 0.78rem; color: #475569; white-space: nowrap;">${r.Result}</td>
        </tr>
      `;
    });

    modal.innerHTML = `
      <div style="background: #0070f3; color: #fff; padding: 10px 14px; display: flex; justify-content: space-between; align-items: center;">
        <span style="font-weight: bold; font-size: 0.95rem;">All 18 CmdApiClient Methods — Live Tenant Verification</span>
        <span id="__cmd_api_modal_close" style="cursor: pointer; font-size: 1.3rem; font-weight: bold; line-height: 1;">&times;</span>
      </div>
      <div style="padding: 8px 14px; font-size: 0.78rem; background: #f8fafc; border-bottom: 1px solid #e2e8f0; color: #64748b; display: flex; flex-wrap: wrap; gap: 10px;">
        <span><b>Platform:</b> ${platform}</span>
        <span><b>Host:</b> ${host}</span>
        ${activeIFlow ? `<span><b>iFlow:</b> ${activeIFlow}</span>` : ""}
        ${activePackage ? `<span><b>Package:</b> ${activePackage}</span>` : ""}
      </div>
      <div style="max-height: 520px; overflow-y: auto;">
        <table style="width: 100%; border-collapse: collapse; text-align: left;">
          <thead>
            <tr style="background: #f1f5f9; color: #475569; font-size: 0.75rem; text-transform: uppercase;">
              <th style="padding: 8px 10px;">Method</th>
              <th style="padding: 8px 10px;">Status</th>
              <th style="padding: 8px 10px;">Result / Latency</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>
      <div style="padding: 8px 14px; background: #f8fafc; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center;">
        <span style="font-size: 0.74rem; color: #64748b;">Open DevTools Console (F12) to inspect raw JSON payloads.</span>
        <button id="__cmd_api_modal_retest" style="background: #0070f3; color: #fff; border: none; padding: 6px 14px; border-radius: 4px; font-size: 0.8rem; font-weight: bold; cursor: pointer; box-shadow: 0 2px 6px rgba(0,112,243,0.3);">Re-run All 18 Methods</button>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector("#__cmd_api_modal_close").onclick = () => modal.remove();
    modal.querySelector("#__cmd_api_modal_retest").onclick = () => this.runAllTests();
  },

  injectFloatingButton() {
    if (document.getElementById("__cmd_api_floating_btn")) return;
    const btn = document.createElement("button");
    btn.id = "__cmd_api_floating_btn";
    btn.title = "Test All 18 CmdApiClient Methods Live";
    btn.style.cssText = "position: fixed; bottom: 20px; right: 20px; z-index: 99999; background: #0070f3; color: #ffffff; border: none; border-radius: 20px; padding: 8px 16px; font-size: 0.85rem; font-weight: bold; cursor: pointer; box-shadow: 0 4px 14px rgba(0,112,243,0.4); display: flex; align-items: center; gap: 6px; font-family: -apple-system, BlinkMacSystemFont, sans-serif;";
    btn.innerHTML = `<span>[Test]</span> Test All 18 APIs`;

    btn.onclick = () => this.runAllTests();
    document.body.appendChild(btn);
  },

  init() {
    this.injectFloatingButton();
    setInterval(() => this.injectFloatingButton(), 3000);
  },
};

// Global shortcuts
window.CmdTestEndpointRunner = CmdTestEndpointRunner;
window.runEndpointTest = () => CmdTestEndpointRunner.runAllTests();

// Auto-inject floating button
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => CmdTestEndpointRunner.init());
} else {
  CmdTestEndpointRunner.init();
}
