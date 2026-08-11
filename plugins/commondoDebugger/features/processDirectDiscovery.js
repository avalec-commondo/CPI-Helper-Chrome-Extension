// ===========================================================================
// COMMODNO IS DEBUGGER - PROCESSDIRECT DISCOVERY ENGINE
// ===========================================================================
// Multi-tier recursive ProcessDirect dependency resolution engine.
// Supports both static BPMN parsing and runtime correlation-driven dynamic topology
// resolution (resolving dynamic expressions like /${property.reportId}).

const CmdProcessDirectDiscovery = {
  /**
   * Constructs the runtime ProcessDirect execution topology for a specific Correlation ID.
   * Resolves dynamic outbound expressions using actual executed logs and time intervals.
   */
  async buildCorrelationTopology(rootFlowId, correlationLogs = [], packageId = null) {
    const apiHelper = typeof CmdCpiApiHelper !== "undefined" ? CmdCpiApiHelper : {};
    const bpmnHelper = typeof CmdBpmnModelHelper !== "undefined" ? CmdBpmnModelHelper : {};
    const parseMs = apiHelper.parseMs || ((ts) => {
      if (!ts) return 0;
      if (typeof ts === "number") return ts;
      const m = String(ts).match(/\d+/);
      return m ? parseInt(m[0], 10) : new Date(ts).getTime() || 0;
    });

    if (!correlationLogs || correlationLogs.length === 0) {
      return {
        nodes: [{ id: rootFlowId, level: 0, runCount: 1 }],
        edges: [],
        levels: { [rootFlowId]: 0 },
      };
    }

    // 1. Group correlation logs by flow ID and calculate overall execution time windows
    const logsByFlowId = {};
    const flowIntervals = {};

    correlationLogs.forEach((log) => {
      const flowId = log.IntegrationFlowName || log.IntegrationArtifact?.Id || "iFlow";
      if (!logsByFlowId[flowId]) logsByFlowId[flowId] = [];
      logsByFlowId[flowId].push(log);

      const start = parseMs(log.LogStart);
      const end = parseMs(log.LogEnd) || start;

      if (!flowIntervals[flowId]) {
        flowIntervals[flowId] = { start, end };
      } else {
        flowIntervals[flowId].start = Math.min(flowIntervals[flowId].start, start);
        flowIntervals[flowId].end = Math.max(flowIntervals[flowId].end, end);
      }
    });

    const distinctFlowIds = Object.keys(logsByFlowId);

    // Identify real root flow: the flow that initiated this correlation chain (earliest LogStart)
    let effectiveRoot = distinctFlowIds.reduce((earliest, flowId) => {
      if (!earliest) return flowId;
      return (flowIntervals[flowId].start < flowIntervals[earliest].start) ? flowId : earliest;
    }, null) || rootFlowId;

    // 2. Fetch BPMN models for all executed flows (inbound & outbound)
    const pkgId = packageId || (await apiHelper.resolveCurrentPackageId(effectiveRoot));
    const flowModels = {};
    const inboundRegistry = []; // { flowId, address, normalized }

    await Promise.all(
      distinctFlowIds.map(async (flowId) => {
        try {
          const model = await bpmnHelper.fetchIFlowBpmnModel(flowId, pkgId);
          flowModels[flowId] = model;

          model.inbound.forEach((inChan) => {
            if (inChan.address) {
              const norm = inChan.address.trim().toLowerCase();
              inboundRegistry.push({ flowId, address: inChan.address.trim(), normalized: norm });
            }
          });
        } catch (e) {
          flowModels[flowId] = { inbound: [], outbound: [], steps: {} };
        }
      })
    );

    // 3. Resolve directed edges from Caller -> Callee
    const directedEdges = [];
    const matchedChildren = new Set();

    for (const callerId of distinctFlowIds) {
      const model = flowModels[callerId] || { outbound: [] };
      const callerInterval = flowIntervals[callerId] || { start: 0, end: Infinity };

      for (const outChan of model.outbound) {
        const rawAddress = (outChan.address || "").trim();
        const normOut = rawAddress.toLowerCase();
        let targetFlow = null;
        let resolvedAddress = rawAddress;

        // Case A: Static exact match in inbound registry
        const directMatch = inboundRegistry.find((r) => r.normalized === normOut && r.flowId !== callerId);
        if (directMatch && distinctFlowIds.includes(directMatch.flowId)) {
          targetFlow = directMatch.flowId;
          resolvedAddress = directMatch.address;
        }

        // Case B: Dynamic address expression (${property.xyz}, ${header.abc}, {{param}})
        if (!targetFlow && (normOut.includes("${") || normOut.includes("{{"))) {
          // Find which child flows executed inside the caller's execution window
          const candidateChildren = distinctFlowIds.filter((cid) => {
            if (cid === callerId) return false;
            const cIv = flowIntervals[cid];
            return cIv && cIv.start >= callerInterval.start && cIv.start <= callerInterval.end;
          });

          // Check if candidate child's inbound endpoint is in the registry
          for (const candId of candidateChildren) {
            const candInbounds = inboundRegistry.filter((r) => r.flowId === candId);
            if (candInbounds.length > 0) {
              targetFlow = candId;
              resolvedAddress = candInbounds[0].address; // The actual runtime endpoint of the called flow!
              break;
            }
          }
        }

        if (targetFlow) {
          if (!directedEdges.some((e) => e.from === callerId && e.to === targetFlow && e.address === resolvedAddress)) {
            directedEdges.push({
              from: callerId,
              to: targetFlow,
              address: resolvedAddress,
              rawAddress: rawAddress,
              isDynamic: rawAddress !== resolvedAddress,
            });
            matchedChildren.add(targetFlow);
          }
        }
      }
    }

    // 4. Interval Containment Fallback: Connect any unlinked child flows that executed inside a parent
    distinctFlowIds.forEach((flowId) => {
      if (flowId === effectiveRoot || matchedChildren.has(flowId)) return;

      const flowIv = flowIntervals[flowId];
      if (!flowIv) return;

      // Find candidate parents whose execution interval strictly contains this child flow
      let bestParent = null;
      let minParentDuration = Infinity;

      distinctFlowIds.forEach((candId) => {
        if (candId === flowId) return;
        const candIv = flowIntervals[candId];
        const isCallerOfCand = directedEdges.some((e) => e.from === flowId && e.to === candId);
        if (!isCallerOfCand && candIv && candIv.start <= flowIv.start && candIv.end >= flowIv.end) {
          const duration = candIv.end - candIv.start;
          if (duration < minParentDuration) {
            minParentDuration = duration;
            bestParent = candId;
          }
        }
      });

      if (!bestParent && flowId !== effectiveRoot) {
        bestParent = effectiveRoot;
      }

      if (bestParent && bestParent !== flowId && !directedEdges.some((e) => e.from === flowId && e.to === bestParent)) {
        const calleeInbound = inboundRegistry.find((r) => r.flowId === flowId)?.address || "/processdirect";
        directedEdges.push({
          from: bestParent,
          to: flowId,
          address: calleeInbound,
          rawAddress: calleeInbound,
          isDynamic: false,
        });
        matchedChildren.add(flowId);
      }
    });

    // 5. Compute Hierarchical Levels (Root = Level 0, direct children = Level 1, grandchildren = Level 2...)
    const nodeLevels = { [effectiveRoot]: 0 };
    const queue = [effectiveRoot];
    const visited = new Set([effectiveRoot]);

    while (queue.length > 0) {
      const curr = queue.shift();
      const currLevel = nodeLevels[curr] || 0;

      const outEdges = directedEdges.filter((e) => e.from === curr);
      outEdges.forEach((e) => {
        if (!visited.has(e.to)) {
          visited.add(e.to);
          nodeLevels[e.to] = currLevel + 1;
          queue.push(e.to);
        }
      });
    }

    distinctFlowIds.forEach((id) => {
      if (nodeLevels[id] === undefined) nodeLevels[id] = 1;
    });

    // 6. Construct Final Nodes
    const topologyNodes = distinctFlowIds.map((id) => ({
      id: id,
      level: nodeLevels[id] || 0,
      runCount: (logsByFlowId[id] || []).length,
      outboundCalls: (flowModels[id]?.outbound || []).length,
      inboundEndpoints: (flowModels[id]?.inbound || []).map((i) => i.address).join(", "),
    }));

    return {
      nodes: topologyNodes,
      edges: directedEdges,
      levels: nodeLevels,
      rootFlowId: effectiveRoot,
    };
  },

  /**
   * Static design-time ProcessDirect topology discovery (BPMN BFS).
   */
  async discoverProcessDirectTopology(rootFlowId, packageId = null, isDebug = false) {
    const apiHelper = typeof CmdCpiApiHelper !== "undefined" ? CmdCpiApiHelper : {};
    const bpmnHelper = typeof CmdBpmnModelHelper !== "undefined" ? CmdBpmnModelHelper : {};

    const pkgId = packageId || (await apiHelper.resolveCurrentPackageId(rootFlowId));
    const packageFlows = await apiHelper.fetchPackageArtifacts(pkgId);
    const iFlowsOnly = packageFlows.filter((a) => a.type === "IFlow" || !a.type);

    // 1. Build Inbound Endpoint Registry
    const endpointToIFlowMap = new Map();
    const endpointRegistry = [];

    for (const flow of iFlowsOnly) {
      const model = await bpmnHelper.fetchIFlowBpmnModel(flow.id, pkgId);
      model.inbound.forEach((inChan) => {
        if (inChan.address) {
          const norm = inChan.address.trim().toLowerCase();
          endpointToIFlowMap.set(norm, flow.id);
          endpointRegistry.push({ flowId: flow.id, address: inChan.address, normalized: norm });
        }
      });
    }

    // 2. BFS Queue Traversal
    const queue = [{ flowId: rootFlowId, level: 0 }];
    const visitedNodes = new Set([rootFlowId]);
    const topologyNodes = [];
    const directedEdges = [];
    const nodeLevels = {};

    while (queue.length > 0) {
      const { flowId: currFlow, level: currLevel } = queue.shift();
      nodeLevels[currFlow] = currLevel;

      const model = await bpmnHelper.fetchIFlowBpmnModel(currFlow, pkgId);

      topologyNodes.push({
        id: currFlow,
        level: currLevel,
        outboundCalls: model.outbound.length,
        outboundAddresses: model.outbound.map((o) => o.address).join(", "),
        inboundEndpoints: model.inbound.map((i) => i.address).join(", "),
        totalBpmnSteps: Object.keys(model.steps).length,
      });

      for (const outChan of model.outbound) {
        const rawAddress = (outChan.address || "").trim();
        const normTarget = rawAddress.toLowerCase();
        let targetFlow = endpointToIFlowMap.get(normTarget);

        if (targetFlow) {
          directedEdges.push({
            from: currFlow,
            to: targetFlow,
            address: rawAddress,
            channel: "ProcessDirect",
            sourceLevel: currLevel,
            targetLevel: currLevel + 1,
          });

          if (!visitedNodes.has(targetFlow)) {
            visitedNodes.add(targetFlow);
            queue.push({ flowId: targetFlow, level: currLevel + 1 });
          }
        }
      }
    }

    return { nodes: topologyNodes, edges: directedEdges, levels: nodeLevels };
  },

  /**
   * Helper to print cycle-safe ASCII subtree representation.
   */
  printAsciiSubtree(currFlowId, edges, indent = "", visitedPath = new Set()) {
    const outEdges = edges.filter((e) => e.from === currFlowId);
    outEdges.forEach((e, idx) => {
      const isLast = idx === outEdges.length - 1;
      const branch = isLast ? "└── " : "├── ";
      const nextIndent = indent + (isLast ? "    " : "│   ");

      if (visitedPath.has(e.to)) {
        console.log(`${indent}${branch}[ProcessDirect: ${e.address}] -> ${e.to} (Loopback/Parallel)`);
        return;
      }

      console.log(`${indent}${branch}[ProcessDirect: ${e.address}] -> ${e.to}`);

      const newPath = new Set(visitedPath);
      newPath.add(e.to);
      CmdProcessDirectDiscovery.printAsciiSubtree(e.to, edges, nextIndent, newPath);
    });
  },

  /**
   * Diagnostic test runner for ProcessDirect discovery and Correlation Call-Chain.
   * Prints comprehensive diagnostic reports to the browser console.
   */
  async runProcessDirectDiscoveryTest(selectedRun = null, packageId = null) {
    console.clear();
    console.log("===============================================================================");
    console.log("[Commondo IS Debugger] ProcessDirect & Correlation Call-Chain Diagnostics");
    console.log("===============================================================================");

    const apiHelper = typeof CmdCpiApiHelper !== "undefined" ? CmdCpiApiHelper : {};
    const getApi = apiHelper.getApiUrl || window.getApiUrl;
    const activeFlow = selectedRun?.IntegrationFlowName || selectedRun?.IntegrationArtifact?.Id || (typeof cpiData !== "undefined" && cpiData.integrationFlowId ? cpiData.integrationFlowId : "");

    if (!activeFlow) {
      console.warn("No active integration flow found. Open an iFlow in SAP CPI WebUI to run this test.");
      return;
    }

    const pkgId = packageId || (await apiHelper.resolveCurrentPackageId(activeFlow));
    console.log(`Target Flow: ${activeFlow} | Package ID: ${pkgId || "Auto"}`);

    // 1. Identify Target Execution Run
    let targetRun = selectedRun;
    if (!targetRun) {
      try {
        const runsUrl = getApi(`MessageProcessingLogs?$top=5&$orderby=LogStart desc&$format=json&$filter=IntegrationArtifact/Id eq '${encodeURIComponent(activeFlow)}'`);
        const rawRes = await makeCallPromise("GET", encodeURI(runsUrl), false);
        const res = typeof rawRes === "string" ? JSON.parse(rawRes) : rawRes;
        const runs = res?.d?.results || [];
        targetRun = runs[0] || null;
      } catch (e) {
        console.warn("Failed fetching recent execution runs:", e);
      }
    }

    if (!targetRun) {
      console.warn(`No execution runs found for ${activeFlow}. Running static BPMN discovery only.`);
      const staticResult = await this.discoverProcessDirectTopology(activeFlow, pkgId, true);
      console.log("Static Topology Nodes:", staticResult.nodes);
      console.log("Static Topology Edges:", staticResult.edges);
      return;
    }

    console.log("Selected Execution Run:", {
      MessageGuid: targetRun.MessageGuid,
      CorrelationId: targetRun.CorrelationId,
      Status: targetRun.Status,
      LogLevel: targetRun.LogLevel,
      LogStart: targetRun.LogStart,
    });

    // 2. Fetch Correlated Call-Chain Logs
    let corrLogs = [targetRun];
    if (targetRun.CorrelationId) {
      try {
        const corrUrl = getApi(`MessageProcessingLogs?$format=json&$filter=CorrelationId eq '${targetRun.CorrelationId}'&$orderby=LogStart`);
        const rawCorr = await makeCallPromise("GET", encodeURI(corrUrl), false);
        const corrRes = typeof rawCorr === "string" ? JSON.parse(rawCorr) : rawCorr;
        if (corrRes?.d?.results && corrRes.d.results.length > 0) {
          corrLogs = corrRes.d.results;
        }
      } catch (eCorr) {
        console.warn("Failed fetching correlation logs:", eCorr);
      }
    }

    console.log(`\n[1/3] Found ${corrLogs.length} message logs in Correlation ID "${targetRun.CorrelationId}":`);
    const logsSummary = {};
    corrLogs.forEach((l) => {
      const fName = l.IntegrationFlowName || l.IntegrationArtifact?.Id || "iFlow";
      if (!logsSummary[fName]) {
        logsSummary[fName] = { flowId: fName, runCount: 0, status: l.Status, logLevel: l.LogLevel || "INFO" };
      }
      logsSummary[fName].runCount++;
    });
    console.table(Object.values(logsSummary));

    // 3. Run Correlation Topology Resolution
    console.log("\n[2/3] Resolving Dynamic ProcessDirect Topology Graph...");
    const topoResult = await this.buildCorrelationTopology(activeFlow, corrLogs, pkgId);

    console.log("\n[3/3] Diagnostic Topology Result:");
    console.log("ASCII Call Hierarchy:");
    this.printAsciiSubtree(topoResult.rootFlowId || activeFlow, topoResult.edges);

    console.log("\nDiscovered Nodes in Graph:");
    console.table(topoResult.nodes);

    console.log("\nResolved Directed Edges:");
    if (topoResult.edges.length > 0) {
      console.table(topoResult.edges.map((e) => ({
        From: e.from,
        To: e.to,
        "Resolved Address": e.address,
        "Raw Address (BPMN)": e.rawAddress,
        "Dynamic?": e.isDynamic ? "YES (Resolved at Runtime)" : "Static Match",
      })));
    } else {
      console.log("No child edges detected in this call chain.");
    }

    const executedCount = Object.keys(logsSummary).length;
    const graphNodeCount = topoResult.nodes.length;
    if (executedCount === graphNodeCount) {
      console.log(`\n%c✔ ALL ${executedCount} EXECUTED IFLOWS MATCHED IN TOPOLOGY GRAPH`, "color: #10b981; font-weight: bold; font-size: 13px;");
    } else {
      console.warn(`\n⚠ Discrepancy: ${executedCount} flows executed in correlation, but ${graphNodeCount} nodes in graph.`);
    }
    console.log("===============================================================================");
  },
};

// Expose to window namespace
if (typeof window !== "undefined") {
  window.CmdProcessDirectDiscovery = CmdProcessDirectDiscovery;
  window.runProcessDirectDiscoveryTest = (run, pkg) => CmdProcessDirectDiscovery.runProcessDirectDiscoveryTest(run, pkg);
}
