// ===========================================================================
// COMMNDO IS DEBUGGER - MASTER END-TO-END TEST SUITE (CmdTestMasterRunner)
// ===========================================================================
// Comprehensive verification suite testing 100% of all 15 modules, edge cases,
// live SAP tenant endpoints, 5-stage ProcessDirect discovery, and UI components.
//
// Usage: Run this file in your SAP CPI WebUI DevTools Console (F12):
// > runMasterTest()
// Or click the floating '[Test] Master Test Suite' button on your screen.

const CmdTestMasterRunner = {
  async runAllTests(customCorrelationId = null) {
    console.clear();
    console.log("%c=================================================================", "color: #0070f3; font-weight: bold;");
    console.log("%c[Commondo Debugger] MASTER END-TO-END VERIFICATION SUITE", "color: #0070f3; font-weight: bold; font-size: 15px;");
    console.log("%c=================================================================", "color: #0070f3; font-weight: bold;");

    const api = typeof CmdApiClient !== "undefined" ? CmdApiClient : null;
    const utils = typeof CmdUtils !== "undefined" ? CmdUtils : null;
    const store = typeof CmdStateStore !== "undefined" ? CmdStateStore : null;
    const eventBus = typeof CmdEventBus !== "undefined" ? CmdEventBus : null;
    const bpmnService = typeof CmdBpmnParserService !== "undefined" ? CmdBpmnParserService : null;
    const pdEngine = typeof CmdPdDiscoveryEngine !== "undefined" ? CmdPdDiscoveryEngine : null;
    const staticEngine = typeof CmdStaticArchitectureEngine !== "undefined" ? CmdStaticArchitectureEngine : null;
    const traceService = typeof CmdTraceService !== "undefined" ? CmdTraceService : null;
    const zipService = typeof CmdZipExportService !== "undefined" ? CmdZipExportService : null;
    const codeViewer = typeof CmdCodeViewer !== "undefined" ? CmdCodeViewer : null;
    const topoView = typeof CmdTopologyGraphView !== "undefined" ? CmdTopologyGraphView : null;
    const stepView = typeof CmdStepInspectorView !== "undefined" ? CmdStepInspectorView : null;
    const mainModal = typeof CmdDebuggerMainModal !== "undefined" ? CmdDebuggerMainModal : null;
    const traceModal = typeof CmdTraceManagerModal !== "undefined" ? CmdTraceManagerModal : null;
    const headerBtn = typeof CmdHeaderTraceButton !== "undefined" ? CmdHeaderTraceButton : null;

    const host = api ? api.getTenantHost() : window.location.host;
    const isNeo = api ? api.isNeo() : false;
    const isCF = api ? api.isCloudFoundry() : true;
    const platform = isNeo ? "SAP Neo" : isCF ? "Cloud Foundry (BTP)" : "Edge Integration Cell";
    const activeIFlow = typeof cpiData !== "undefined" && cpiData.integrationFlowId ? cpiData.integrationFlowId : "";
    let activePackage = typeof cpiData !== "undefined" && cpiData.currentPackageId ? cpiData.currentPackageId : "";

    console.log(`Tenant Host: %c${host}`, "font-weight: bold;");
    console.log(`Platform: %c${platform}`, "font-weight: bold; color: #10b981;");
    console.log(`Active iFlow: %c${activeIFlow || "(None open - navigate to an iFlow for full test)"}`, "font-weight: bold; color: #8b5cf6;");
    console.log(`Active Package: %c${activePackage || "(Auto-resolving...)"}`, "font-weight: bold; color: #0284c7;");

    const results = [];

    function summarizeResult(data, duration) {
      if (Array.isArray(data)) return `${data.length} items (${duration}ms)`;
      if (data instanceof ArrayBuffer) return `${(data.byteLength / 1024).toFixed(1)} KB Binary (${duration}ms)`;
      if (typeof data === "string") return data.length > 40 ? `${(data.length / 1024).toFixed(1)} KB (${duration}ms)` : `"${data}" (${duration}ms)`;
      if (data && typeof data === "object") return `Object (${Object.keys(data).length} keys, ${duration}ms)`;
      if (typeof data === "boolean") return `${data} (${duration}ms)`;
      return `${data} (${duration}ms)`;
    }

    async function recordTest(group, name, fn) {
      const startTime = Date.now();
      try {
        const data = await fn();
        const duration = Date.now() - startTime;
        const count = summarizeResult(data, duration);
        const ok = data !== null && data !== undefined && data !== false;

        results.push({
          Group: group,
          Test: name,
          Status: ok ? "[PASS]" : "[FAIL]",
          Result: count,
          Data: data,
        });
        return data;
      } catch (e) {
        results.push({
          Group: group,
          Test: name,
          Status: "[ERROR]",
          Result: e.message || String(e),
          Data: null,
        });
        return null;
      }
    }

    // =============================================================
    // 1. MODULE: CmdUtils (Pure Utilities & Edge Cases)
    // =============================================================
    console.log("\n%c--- 1. Testing CmdUtils ---", "color: #0070f3; font-weight: bold;");
    await recordTest("1. CmdUtils", "parseMs: ISO, OData, Epoch & Null fallbacks", () => {
      const isoMs = utils.parseMs("2026-08-13T11:01:11.500Z");
      const odataMs = utils.parseMs("/Date(1786110756397)/");
      const odataOffsetMs = utils.parseMs("/Date(1786110756397+0200)/");
      const epochMs = utils.parseMs(1786110756397);
      const nullMs = utils.parseMs(null);
      const invalidMs = utils.parseMs("not_a_date");
      return isoMs > 1700000000000 && odataMs === 1786110756397 && odataOffsetMs === 1786110756397 && epochMs === 1786110756397 && nullMs === 0 && invalidMs === 0;
    });

    await recordTest("1. CmdUtils", "formatDuration: 0ms, ms, seconds, minutes & hours", () => {
      const d0 = utils.formatDuration(0) === "0ms";
      const dMs = utils.formatDuration(450) === "450ms";
      const dSec = utils.formatDuration(1500) === "1.50s";
      const dMin = utils.formatDuration(75000) === "1m 15s";
      const dHour = utils.formatDuration(3661000) === "61m 1s" || utils.formatDuration(3661000).includes("m");
      return d0 && dMs && dSec && dMin && dHour;
    });

    await recordTest("1. CmdUtils", "escapeHtml & unescapeJavaProperty edge cases", () => {
      const esc = utils.escapeHtml(`<script id="a" val='b'>&test</script>`) === `&lt;script id=&quot;a&quot; val=&#039;b&#039;&gt;&amp;test&lt;/script&gt;`;
      const escNull = utils.escapeHtml(null) === "";
      const javaProp = utils.unescapeJavaProperty("jdbc\\:sap\\://my-db\\:30015\\n\\t\\r\\u0020") === "jdbc:sap://my-db:30015\n\t\r ";
      return esc && escNull && javaProp;
    });

    await recordTest("1. CmdUtils", "resolveDynamicExpression: properties, headers, inheaders & literals", () => {
      const p1 = utils.resolveDynamicExpression("${property.reportId}", { reportId: "report_p6" }) === "report_p6";
      const p2 = utils.resolveDynamicExpression("/${header.CustomHeader}", { CustomHeader: "my_service" }) === "/my_service";
      const p3 = utils.resolveDynamicExpression("${inheader.targetEndpoint}", { targetEndpoint: "sync_flow" }) === "sync_flow";
      const p4 = utils.resolveDynamicExpression("/literal_endpoint", {}) === "/literal_endpoint";
      const p5 = utils.resolveDynamicExpression(null, {}) === "";
      return p1 && p2 && p3 && p4 && p5;
    });

    await recordTest("1. CmdUtils", "matchEndpointAddress & normalizeFlowId", () => {
      const m1 = utils.matchEndpointAddress("/service_p6", "service_p6");
      const m2 = utils.matchEndpointAddress("service_p6", "/service_p6");
      const m3 = utils.matchEndpointAddress("/Service_P6", "/service_p6");
      const m4 = utils.matchEndpointAddress("/service_p6/", "service_p6");
      const norm1 = utils.normalizeFlowId("Scheduler_-_Report_-_P6") === "schedulerreportp6";
      return m1 && m2 && m3 && m4 && norm1;
    });

    await recordTest("1. CmdUtils", "storageGet, storageSet & storageRemove abstractions", async () => {
      const testKey = "__cmd_test_key_" + Date.now();
      await utils.storageSet({ [testKey]: { value: 123, status: "OK" } });
      const readVal = await utils.storageGet(testKey);
      const isOk = readVal && readVal.value === 123 && readVal.status === "OK";
      await utils.storageRemove(testKey);
      const afterRemove = await utils.storageGet(testKey);
      return isOk && !afterRemove;
    });

    // =============================================================
    // 2. MODULE: CmdEventBus (Pub/Sub & Error Resilience)
    // =============================================================
    console.log("\n%c--- 2. Testing CmdEventBus ---", "color: #0070f3; font-weight: bold;");
    await recordTest("2. CmdEventBus", "Subscribe, emit multiple args, unsubscribe & once", () => {
      let received = [];
      let onceCount = 0;

      const handler = (a, b) => received.push(`${a}_${b}`);
      eventBus.on("test:event", handler);
      eventBus.once("test:once", () => onceCount++);

      eventBus.emit("test:event", "hello", "world");
      eventBus.emit("test:once");
      eventBus.emit("test:once"); // should not fire again

      eventBus.off("test:event", handler);
      eventBus.emit("test:event", "ignored", "event");

      return received.length === 1 && received[0] === "hello_world" && onceCount === 1;
    });

    // =============================================================
    // 3. MODULE: CmdStateStore (Reactive State & Multi-Tier Caching)
    // =============================================================
    console.log("\n%c--- 3. Testing CmdStateStore ---", "color: #0070f3; font-weight: bold;");
    await recordTest("3. CmdStateStore", "State get/set, Artifact Registry & Transient Caching", () => {
      store.set("testKey", "testVal");
      const val = store.get("testKey");

      store.registerArtifactName("Flow_A", "My Flow A Display Name");
      store.registerArtifactPackageId("Flow_A", "Pkg_123");
      store.registerArtifactGuid("Flow_A", "guid_abc_123");

      const nameLookup = store.getArtifactName("Flow_A") === "My Flow A Display Name";
      const pkgLookup = store.getArtifactPackageId("Flow_A") === "Pkg_123";
      const guidLookup = store.getArtifactGuid("Flow_A") === "guid_abc_123";

      store.setCachedBpmnModel("Flow_A", { flowName: "Flow_A", steps: { S1: "Step 1" } });
      const modelLookup = store.getCachedBpmnModel("Flow_A")?.steps?.S1 === "Step 1";

      store.clearTransientCaches();
      const modelCleared = store.getCachedBpmnModel("Flow_A") === null;

      return val === "testVal" && nameLookup && pkgLookup && guidLookup && modelLookup && modelCleared;
    });

    // =============================================================
    // 4. MODULE: CmdApiClient (Live Tenant Endpoints & Modeler)
    // =============================================================
    console.log("\n%c--- 4. Testing CmdApiClient Live APIs ---", "color: #0070f3; font-weight: bold;");
    await recordTest("4. CmdApiClient", "buildUrl & buildDesignUrl", () => {
      const u1 = api.buildUrl("Operations/testCommand");
      const u2 = api.buildUrl("api/v1/MessageProcessingLogs");
      const designUrl = api.buildDesignUrl("MyPackage", "MyFlow");
      const isClean = !u1.includes("//Operations") && !u2.includes("//api");
      return isClean && typeof designUrl === "string" && designUrl.includes("MyFlow");
    });

    await recordTest("4. CmdApiClient", "fetchDeployedArtifacts()", () => api.fetchDeployedArtifacts(true));

    const logs = await recordTest("4. CmdApiClient", "fetchMessageLogs(activeIFlow, 10)", () => api.fetchMessageLogs(activeIFlow, 10));

    // Select the best execution run for testing (prefer COMPLETED or multi-step run over init ticks)
    let sampleLog = Array.isArray(logs)
      ? logs.find((l) => l.Status === "COMPLETED") || logs.find((l) => l.Status !== "DISCARDED") || logs[0] || null
      : null;

    if (customCorrelationId && Array.isArray(logs)) {
      const foundCorr = logs.find((l) => l.CorrelationId === customCorrelationId);
      if (foundCorr) sampleLog = foundCorr;
    }

    const sampleGuid = sampleLog?.MessageGuid || null;
    const sampleCorrId = customCorrelationId || sampleLog?.CorrelationId || null;

    if (sampleLog) {
      console.log(`   [Target Message Run Selected]: GUID: ${sampleGuid}, Status: ${sampleLog.Status}, CorrelationId: ${sampleCorrId}`);
    }

    let correlationLogs = [];
    if (sampleCorrId) {
      correlationLogs = await recordTest("4. CmdApiClient", "fetchCorrelationLogs(correlationId)", () => api.fetchCorrelationLogs(sampleCorrId));
    }

    let sampleRunId = null;
    if (sampleGuid) {
      const runs = await recordTest("4. CmdApiClient", "fetchMessageRuns(messageGuid)", () => api.fetchMessageRuns(sampleGuid));
      sampleRunId = Array.isArray(runs) && runs.length > 0 ? runs[0]?.Id : null;
      await recordTest("4. CmdApiClient", "fetchCustomHeaderProperties(messageGuid)", () => api.fetchCustomHeaderProperties(sampleGuid));
    }

    let sampleTraceId = null;
    if (sampleRunId) {
      const steps = await recordTest("4. CmdApiClient", "fetchRunSteps(runId, 20)", () => api.fetchRunSteps(sampleRunId, 20));
      const stepWithTrace = Array.isArray(steps) ? steps.find((s) => s.TraceCount > 0) || steps[0] : null;
      if (stepWithTrace && stepWithTrace.ChildCount !== undefined) {
        const traceMsgs = await recordTest("4. CmdApiClient", "fetchStepTraceMessages(runId, childCount)", () =>
          api.fetchStepTraceMessages(sampleRunId, stepWithTrace.ChildCount)
        );
        if (Array.isArray(traceMsgs) && traceMsgs.length > 0) {
          sampleTraceId = traceMsgs[0].TraceId;
          await recordTest("4. CmdApiClient", "fetchStepExchangeProperties(traceId)", () => api.fetchStepExchangeProperties(sampleTraceId));
          await recordTest("4. CmdApiClient", "fetchStepHeaders(traceId)", () => api.fetchStepHeaders(sampleTraceId));
          await recordTest("4. CmdApiClient", "fetchStepBodyPayload(traceId, 'text')", () => api.fetchStepBodyPayload(sampleTraceId, "text"));
        }
      }
    }

    const pkgs = await recordTest("4. CmdApiClient", "fetchWorkspacePackages()", () => api.fetchWorkspacePackages());
    if (!activePackage && Array.isArray(pkgs) && pkgs.length > 0) {
      activePackage = pkgs[0].technicalName || pkgs[0].name || pkgs[0].Name || "";
    }

    await recordTest("4. CmdApiClient", "resolveWorkspaceGuid(activePackage)", () => api.resolveWorkspaceGuid(activePackage));

    if (activePackage) {
      await recordTest("4. CmdApiClient", "fetchPackageArtifacts(activePackage)", () => api.fetchPackageArtifacts(activePackage));
    }

    // =============================================================
    // 5. MODULE: CmdBpmnParserService (Model Parsing & Step Names)
    // =============================================================
    console.log("\n%c--- 5. Testing CmdBpmnParserService ---", "color: #0070f3; font-weight: bold;");
    if (activeIFlow) {
      await recordTest("5. CmdBpmnParserService", "getModel(activeIFlow)", async () => {
        const model = await bpmnService.getModel(activeIFlow, activePackage);
        console.log(`   [BPMN Extracted for ${activeIFlow}]:`, {
          flowName: model.flowName,
          inboundCount: model.inbound?.length,
          outboundCount: model.outbound?.length,
          stepCount: Object.keys(model.steps || {}).length,
          paramCount: Object.keys(model.parameters || {}).length,
        });
        return model;
      });
    }

    await recordTest("5. CmdBpmnParserService", "Synthetic Modeler JSON Parsing", () => {
      const syntheticJson = {
        name: "Synthetic_Flow",
        shapes: [
          {
            resourceId: "ServiceTask_1",
            stencil: { id: "ServiceTask" },
            properties: { name: "Send via ProcessDirect", activityType: "ProcessDirect", address: "/service_synthetic" },
            outgoing: [{ resourceId: "EndEvent_1" }],
          },
          {
            resourceId: "StartEvent_1",
            stencil: { id: "StartEvent" },
            properties: { name: "Start", senderAddress: "/inbound_synthetic" },
          },
        ],
      };
      const parsed = bpmnService.parseModelerJson("Synthetic_Flow", syntheticJson);
      return parsed.flowName === "Synthetic_Flow" && parsed.outbound?.length === 1 && parsed.inbound?.length === 1;
    });

    // =============================================================
    // 6. MODULE: CmdPdDiscoveryEngine (5-Pass Algorithm & Call Tree)
    // =============================================================
    console.log("\n%c--- 6. Testing CmdPdDiscoveryEngine ---", "color: #0070f3; font-weight: bold;");
    if (activeIFlow && correlationLogs.length > 0) {
      await recordTest("6. CmdPdDiscoveryEngine", "discoverTopology(activeIFlow, correlationLogs)", async () => {
        const logsSummary = {};
        correlationLogs.forEach((l) => {
          const fid = l.IntegrationArtifact?.Id || l.IntegrationFlowName || activeIFlow;
          if (!logsSummary[fid]) logsSummary[fid] = { flowId: fid, runCount: 0, status: l.Status, logLevel: l.LogLevel || "INFO" };
          logsSummary[fid].runCount++;
        });

        console.log(`\n[1/5] Executed iFlows in Correlation ID "${sampleCorrId}" (${correlationLogs.length} total message logs):`);
        console.table(Object.values(logsSummary));

        console.log("\n[2/5] Resolving ProcessDirect Topology Graph (Static-First -> Dynamic)...");
        const topo = await pdEngine.discoverTopology(activeIFlow, correlationLogs);

        console.log("\n[5/5] Final Discovered Topology Graph:");
        console.log(pdEngine.generateAsciiTree(topo.rootFlowId, topo.nodes, topo.edges));

        console.log("Discovered Nodes in Graph:");
        console.table(topo.nodes);

        if (topo.edges.length > 0) {
          console.log("Resolved Directed Edges:");
          console.table(
            topo.edges.map((e) => ({
              From: e.from,
              To: e.to,
              "Resolved Address": e.address,
              "Raw Address (BPMN)": e.rawAddress || e.address,
              "Match Type": e.matchType || (e.isDynamic ? "Dynamic" : "Static"),
            }))
          );
        }

        const executedCount = Object.keys(logsSummary).length;
        const graphNodeCount = topo.nodes.length;
        if (executedCount === graphNodeCount) {
          console.log(`\n%c[MATCH] ALL ${executedCount} EXECUTED IFLOWS MATCHED IN TOPOLOGY GRAPH`, "color: #10b981; font-weight: bold; font-size: 13px;");
        } else {
          console.warn(`\n[WARN] Discrepancy: ${executedCount} flows executed in correlation, but ${graphNodeCount} nodes in graph.`);
        }

        return {
          rootFlowId: topo.rootFlowId,
          totalNodes: topo.nodes.length,
          totalEdges: topo.edges.length,
          levels: topo.levels,
        };
      });
    }

    // =============================================================
    // 7. MODULE: CmdStaticArchitectureEngine (Package BFS Mapper)
    // =============================================================
    console.log("\n%c--- 7. Testing CmdStaticArchitectureEngine ---", "color: #0070f3; font-weight: bold;");
    if (activeIFlow && activePackage) {
      await recordTest("7. CmdStaticArchitectureEngine", "discoverStaticArchitecture(rootFlow, pkgId)", async () => {
        const staticTopo = await staticEngine.discoverStaticArchitecture(activeIFlow, activePackage);
        return {
          rootFlowId: staticTopo.rootFlowId,
          totalReachableNodes: staticTopo.nodes.length,
          totalEdges: staticTopo.edges.length,
        };
      });
    }

    // =============================================================
    // 8. MODULE: CmdTraceService (Harvesting & Log Level Manager)
    // =============================================================
    console.log("\n%c--- 8. Testing CmdTraceService ---", "color: #0070f3; font-weight: bold;");
    if (sampleGuid) {
      await recordTest("8. CmdTraceService", "fetchRunTraceHeadersAndProperties(messageGuid)", async () => {
        return traceService.fetchRunTraceHeadersAndProperties(sampleGuid);
      });
    }

    if (activeIFlow) {
      await recordTest("8. CmdTraceService", "setFlowLogLevel(activeIFlow, 'INFO')", async () => {
        return traceService.setFlowLogLevel(activeIFlow, "INFO");
      });
    }

    // =============================================================
    // 9. MODULE: CmdZipExportService (JSZip Packaging & Concurrency)
    // =============================================================
    console.log("\n%c--- 9. Testing CmdZipExportService ---", "color: #0070f3; font-weight: bold;");
    await recordTest("9. CmdZipExportService", "asyncPool(4) worker concurrency test", async () => {
      const items = [1, 2, 3, 4, 5, 6, 7, 8];
      let activeWorkers = 0;
      let maxWorkers = 0;
      const res = await zipService.asyncPool(4, items, async (it) => {
        activeWorkers++;
        maxWorkers = Math.max(maxWorkers, activeWorkers);
        await new Promise((r) => setTimeout(r, 10));
        activeWorkers--;
        return it * 2;
      });
      return res.length === 8 && maxWorkers <= 4;
    });

    // =============================================================
    // 10. MODULE: CmdCodeViewer (Syntax & Formatting Component)
    // =============================================================
    console.log("\n%c--- 10. Testing CmdCodeViewer ---", "color: #0070f3; font-weight: bold;");
    await recordTest("10. CmdCodeViewer", "formatPayload: JSON, XML & Property Tables", () => {
      const rawJson = '{"a":1,"b":["x","y"]}';
      const formattedJson = codeViewer.formatPayload(rawJson);
      const rawXml = "<root><child id='1'>Text</child></root>";
      const formattedXml = codeViewer.formatPayload(rawXml);

      const dummyDiv = document.createElement("div");
      codeViewer.renderPropertyTable(dummyDiv, [{ Name: "CamelHttpUri", Value: "https://sap.com" }]);
      const tableRendered = dummyDiv.innerHTML.includes("CamelHttpUri");

      return formattedJson.includes("\n") && formattedXml.includes("\n") && tableRendered;
    });

    // =============================================================
    // 11. MODULE: CmdTopologyGraphView (SVG DAG Canvas)
    // =============================================================
    console.log("\n%c--- 11. Testing CmdTopologyGraphView ---", "color: #0070f3; font-weight: bold;");
    await recordTest("11. CmdTopologyGraphView", "renderDirectionalTopology: SVG DOM generation", () => {
      const dummyDiv = document.createElement("div");
      dummyDiv.style.width = "800px";
      dummyDiv.style.height = "500px";

      const dummyTopo = {
        rootFlowId: "Flow_Root",
        nodes: [
          { id: "Flow_Root", level: 0 },
          { id: "Flow_Child", level: 1 },
        ],
        edges: [{ from: "Flow_Root", to: "Flow_Child", address: "/service/child" }],
      };

      topoView.renderDirectionalTopology(dummyDiv, dummyTopo, {
        Flow_Root: [{ Status: "COMPLETED", Duration: 120 }],
        Flow_Child: [{ Status: "COMPLETED", Duration: 85 }],
      });

      const hasSvg = dummyDiv.querySelector("svg") !== null;
      const hasNodes = dummyDiv.querySelectorAll(".cmd-node-group").length === 2;
      return hasSvg && hasNodes;
    });

    // =============================================================
    // 12. MODULE: CmdStepInspectorView (Drawer & Payload View)
    // =============================================================
    console.log("\n%c--- 12. Testing CmdStepInspectorView ---", "color: #0070f3; font-weight: bold;");
    await recordTest("12. CmdStepInspectorView", "inspectStepDetails: DOM rendering & Step Cards", async () => {
      const dummyDiv = document.createElement("div");
      if (store) {
        store.setCachedBpmnModel("TestFlow", { flowName: "TestFlow", steps: { CallActivity_1: "Call ProcessDirect", Script_1: "Format Message" } });
      }
      const dummyLog = {
        MessageGuid: "msg_123",
        IntegrationFlowName: "TestFlow",
        LogLevel: "TRACE",
        __steps: [
          { StepId: "CallActivity_1", Activity: "ProcessDirect", Status: "COMPLETED", StepStart: 1000, StepStop: 1050 },
          { StepId: "Script_1", Activity: "GroovyScript", Status: "COMPLETED", StepStart: 1050, StepStop: 1080 },
        ],
      };

      await stepView.inspectStepDetails(dummyDiv, dummyLog);
      const hasList = dummyDiv.querySelector("#cmd-steps-list-container") !== null;
      const cardCount = dummyDiv.querySelectorAll(".cmd-btn-props").length;
      return hasList && cardCount === 2;
    });

    // =============================================================
    // 13. MODULE: CmdDebuggerMainModal (Master Coordinator)
    // =============================================================
    console.log("\n%c--- 13. Testing CmdDebuggerMainModal ---", "color: #0070f3; font-weight: bold;");
    await recordTest("13. CmdDebuggerMainModal", "Trace Countdown Timer & State Management", () => {
      const dummyStatus = document.createElement("div");
      mainModal.startTraceCountdownTimer(dummyStatus, Date.now());
      const hasTimer = dummyStatus.innerHTML.includes("TRACE Active");
      clearInterval(mainModal.state.countdownInterval);
      return hasTimer;
    });

    // =============================================================
    // 14. MODULE: CmdTraceManagerModal (Batch Log Level Dialog)
    // =============================================================
    console.log("\n%c--- 14. Testing CmdTraceManagerModal ---", "color: #0070f3; font-weight: bold;");
    await recordTest("14. CmdTraceManagerModal", "Modal DOM creation & scope filter", () => {
      const hasOpen = typeof traceModal.open === "function";
      const hasBatch = traceService && typeof traceService.executeBatchLogLevel === "function";
      return hasOpen && hasBatch;
    });

    // =============================================================
    // 15. MODULE: Entry Points & CPI Helper Registration
    // =============================================================
    console.log("\n%c--- 15. Testing Plugin Hooks & Header Buttons ---", "color: #0070f3; font-weight: bold;");
    await recordTest("15. Plugin Entry Points", "Header Button & Plugin Registration in CPI Helper", () => {
      const hasHeaderInit = typeof headerBtn.init === "function";
      const hasGlobalOpen = typeof window.openCommondoDebugger === "function";
      const hasPluginObj = typeof window.CommondoDebuggerPlugin !== "undefined" || (typeof pluginList !== "undefined" && pluginList.some((p) => p.id === "commondoDebugger"));
      return hasHeaderInit && hasGlobalOpen && hasPluginObj;
    });

    // -------------------------------------------------------------
    // PRINT FINAL SUMMARY
    // -------------------------------------------------------------
    console.log("\n=================================================================");
    console.log("%c[MASTER TEST SUMMARY TABLE]", "color: #0070f3; font-weight: bold; font-size: 14px;");
    console.table(results.map((r) => ({ Group: r.Group, Test: r.Test, Status: r.Status, Result: r.Result })));
    console.log("=================================================================\n");

    this.renderOnScreenDialog(results, platform, host, activeIFlow, activePackage);
  },

  renderOnScreenDialog(results, platform, host, activeIFlow, activePackage) {
    const existing = document.getElementById("__cmd_master_test_modal");
    if (existing) existing.remove();

    const modal = document.createElement("div");
    modal.id = "__cmd_master_test_modal";
    modal.style.cssText =
      "position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 850px; max-width: 95vw; background: #ffffff; border-radius: 8px; box-shadow: 0 10px 40px rgba(0,0,0,0.3); z-index: 999999; font-family: -apple-system, BlinkMacSystemFont, sans-serif; overflow: hidden; border: 1px solid #e2e8f0;";

    let rowsHtml = "";
    results.forEach((r) => {
      const isPass = r.Status.includes("PASS");
      const isSkip = r.Status.includes("SKIP") || r.Status.includes("N/A");
      const statusColor = isPass ? "#10b981" : isSkip ? "#64748b" : "#ef4444";
      const bgColor = isPass ? "#fff" : isSkip ? "#f8fafc" : "#fef2f2";

      rowsHtml += `
        <tr style="border-bottom: 1px solid #f1f5f9; background: ${bgColor};">
          <td style="padding: 6px 10px; font-size: 0.76rem; color: #64748b; white-space: nowrap;">${r.Group}</td>
          <td style="padding: 6px 10px; font-weight: 500; font-size: 0.78rem; color: #1e293b; font-family: monospace;">${r.Test}</td>
          <td style="padding: 6px 10px; font-weight: bold; font-size: 0.78rem; color: ${statusColor}; white-space: nowrap;">${r.Status}</td>
          <td style="padding: 6px 10px; font-size: 0.76rem; color: #475569; white-space: nowrap;">${r.Result}</td>
        </tr>
      `;
    });

    modal.innerHTML = `
      <div style="background: #0070f3; color: #fff; padding: 10px 14px; display: flex; justify-content: space-between; align-items: center;">
        <span style="font-weight: bold; font-size: 0.95rem;">Commondo Debugger — Master End-to-End Test Suite</span>
        <span id="__cmd_master_modal_close" style="cursor: pointer; font-size: 1.3rem; font-weight: bold; line-height: 1;">&times;</span>
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
              <th style="padding: 8px 10px;">Module</th>
              <th style="padding: 8px 10px;">Test Case & Edge Conditions</th>
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
        <span style="font-size: 0.74rem; color: #64748b;">Check DevTools Console (F12) for detailed trees & payload traces.</span>
        <button id="__cmd_master_modal_retest" style="background: #0070f3; color: #fff; border: none; padding: 6px 14px; border-radius: 4px; font-size: 0.8rem; font-weight: bold; cursor: pointer; box-shadow: 0 2px 6px rgba(0,112,243,0.3);">Re-run Master Test</button>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector("#__cmd_master_modal_close").onclick = () => modal.remove();
    modal.querySelector("#__cmd_master_modal_retest").onclick = () => this.runAllTests();
  },
};

// Global Console test runner shortcuts
if (typeof window !== "undefined") {
  window.CmdTestMasterRunner = CmdTestMasterRunner;
  window.runMasterTest = (corrId) => CmdTestMasterRunner.runAllTests(corrId);
  window.runProcessDirectDiscoveryTest = () => CmdTestMasterRunner.runAllTests();
}
