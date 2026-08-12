// ===========================================================================
// COMMODNO IS DEBUGGER - STATIC ARCHITECTURE DISCOVERY FEATURE
// ===========================================================================
// Discovers and builds the design-time ProcessDirect architecture topology
// starting from the CURRENT root iFlow and traversing downstream direct
// children and descendants.

const CmdStaticArchitectureDiscovery = {
  /**
   * Builds the static design-time ProcessDirect graph starting from rootFlowId
   * and traversing all reachable downstream descendant flows.
   * @param {string} packageId - Current package technical ID.
   * @param {string} rootFlowId - Root/focused iFlow technical ID.
   * @returns {Promise<{ nodes: Array, edges: Array, levels: Object, flowModels: Object }>}
   */
  async buildStaticPackageTopology(packageId, rootFlowId = "") {
    const apiHelper = typeof CmdCpiApiHelper !== "undefined" ? CmdCpiApiHelper : {};
    const bpmnHelper = typeof CmdBpmnModelHelper !== "undefined" ? CmdBpmnModelHelper : {};

    const rootId = rootFlowId || (typeof cpiData !== "undefined" && cpiData.integrationFlowId ? cpiData.integrationFlowId : "");
    const pkgId = packageId || (await apiHelper.resolveCurrentPackageId(rootId));

    if (!rootId) {
      return { nodes: [], edges: [], levels: {}, flowModels: {} };
    }

    console.log(`%c[Static Architecture Discovery] Starting top-down traversal from root "${rootId}" in package "${pkgId}"`, "color: #0284c7; font-weight: bold;");

    // 1. Fetch package artifact metadata to know all possible flow candidates
    let packageArtifacts = [];
    if (apiHelper.fetchPackageArtifacts && pkgId) {
      try {
        packageArtifacts = await apiHelper.fetchPackageArtifacts(pkgId);
      } catch (e) {
        console.warn("[Static Discovery] Failed fetching package artifacts:", e);
      }
    }

    const iFlowsOnly = packageArtifacts.filter(
      (a) => !a.type || a.type.toLowerCase().includes("flow") || a.type.toLowerCase().includes("iflow")
    );
    const packageFlowIds = iFlowsOnly.map((a) => a.entityId || a.rawId || a.id);

    // Helpers
    function matchAddress(a1, a2) {
      if (!a1 || !a2) return false;
      const s1 = String(a1).trim().toLowerCase().replace(/^\/+|\/+$/g, "");
      const s2 = String(a2).trim().toLowerCase().replace(/^\/+|\/+$/g, "");
      return Boolean(s1 && s2 && s1 === s2);
    }

    const flowModels = {};
    const inboundRegistry = []; // { flowId, address }

    function registerInbound(flowId, address) {
      if (!address) return;
      const trimmed = address.trim();
      if (!inboundRegistry.some((r) => r.flowId === flowId && matchAddress(r.address, trimmed))) {
        inboundRegistry.push({ flowId, address: trimmed });
      }
    }

    // Pre-register package flow IDs as implicit inbounds for direct name matching
    packageFlowIds.forEach((fid) => {
      registerInbound(fid, fid);
    });

    // 2. Pre-fetch BPMN models for package flows to build complete inbound registry
    const initialFetchTasks = packageFlowIds.map(async (fid) => {
      try {
        const model = await bpmnHelper.fetchIFlowBpmnModel(fid, pkgId);
        flowModels[fid] = model;
        (model.inbound || []).forEach((inChan) => {
          registerInbound(fid, inChan.address);
          if (inChan.rawAddress && inChan.rawAddress !== inChan.address) {
            registerInbound(fid, inChan.rawAddress);
          }
        });
      } catch (e) {}
    });
    await Promise.all(initialFetchTasks);

    // Ensure root flow model is loaded
    if (!flowModels[rootId]) {
      try {
        flowModels[rootId] = await bpmnHelper.fetchIFlowBpmnModel(rootId, pkgId);
      } catch (e) {
        flowModels[rootId] = { inbound: [], outbound: [], paramMap: {} };
      }
    }

    // 3. Top-Down BFS Traversal from rootFlowId
    const discoveredNodes = [];
    const discoveredEdges = [];
    const visitedFlows = new Set();
    const levels = {};
    const hangingByCaller = {};

    const queue = [{ flowId: rootId, level: 0 }];

    while (queue.length > 0) {
      const { flowId, level } = queue.shift();
      if (visitedFlows.has(flowId)) continue;
      visitedFlows.add(flowId);

      if (levels[flowId] === undefined || levels[flowId] > level) {
        levels[flowId] = level;
      }

      let model = flowModels[flowId];
      if (!model) {
        try {
          model = await bpmnHelper.fetchIFlowBpmnModel(flowId, pkgId);
          flowModels[flowId] = model;
        } catch (e) {
          model = { inbound: [], outbound: [], paramMap: {} };
          flowModels[flowId] = model;
        }
      }

      hangingByCaller[flowId] = [];

      (model.outbound || []).forEach((outChan) => {
        const rawAddress = (outChan.address || "").trim();
        let resolvedTargetFlow = null;
        let resolvedEndpointAddress = null;
        let matchDescription = "";

        // Pass 1: Static Address matching
        const directMatch = inboundRegistry.find((r) => matchAddress(r.address, rawAddress) && r.flowId !== flowId);
        if (directMatch) {
          resolvedTargetFlow = directMatch.flowId;
          resolvedEndpointAddress = directMatch.address;
          matchDescription = "Static Match";
        }

        // Pass 2: Externalized Parameters
        if (!resolvedTargetFlow && rawAddress.includes("{{") && rawAddress.includes("}}")) {
          const pName = rawAddress.replace(/.*\{\{|\}\}.*/g, "").trim();
          let pVal = model.paramMap?.[pName] || model.paramMap?.[pName.toLowerCase()];
          if (pVal && typeof pVal === "string" && pVal.includes("{{")) {
            const inner = pVal.replace(/.*\{\{|\}\}.*/g, "").trim();
            pVal = model.paramMap?.[inner] || model.paramMap?.[inner.toLowerCase()] || pVal;
          }
          if (pVal) {
            const pMatch = inboundRegistry.find((r) => matchAddress(r.address, pVal) && r.flowId !== flowId)
                        || inboundRegistry.find((r) => matchAddress(r.flowId, pVal) && r.flowId !== flowId);
            if (pMatch) {
              resolvedTargetFlow = pMatch.flowId;
              resolvedEndpointAddress = pMatch.address;
              matchDescription = `Parameter: {{${pName}}} -> ${pVal}`;
            }
          }
        }

        // If target child flow was resolved
        if (resolvedTargetFlow) {
          const edgeExists = discoveredEdges.some(
            (e) => e.from === flowId && e.to === resolvedTargetFlow && matchAddress(e.address, resolvedEndpointAddress || rawAddress)
          );
          if (!edgeExists) {
            discoveredEdges.push({
              from: flowId,
              to: resolvedTargetFlow,
              address: resolvedEndpointAddress || rawAddress,
              rawAddress: rawAddress,
              matchType: matchDescription,
            });
          }

          // Enqueue child flow for downstream traversal
          if (!visitedFlows.has(resolvedTargetFlow)) {
            queue.push({ flowId: resolvedTargetFlow, level: level + 1 });
          }
        } else {
          // Unresolved / dynamic channel (e.g. /${header.iflowId}, /test) -> Record as compact hanging pill
          hangingByCaller[flowId].push({
            id: outChan.id,
            address: rawAddress,
            rawAddress: outChan.rawAddress || rawAddress,
            sourceRef: outChan.sourceRef || "",
            targetRef: outChan.targetRef || "",
          });
        }
      });

      // Add to discovered nodes list
      discoveredNodes.push({
        id: flowId,
        level: levels[flowId] !== undefined ? levels[flowId] : level,
        runCount: 0,
        outboundCalls: (model.outbound || []).length,
        inboundEndpoints: (model.inbound || []).map((i) => i.address).join(", "),
        hangingOutbounds: hangingByCaller[flowId] || [],
      });
    }

    console.log(
      `%c[Static Architecture Discovery] Descendant-only traversal from "${rootId}": Found ${discoveredNodes.length} reachable flows and ${discoveredEdges.length} static links`,
      "color: #0284c7; font-weight: bold;",
      { nodes: discoveredNodes, edges: discoveredEdges }
    );

    return {
      nodes: discoveredNodes,
      edges: discoveredEdges,
      levels,
      flowModels,
    };
  },
};

// Expose to window namespace
if (typeof window !== "undefined") {
  window.CmdStaticArchitectureDiscovery = CmdStaticArchitectureDiscovery;
}
