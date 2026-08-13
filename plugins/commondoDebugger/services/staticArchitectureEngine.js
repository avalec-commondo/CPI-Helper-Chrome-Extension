// ===========================================================================
// COMMNDO IS DEBUGGER - STATIC ARCHITECTURE ENGINE (CmdStaticArchitectureEngine)
// ===========================================================================
// Top-down static package architecture discovery engine.
// Maps all design-time ProcessDirect connections and dependencies.

const CmdStaticArchitectureEngine = {
  /**
   * Discovers the static design-time architecture graph starting from a root flow.
   * @param {string} rootFlowId - Root iFlow ID
   * @param {string} packageId - Content package ID
   * @param {Function} onProgress - Progress callback (completed, total, flowId)
   * @returns {Promise<{ rootFlowId: string, nodes: Array, edges: Array, levels: Object, hangingNodes: Object }>}
   */
  async discoverStaticArchitecture(rootFlowId, packageId = null, onProgress = null) {
    const api = typeof CmdApiClient !== "undefined" ? CmdApiClient : null;
    const bpmnService = typeof CmdBpmnParserService !== "undefined" ? CmdBpmnParserService : null;
    const pdEngine = typeof CmdPdDiscoveryEngine !== "undefined" ? CmdPdDiscoveryEngine : null;

    if (!api || !bpmnService || !rootFlowId) {
      return { rootFlowId, nodes: [], edges: [], levels: {}, hangingNodes: {} };
    }

    const matchAddr = (a1, a2) => (typeof CmdUtils !== "undefined" ? CmdUtils.matchEndpointAddress(a1, a2) : String(a1).toLowerCase() === String(a2).toLowerCase());

    const pkgId = packageId || (await api.resolveCurrentPackageId(rootFlowId));
    const packageArtifacts = await api.fetchPackageArtifacts(pkgId);

    // Filter candidate flow IDs in this package (only IFlows, skipping Script Collections, Mappings, etc.)
    const iflowArtifacts = packageArtifacts.filter((a) => {
      const t = String(a.type || "").toLowerCase();
      const isPureHex = /^[0-9a-f]{32}$/i.test(a.id);
      if (isPureHex) return false;
      return t.includes("iflow") || t.includes("integration") || (!t && !isPureHex);
    });

    const flowIds = iflowArtifacts.map((a) => a.id).filter(Boolean);
    if (!flowIds.includes(rootFlowId)) {
      flowIds.unshift(rootFlowId);
    }

    // 1. Fetch models for all package flows in parallel chunks
    const modelsByFlowId = {};
    const chunkSize = 6;
    let completed = 0;

    for (let i = 0; i < flowIds.length; i += chunkSize) {
      const chunk = flowIds.slice(i, i + chunkSize);
      await Promise.all(
        chunk.map(async (fid) => {
          try {
            modelsByFlowId[fid] = await bpmnService.getModel(fid, pkgId);
          } catch (e) {
            modelsByFlowId[fid] = { iflowId: fid, flowName: fid, outbound: [], inbound: [], steps: {}, paramMap: {} };
          }
          completed++;
          if (typeof onProgress === "function") {
            onProgress(completed, flowIds.length, fid);
          }
        })
      );
    }

    // 2. BFS Traversal starting from Root Flow
    const reachableFlows = new Set([rootFlowId]);
    const queue = [rootFlowId];
    const edges = [];
    const hangingNodes = {};

    while (queue.length > 0) {
      const currId = queue.shift();
      const model = modelsByFlowId[currId] || {};
      const outbounds = model.outbound || [];
      const hangingForCurr = [];

      outbounds.forEach((out) => {
        let targetAddr = out.address || "";

        // Resolve externalized parameters
        if (targetAddr.startsWith("{{") && targetAddr.endsWith("}}")) {
          const pName = targetAddr.slice(2, -2).trim();
          if (model.paramMap && model.paramMap[pName]) {
            targetAddr = model.paramMap[pName];
          }
        }

        // Find candidate in package
        let targetFlowId = null;
        for (const candidateId of flowIds) {
          if (candidateId === currId) continue;
          const candidateInbounds = modelsByFlowId[candidateId]?.inbound || [];
          if (candidateInbounds.some((i) => matchAddr(i.address, targetAddr))) {
            targetFlowId = candidateId;
            break;
          }
        }

        if (targetFlowId) {
          const edgeKey = `${currId}->${targetFlowId}:${targetAddr}`;
          if (!edges.some((e) => e.key === edgeKey)) {
            edges.push({
              key: edgeKey,
              from: currId,
              to: targetFlowId,
              address: targetAddr,
              channelName: out.name || "ProcessDirect",
            });
          }

          if (!reachableFlows.has(targetFlowId)) {
            reachableFlows.add(targetFlowId);
            queue.push(targetFlowId);
          }
        } else {
          // Hanging outbound
          hangingForCurr.push({
            channelId: out.id,
            channelName: out.name || "ProcessDirect",
            address: targetAddr,
          });
        }
      });

      if (hangingForCurr.length > 0) {
        hangingNodes[currId] = hangingForCurr;
      }
    }

    const reachableList = Array.from(reachableFlows);
    const levels = pdEngine ? pdEngine.computeDagLevels(rootFlowId, edges, reachableList) : {};

    // Build Node objects
    const nodes = reachableList.map((fid) => {
      const model = modelsByFlowId[fid] || {};
      return {
        id: fid,
        name: model.flowName || fid,
        description: model.flowDescription || "",
        level: levels[fid] !== undefined ? levels[fid] : 1,
        isRoot: fid === rootFlowId,
        runsCount: 0,
        runs: [],
        totalDuration: 0,
        status: "STATIC",
        hanging: hangingNodes[fid] || [],
      };
    });

    nodes.sort((a, b) => a.level - b.level);

    return {
      rootFlowId,
      nodes,
      edges,
      levels,
      hangingNodes,
    };
  },
};

// Expose globally
if (typeof window !== "undefined") {
  window.CmdStaticArchitectureEngine = CmdStaticArchitectureEngine;
}
if (typeof global !== "undefined") {
  global.CmdStaticArchitectureEngine = CmdStaticArchitectureEngine;
}
