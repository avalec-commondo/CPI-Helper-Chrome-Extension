// ===========================================================================
// COMMODNO IS DEBUGGER - PROCESSDIRECT DISCOVERY ENGINE
// ===========================================================================
// Multi-tier recursive BFS dependency traversal engine.
// Discovers complete invocation topologies via static BPMN parsing and
// externalized parameters.prop resolution. Includes ASCII tree visualizer.

const CmdProcessDirectDiscovery = {
  /**
   * Builds the entire ProcessDirect topology graph starting from a root iFlow.
   */
  async discoverProcessDirectTopology(rootFlowId, packageId = null, isDebug = false) {
    const apiHelper = typeof CmdCpiApiHelper !== "undefined" ? CmdCpiApiHelper : {};
    const bpmnHelper = typeof CmdBpmnModelHelper !== "undefined" ? CmdBpmnModelHelper : {};

    const pkgId = packageId || (await apiHelper.resolveCurrentPackageId(rootFlowId));
    const packageFlows = await apiHelper.fetchPackageArtifacts(pkgId);
    const iFlowsOnly = packageFlows.filter((a) => a.type === "IFlow" || !a.type);

    if (isDebug) {
      console.log(`[PD Discovery] Found ${iFlowsOnly.length} iFlow artifacts in package '${pkgId}'`);
    }

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

    if (isDebug) {
      console.log("[PD Discovery] Inbound Endpoint Registry:");
      console.table(endpointRegistry);
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

      if (isDebug) {
        console.group(`[PD Discovery] Inspecting Flow (Level ${currLevel}): ${currFlow}`);
        console.log("Inbound endpoints:", model.inbound);
        console.log("Outbound channels:", model.outbound);
      }

      for (const outChan of model.outbound) {
        const rawAddress = (outChan.address || "").trim();
        const normTarget = rawAddress.toLowerCase();
        let targetFlow = endpointToIFlowMap.get(normTarget);
        let matchReason = "Exact Match";

        // Dynamic property expression resolution (e.g. /${property.reportId} or ${header.endpoint})
        if (!targetFlow && (normTarget.includes("${property.") || normTarget.includes("${header.") || normTarget.includes("{{"))) {
          matchReason = "Dynamic Expression Resolution";
          for (const [inEndpoint, fId] of endpointToIFlowMap.entries()) {
            const cleanRoot = rootFlowId.replace(/scheduler_|schedule_|_manual_start|manual_start/gi, "").replace(/^[_\-]+|[_\-]+$/g, "").toLowerCase();
            if (cleanRoot && (fId.toLowerCase().includes(cleanRoot) || inEndpoint.includes(cleanRoot))) {
              targetFlow = fId;
              break;
            }
          }
        }

        if (isDebug) {
          if (targetFlow) {
            console.log(`  ✔ Outbound [${rawAddress}] -> ${targetFlow} (${matchReason})`);
          } else {
            console.warn(`  ✖ Outbound [${rawAddress}] -> No matching flow in package endpoint registry`);
          }
        }

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

      if (isDebug) {
        console.groupEnd();
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
        console.log(`${indent}${branch}[ProcessDirect: ${e.address}] -> %c${e.to}%c (Loopback/Parallel)`, "color: #eab308; font-weight: bold;", "color: inherit;");
        return;
      }

      console.log(`${indent}${branch}[ProcessDirect: ${e.address}] -> %c${e.to}%c`, "color: #3b82f6; font-weight: bold;", "color: inherit;");

      const newPath = new Set(visitedPath);
      newPath.add(e.to);
      CmdProcessDirectDiscovery.printAsciiSubtree(e.to, edges, nextIndent, newPath);
    });
  },

  /**
   * Diagnostic test runner for ProcessDirect discovery.
   */
  async runProcessDirectDiscoveryTest() {
    console.clear();
    console.log("%c================================================================", "color: #0070f3; font-weight: bold;");
    console.log("%c [TEST] COMMODNO STATIC PROCESSDIRECT DISCOVERY ENGINE ", "color: #0070f3; font-weight: bold; font-size: 1.1rem;");
    console.log("%c================================================================", "color: #0070f3; font-weight: bold;");

    const apiHelper = typeof CmdCpiApiHelper !== "undefined" ? CmdCpiApiHelper : {};
    const rootFlowId = (typeof cpiData !== "undefined" && cpiData.integrationFlowId) ? cpiData.integrationFlowId : "MPS_to_SAP_PM_standard";
    const pkgId = (typeof cpiData !== "undefined" && cpiData.currentPackageId) ? cpiData.currentPackageId : (await apiHelper.resolveCurrentPackageId(rootFlowId));

    console.group("%c 1. ENVIRONMENT & TENANT CONFIGURATION ", "color: #10b981; font-weight: bold;");
    console.log("Platform:", apiHelper.isNeo && apiHelper.isNeo() ? "SAP Neo (OData workspace.svc)" : "SAP Cloud Foundry (REST Web Studio)");
    console.log("Root Flow ID:", rootFlowId);
    console.log("Package ID:", pkgId);
    console.log("API URL Prefixes:", apiHelper.getApiPrefixes ? apiHelper.getApiPrefixes() : []);
    console.groupEnd();

    console.group("%c 2. DISCOVERING RECURSIVE TOPOLOGY ", "color: #f59e0b; font-weight: bold;");
    const topology = await CmdProcessDirectDiscovery.discoverProcessDirectTopology(rootFlowId, pkgId, true);
    console.groupEnd();

    console.group("%c 3. TOPOLOGY & TREE OUTPUT ", "color: #06b6d4; font-weight: bold;");
    console.log(`Total Nodes: ${topology.nodes.length} | Total Edges: ${topology.edges.length}`);
    console.log("Discovered Nodes Table:");
    console.table(topology.nodes);
    console.log("Discovered Edges Table:");
    console.table(topology.edges);

    console.log("%cDEPENDENCY HIERARCHY TREE:", "color: #10b981; font-weight: bold; font-size: 1.05rem;");
    console.log(`%c[ROOT] ${rootFlowId} (Level 0)`, "color: #8b5cf6; font-weight: bold;");
    CmdProcessDirectDiscovery.printAsciiSubtree(rootFlowId, topology.edges, "", new Set([rootFlowId]));
    console.groupEnd();

    console.log("%c==================== BFS TEST COMPLETE ====================", "color: #0070f3; font-weight: bold;");
  },
};

// Expose to window namespace
if (typeof window !== "undefined") {
  window.CmdProcessDirectDiscovery = CmdProcessDirectDiscovery;
}
