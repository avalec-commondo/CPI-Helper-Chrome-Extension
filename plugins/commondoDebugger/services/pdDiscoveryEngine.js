// ===========================================================================
// PROCESSDIRECT DISCOVERY ENGINE (Runtime Predecessor Resolution)
// ===========================================================================
// Deterministic O(N) parent-child graph resolver leveraging PredecessorMessageGuid.
// Eliminates BPMN parsing, regex matching, and trace heuristics for executed flows.

const CmdPdDiscoveryEngine = {
  /**
   * Constructs execution topology directly from OData MessageProcessingLogs.
   * @param {string} rootFlowId - Default root if no natural root found
   * @param {Array} correlationLogs - List of MessageProcessingLogs for this correlation
   * @returns {{ rootFlowId: string, nodes: Array, edges: Array, levels: Object }}
   */
  discoverTopology(rootFlowId, correlationLogs = []) {
    if (!correlationLogs || correlationLogs.length === 0) {
      return {
        rootFlowId,
        nodes: [{ id: rootFlowId, name: rootFlowId, level: 0, runsCount: 1, runs: [], totalDuration: 0, status: "COMPLETED" }],
        edges: [],
        levels: { [rootFlowId]: 0 },
      };
    }

    const parseMs = (ts) => {
      if (typeof CmdUtils !== "undefined" && CmdUtils.parseMs) return CmdUtils.parseMs(ts);
      if (!ts) return 0;
      if (typeof ts === "number") return ts;
      const match = String(ts).match(/\/Date\((\d+)/);
      if (match) return parseInt(match[1], 10);
      return new Date(ts).getTime() || 0;
    };

    // 1. Index all runs by MessageGuid for instant O(1) lookup
    const logByGuid = new Map();
    const flowStats = new Map(); // flowId -> { id, name, runs: [], totalDuration: 0, status }

    correlationLogs.forEach((log) => {
      const guid = log.MessageGuid || log.Id;
      if (guid) logByGuid.set(guid, log);

      const flowId = log.IntegrationArtifact?.Id || log.IntegrationFlowName || "Unknown_iFlow";
      const displayName = log.IntegrationArtifact?.Name || log.IntegrationFlowName || flowId;

      if (!flowStats.has(flowId)) {
        flowStats.set(flowId, {
          id: flowId,
          name: displayName,
          displayName: displayName,
          runs: [],
          totalDuration: 0,
          status: log.Status || "COMPLETED",
        });
      }

      const entry = flowStats.get(flowId);
      entry.runs.push(log);
      const start = parseMs(log.LogStart);
      const end = parseMs(log.LogEnd);
      if (start && end && end >= start) {
        entry.totalDuration += end - start;
      }
      if (log.Status === "FAILED") entry.status = "FAILED";
    });

    // 2. Build directed edges directly from PredecessorMessageGuid
    const edgeMap = new Map(); // key -> edge
    const childFlowIds = new Set();
    const unlinkedRuns = [];

    correlationLogs.forEach((childLog) => {
      const predGuid = childLog.PredecessorMessageGuid;
      const childFlowId = childLog.IntegrationArtifact?.Id || childLog.IntegrationFlowName;

      if (predGuid && logByGuid.has(predGuid)) {
        const parentLog = logByGuid.get(predGuid);
        const parentFlowId = parentLog.IntegrationArtifact?.Id || parentLog.IntegrationFlowName;

        // Stamp calling parent metadata onto the child run object
        childLog._callerFlowId = parentFlowId;
        childLog._callerMessageGuid = predGuid;

        if (parentFlowId && childFlowId && parentFlowId !== childFlowId) {
          const edgeKey = `${parentFlowId}->${childFlowId}`;
          if (!edgeMap.has(edgeKey)) {
            edgeMap.set(edgeKey, {
              key: edgeKey,
              from: parentFlowId,
              to: childFlowId,
              matchType: "PredecessorMessageGuid Link",
              channelName: "ProcessDirect",
              runCount: 0,
            });
          }
          edgeMap.get(edgeKey).runCount++;
          childFlowIds.add(childFlowId);
        }
      } else {
        // Either root execution or predecessor belongs to another correlation
        childLog._callerFlowId = null;
        childLog._callerMessageGuid = predGuid || null;

        if (predGuid) {
          unlinkedRuns.push(childLog);
        }
      }
    });

    // 3. Identify Root Node (a flow with runs that was never a child of another flow)
    const allFlowIds = Array.from(flowStats.keys());
    let effectiveRoot = allFlowIds.find((fId) => !childFlowIds.has(fId)) || rootFlowId || allFlowIds[0];

    // Fallback: If an unlinked flow exists without an edge, tie it to root
    allFlowIds.forEach((fId) => {
      if (fId !== effectiveRoot && !childFlowIds.has(fId)) {
        const edgeKey = `${effectiveRoot}->${fId}`;
        if (!edgeMap.has(edgeKey)) {
          edgeMap.set(edgeKey, {
            key: edgeKey,
            from: effectiveRoot,
            to: fId,
            matchType: "Correlation Root Fallback",
            channelName: "Inferred",
            runCount: flowStats.get(fId)?.runs.length || 1,
          });
        }
      }
    });

    const directedEdges = Array.from(edgeMap.values());

    // 4. Compute DAG Levels (BFS from Root)
    const levels = this.computeDagLevels(effectiveRoot, directedEdges, allFlowIds);

    // 5. Assemble final nodes with structured parent instance lineage
    const nodes = allFlowIds.map((fid) => {
      const stats = flowStats.get(fid);

      // Group parent callers and instances for this node
      const parentInstancesMap = new Map();
      const parentFlowsMap = new Map();
      let rootTriggerRunsCount = 0;

      stats.runs.forEach((r) => {
        const pFlow = r._callerFlowId;
        const pGuid = r._callerMessageGuid;

        if (!pFlow && !pGuid) {
          rootTriggerRunsCount++;
        } else {
          if (pFlow) {
            parentFlowsMap.set(pFlow, (parentFlowsMap.get(pFlow) || 0) + 1);
          }
          if (pGuid) {
            if (!parentInstancesMap.has(pGuid)) {
              const parentFlowLogs = flowStats.get(pFlow)?.runs || [];
              const parentRunIdx = parentFlowLogs.findIndex((pl) => (pl.MessageGuid || pl.Id) === pGuid);
              const parentLog = parentRunIdx !== -1 ? parentFlowLogs[parentRunIdx] : logByGuid.get(pGuid);

              const parentFlowName = parentLog?.IntegrationArtifact?.Name || parentLog?.IntegrationFlowName || pFlow || "Parent Flow";
              const s = parseMs(parentLog?.LogStart);
              const e = parseMs(parentLog?.LogEnd);
              const durMs = s && e && e >= s ? e - s : Number(parentLog?.Duration || 0);
              const durStr = durMs < 1000 ? `${durMs}ms` : `${(durMs / 1000).toFixed(2)}s`;
              const shortGuid = pGuid ? `${pGuid.substring(0, 8)}...` : "";
              const runNumber = parentRunIdx !== -1 ? parentRunIdx + 1 : 1;
              const status = parentLog?.Status || "COMPLETED";

              parentInstancesMap.set(pGuid, {
                callerGuid: pGuid,
                callerFlowId: pFlow,
                callerFlowName: parentFlowName,
                callerRunNumber: runNumber,
                callerDurationMs: durMs,
                callerDurationFormatted: durStr,
                callerStatus: status,
                shortGuid,
                label: `Run #${runNumber} | ${status}${pGuid ? ` | ID: ${pGuid}` : ""}`,
                childRunGuids: [],
                childRunsCount: 0,
              });
            }
            const pInst = parentInstancesMap.get(pGuid);
            pInst.childRunGuids.push(r.MessageGuid || r.Id);
            pInst.childRunsCount++;
          }
        }
      });

      const parentInstances = Array.from(parentInstancesMap.values()).map((p) => ({
        ...p,
        fullLabel: p.label,
      }));
      parentInstances.sort((a, b) => a.callerRunNumber - b.callerRunNumber);

      const parentFlows = Array.from(parentFlowsMap.entries()).map(([flowId, count]) => {
        const flowName = flowStats.get(flowId)?.name || flowId;
        return {
          flowId,
          flowName,
          childRunsCount: count,
          label: `[All ${flowName}] All instances (${count} runs)`,
        };
      });

      return {
        ...stats,
        parentFlows,
        parentInstances,
        rootTriggerRunsCount,
        hasMultipleParentOptions: parentInstances.length > 1 || parentFlows.length > 1 || (parentInstances.length > 0 && rootTriggerRunsCount > 0),
        level: levels[fid] !== undefined ? levels[fid] : 0,
        isRoot: fid === effectiveRoot,
        runsCount: stats.runs.length,
        hanging: [],
      };
    });

    nodes.sort((a, b) => a.level - b.level || b.totalDuration - a.totalDuration);

    return {
      rootFlowId: effectiveRoot,
      nodes,
      edges: directedEdges,
      levels,
      _diagnostics: {
        totalRunsProcessed: correlationLogs.length,
        uniqueFlows: allFlowIds.length,
        edgesResolved: directedEdges.length,
      },
    };
  },

  computeDagLevels(root, edges, allNodes) {
    const nodeLevels = { [root]: 0 };
    const queue = [root];
    const maxHops = (allNodes.length || 1) + 2;

    while (queue.length > 0) {
      const curr = queue.shift();
      const currLevel = nodeLevels[curr] || 0;
      if (currLevel >= maxHops) continue;

      const outEdges = edges.filter((e) => e.from === curr);
      outEdges.forEach((e) => {
        const nextLevel = currLevel + 1;
        if (nodeLevels[e.to] === undefined || nextLevel > nodeLevels[e.to]) {
          nodeLevels[e.to] = nextLevel;
          queue.push(e.to);
        }
      });
    }

    allNodes.forEach((id) => {
      if (nodeLevels[id] === undefined) nodeLevels[id] = 1;
    });

    return nodeLevels;
  },
};

if (typeof window !== "undefined") window.CmdPdDiscoveryEngine = CmdPdDiscoveryEngine;
if (typeof global !== "undefined") global.CmdPdDiscoveryEngine = CmdPdDiscoveryEngine;
