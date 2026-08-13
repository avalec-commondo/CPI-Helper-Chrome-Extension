// ===========================================================================
// COMMNDO IS DEBUGGER - PROCESSDIRECT DISCOVERY ENGINE (CmdPdDiscoveryEngine)
// ===========================================================================
// Multi-tier recursive ProcessDirect dependency resolution engine.
// Supports both static BPMN parsing and runtime correlation-driven dynamic topology
// resolution (resolving dynamic expressions like /${property.reportId}).
// Zero timestamp/timing heuristics. Fast and strictly cached.

const CmdPdDiscoveryEngine = {
  /**
   * Constructs the runtime ProcessDirect execution topology for a specific Correlation ID.
   * @param {string} rootFlowId - Initial root or trigger iFlow ID
   * @param {Array} correlationLogs - List of MessageProcessingLogs in this correlation
   * @param {string} selectedGuid - Target message GUID
   * @param {string} packageId - Content package ID if known
   * @returns {Promise<{ rootFlowId: string, nodes: Array, edges: Array, levels: Object, hangingNodes: Object, _diagnostics: Object }>}
   */
  async discoverTopology(rootFlowId, correlationLogs = [], selectedGuid = null, packageId = null) {
    const api = typeof CmdApiClient !== "undefined" ? CmdApiClient : null;
    const bpmnService = typeof CmdBpmnParserService !== "undefined" ? CmdBpmnParserService : null;
    const traceService = typeof CmdTraceService !== "undefined" ? CmdTraceService : null;
    const utils = typeof CmdUtils !== "undefined" ? CmdUtils : null;
    const store = typeof CmdStateStore !== "undefined" ? CmdStateStore : null;

    const parseMs = (ts) => (utils ? utils.parseMs(ts) : new Date(ts).getTime() || 0);
    const matchAddress = (a1, a2) => (utils ? utils.matchEndpointAddress(a1, a2) : String(a1).toLowerCase().replace(/^\/+|\/+$/g, "") === String(a2).toLowerCase().replace(/^\/+|\/+$/g, ""));

    if (!correlationLogs || correlationLogs.length === 0) {
      return {
        rootFlowId,
        nodes: [{ id: rootFlowId, name: rootFlowId, level: 0, runsCount: 1, runs: [], totalDuration: 0, status: "COMPLETED", hanging: [] }],
        edges: [],
        levels: { [rootFlowId]: 0 },
        hangingNodes: {},
      };
    }

    // 1. Group correlation logs by flow ID (supporting technical ID, display name, and normalized ID)
    const logsByFlowId = {};
    const primaryFlowIds = new Set();

    correlationLogs.forEach((log) => {
      const artId = log.IntegrationArtifact?.Id || "";
      const flowName = log.IntegrationFlowName || "";
      const primaryId = artId || flowName || "iFlow";
      primaryFlowIds.add(primaryId);

      if (!logsByFlowId[primaryId]) logsByFlowId[primaryId] = [];
      logsByFlowId[primaryId].push(log);

      if (artId && flowName && artId !== flowName) {
        if (!logsByFlowId[flowName]) logsByFlowId[flowName] = [];
        logsByFlowId[flowName].push(log);
      }

      const norm = utils ? utils.normalizeFlowId(primaryId) : String(primaryId).toLowerCase().replace(/[\s\-_]+/g, "");
      if (norm && !logsByFlowId[norm]) {
        logsByFlowId[norm] = logsByFlowId[primaryId];
      }
    });

    function getLogsForFlow(flowId) {
      if (!flowId) return [];
      if (logsByFlowId[flowId]) return logsByFlowId[flowId];
      const norm = utils ? utils.normalizeFlowId(flowId) : String(flowId).toLowerCase().replace(/[\s\-_]+/g, "");
      return logsByFlowId[norm] || [];
    }

    const executedFlowIds = Array.from(primaryFlowIds);
    const pkgId = packageId || (api ? await api.resolveCurrentPackageId(rootFlowId) : "");
    const flowModels = {};
    const inboundRegistry = []; // { flowId, address, normalized }
    const combinedParamMap = {}; // Shared across all flows in the package

    // Helper: register an address in the inbound registry (deduplicates)
    function registerInbound(flowId, address) {
      if (!address) return;
      const clean = String(address).trim();
      const norm = clean.toLowerCase().replace(/^\/+|\/+$/g, "");
      if (!norm) return;
      if (!inboundRegistry.some((r) => r.normalized === norm && r.flowId === flowId)) {
        inboundRegistry.push({ flowId, address: clean, normalized: norm });
      }
    }

    // Helper: register all inbound addresses for a flow model
    function registerFlowInbounds(flowId, model) {
      if (!model) return;
      Object.assign(combinedParamMap, model.paramMap || {});

      (model.inbound || []).forEach((inChan) => {
        if (!inChan.address) return;
        const raw = inChan.address.trim();

        // Check if raw is a {{param}}
        const pm = raw.match(/^\{\{\s*([a-zA-Z0-9_.\-]+)\s*\}\}$/);
        if (pm && pm[1]) {
          const resolved = model.paramMap?.[pm[1]] || model.paramMap?.[pm[1].toLowerCase()] || combinedParamMap[pm[1]];
          if (resolved) {
            registerInbound(flowId, resolved);
          }
          registerInbound(flowId, pm[1]);
          registerInbound(flowId, raw);
        } else {
          registerInbound(flowId, raw);
        }
      });

      // Always register flowId itself as an inbound target
      registerInbound(flowId, flowId);
    }

    // 2. High-Performance BPMN Loading:
    // Load ONLY the executed flows and active flow initially
    const initialFlows = Array.from(new Set([...executedFlowIds, rootFlowId])).filter(Boolean);
    if (bpmnService) {
      await Promise.all(
        initialFlows.map(async (flowId) => {
          try {
            const model = await bpmnService.getModel(flowId, pkgId);
            flowModels[flowId] = model;
            registerFlowInbounds(flowId, model);
          } catch (e) {
            flowModels[flowId] = { iflowId: flowId, flowName: flowId, inbound: [], outbound: [], steps: {}, paramMap: {} };
          }
        })
      );
    }

    // 3. Structural Root Detection (Zero timing heuristics)
    let effectiveRoot = rootFlowId;
    const executedEntryFlows = executedFlowIds.filter((flowId) => {
      const model = flowModels[flowId];
      return !model || !model.inbound || model.inbound.length === 0;
    });

    if (executedEntryFlows.length === 1) {
      effectiveRoot = executedEntryFlows[0];
    } else if (executedEntryFlows.length > 1) {
      const withOutbounds = executedEntryFlows.find((fId) => (flowModels[fId]?.outbound || []).length > 0);
      effectiveRoot = withOutbounds || executedEntryFlows[0];
    } else if (executedFlowIds.length > 0) {
      effectiveRoot = executedFlowIds[0];
    }

    // 4. Unified Recursive Graph Worklist
    const directedEdges = [];
    const matchedChildren = new Set();
    const resolutionLogs = [];
    const hangingByCaller = {};
    const allDiscoveredFlows = new Set(executedFlowIds.length > 0 ? executedFlowIds : [effectiveRoot]);
    const workQueue = Array.from(new Set([effectiveRoot, ...executedFlowIds]));
    const visitedInWorkQueue = new Set();

    while (workQueue.length > 0) {
      const callerId = workQueue.shift();
      if (visitedInWorkQueue.has(callerId)) continue;
      visitedInWorkQueue.add(callerId);
      allDiscoveredFlows.add(callerId);

      // Lazy load BPMN model if not already cached
      if (!flowModels[callerId] && bpmnService) {
        try {
          const model = await bpmnService.getModel(callerId, pkgId);
          flowModels[callerId] = model;
          registerFlowInbounds(callerId, model);
        } catch (e) {
          flowModels[callerId] = { iflowId: callerId, flowName: callerId, inbound: [], outbound: [], steps: {}, paramMap: {} };
        }
      }

      const model = flowModels[callerId] || { outbound: [], paramMap: {} };
      const callerLogs = getLogsForFlow(callerId);

      // Lazy load trace data whenever caller has logs and outbound channels
      let traceData = null;
      if (model.outbound && model.outbound.length > 0 && callerLogs.length > 0 && traceService) {
        for (const log of callerLogs) {
          const msgGuid = log.MessageGuid || log.MessageId || log.Id;
          if (msgGuid && (String(log.LogLevel).toUpperCase() === "TRACE" || !traceData)) {
            try {
              traceData = await traceService.fetchRunTraceHeadersAndProperties(msgGuid);
              if (traceData && (Object.keys(traceData.properties || {}).length > 0 || Object.keys(traceData.headers || {}).length > 0 || traceData.executedStepIds?.size > 0)) {
                break;
              }
            } catch (eTrace) {}
          }
        }
      }

      for (const outChan of (model.outbound || [])) {
        const chanId = outChan.id;
        const sourceRef = outChan.sourceRef;
        const targetRef = outChan.targetRef;
        const rawAddress = (outChan.address || "").trim();
        const normOut = rawAddress.toLowerCase();
        const isDynamicExpr = normOut.includes("${") || normOut.includes("{{") || !normOut.startsWith("/");

        // Step 1: Runtime Traversal Verification
        let isTraversed = true;
        let traversalReason = "Single outbound or no trace step filters";

        if (traceData && traceData.executedStepIds && traceData.executedStepIds.size > 0) {
          const stepSet = traceData.executedStepIds;
          const anyKnown = (model.outbound || []).some((o) =>
            (o.id && stepSet.has(o.id.toLowerCase())) ||
            (o.sourceRef && stepSet.has(o.sourceRef.toLowerCase())) ||
            (o.targetRef && stepSet.has(o.targetRef.toLowerCase()))
          );

          if (anyKnown || model.outbound.length > 1) {
            const thisExecuted =
              (chanId && stepSet.has(chanId.toLowerCase())) ||
              (sourceRef && stepSet.has(sourceRef.toLowerCase())) ||
              (targetRef && stepSet.has(targetRef.toLowerCase()));

            if (!thisExecuted) {
              isTraversed = false;
              traversalReason = `Not executed in trace: shape not found in executedStepIds`;
            } else {
              traversalReason = `Executed: shape found in executedStepIds`;
            }
          }
        }

        let resolvedTargetFlow = null;
        let resolvedEndpointAddress = null;
        let isDynamic = false;
        let matchDescription = "";

        if (isTraversed) {
          // Pass 1: Static Match (address-to-address, address-to-flowId)
          const directMatch = inboundRegistry.find((r) => matchAddress(r.address, rawAddress) && r.flowId !== callerId);
          if (directMatch) {
            resolvedTargetFlow = directMatch.flowId;
            resolvedEndpointAddress = directMatch.address;
            isDynamic = false;
            matchDescription = "Static Match";
          }

          // Pass 2: Externalized Parameters (parameters.prop from caller or shared map)
          if (!resolvedTargetFlow && rawAddress.includes("{{") && rawAddress.includes("}}")) {
            const pName = rawAddress.replace(/.*\{\{|\}\}.*/g, "").trim();
            let pVal = model.paramMap?.[pName] || model.paramMap?.[pName.toLowerCase()] || combinedParamMap[pName] || combinedParamMap[pName.toLowerCase()];
            if (pVal && typeof pVal === "string" && pVal.includes("{{")) {
              const innerName = pVal.replace(/.*\{\{|\}\}.*/g, "").trim();
              pVal = model.paramMap?.[innerName] || combinedParamMap[innerName] || combinedParamMap[innerName.toLowerCase()] || pVal;
            }
            if (pVal) {
              const pMatch = inboundRegistry.find((r) => matchAddress(r.address, pVal) && r.flowId !== callerId)
                          || inboundRegistry.find((r) => matchAddress(r.flowId, pVal) && r.flowId !== callerId);
              if (pMatch) {
                resolvedTargetFlow = pMatch.flowId;
                resolvedEndpointAddress = pMatch.address;
                isDynamic = false;
                matchDescription = `Externalized Parameter (${pName} = ${pVal})`;
              }
            }
          }

          // Pass 3: Trace Payload & Header/Property Inspection
          if (!resolvedTargetFlow && isDynamicExpr && traceData) {
            let traceVal = null;
            let extractedKey = "";

            const propMatch = rawAddress.match(/\$\{(?:property\.)?([^\}]+)\}/i);
            const headerMatch = rawAddress.match(/\$\{(?:header\.)?([^\}]+)\}/i);

            if (propMatch && propMatch[1]) {
              extractedKey = propMatch[1].trim();
              traceVal = traceData.properties?.[extractedKey] || traceData.properties?.[extractedKey.toLowerCase()];
            } else if (headerMatch && headerMatch[1]) {
              extractedKey = headerMatch[1].trim();
              traceVal = traceData.headers?.[extractedKey] || traceData.headers?.[extractedKey.toLowerCase()];
            }

            // Fallback: scan all property/header keys for substring match
            if (!traceVal) {
              for (const k of Object.keys(traceData.properties || {})) {
                if (rawAddress.toLowerCase().includes(k.toLowerCase()) || k.toLowerCase().includes(rawAddress.toLowerCase())) {
                  traceVal = traceData.properties[k];
                  extractedKey = k;
                  break;
                }
              }
              if (!traceVal) {
                for (const k of Object.keys(traceData.headers || {})) {
                  if (rawAddress.toLowerCase().includes(k.toLowerCase()) || k.toLowerCase().includes(rawAddress.toLowerCase())) {
                    traceVal = traceData.headers[k];
                    extractedKey = k;
                    break;
                  }
                }
              }
            }

            if (traceVal && !resolvedTargetFlow) {
              const evaluatedAddress = rawAddress.includes("${")
                ? rawAddress.replace(/\$\{(?:header\.)?([^\}]+)\}/i, traceVal).replace(/\$\{(?:property\.)?([^\}]+)\}/i, traceVal)
                : traceVal;

              const traceMatch = inboundRegistry.find((r) => matchAddress(r.address, evaluatedAddress) && r.flowId !== callerId)
                              || inboundRegistry.find((r) => matchAddress(r.flowId, evaluatedAddress) && r.flowId !== callerId);
              if (traceMatch) {
                resolvedTargetFlow = traceMatch.flowId;
                resolvedEndpointAddress = traceMatch.address;
                isDynamic = true;
                matchDescription = `Trace Payload Inspection (${extractedKey || rawAddress} = ${traceVal})`;
              }
            }
          }
        }

        // Pass 4: Link Edge or Track Unresolved Channel as Hanging Outbound
        if (resolvedTargetFlow) {
          allDiscoveredFlows.add(resolvedTargetFlow);
          const edgeKey = `${callerId}->${resolvedTargetFlow}:${resolvedEndpointAddress}`;
          if (!directedEdges.some((e) => e.key === edgeKey || (e.from === callerId && e.to === resolvedTargetFlow && e.address === resolvedEndpointAddress))) {
            directedEdges.push({
              key: edgeKey,
              from: callerId,
              to: resolvedTargetFlow,
              address: resolvedEndpointAddress,
              rawAddress: rawAddress,
              isDynamic: isDynamic,
              matchType: matchDescription,
              channelName: outChan.name || "ProcessDirect",
            });
            matchedChildren.add(resolvedTargetFlow);
            resolutionLogs.push({
              Caller: callerId,
              "Raw Outbound": rawAddress,
              "Matched Callee": resolvedTargetFlow,
              "Resolved Address": resolvedEndpointAddress,
              "Match Type": matchDescription,
            });
          }

          if (!visitedInWorkQueue.has(resolvedTargetFlow)) {
            workQueue.push(resolvedTargetFlow);
          }
        } else {
          if (!hangingByCaller[callerId]) hangingByCaller[callerId] = [];
          if (!hangingByCaller[callerId].some((h) => h.address === rawAddress)) {
            hangingByCaller[callerId].push({
              channelId: outChan.id,
              channelName: outChan.name || "ProcessDirect",
              address: rawAddress,
              rawAddress: rawAddress,
              isDynamic: isDynamicExpr,
            });
            resolutionLogs.push({
              Caller: callerId,
              "Raw Outbound": rawAddress,
              "Matched Callee": "(None - Unresolved / External Outbound)",
              "Resolved Address": rawAddress,
              "Match Type": !isTraversed ? "Unexecuted Router Branch" : (isDynamicExpr ? "Hanging Dynamic Endpoint" : "Hanging Static Endpoint"),
            });
          }
        }
      }
    }

    // Pass 5: Correlation-Based Structural Inference (Zero timing)
    const flowsWithIncomingEdge = new Set(directedEdges.map((e) => e.to));
    const executedButUnlinked = executedFlowIds.filter((fId) => fId !== effectiveRoot && !flowsWithIncomingEdge.has(fId));

    for (const unlinkedFlow of executedButUnlinked) {
      const unlinkedModel = flowModels[unlinkedFlow] || {};
      const unlinkedInbounds = (unlinkedModel.inbound || []).map((i) => (i.address || "").trim()).filter(Boolean);
      const bestInbound = unlinkedInbounds[0] || `/${unlinkedFlow}`;

      let bestCaller = null;
      let bestHangingCount = -1;

      for (const candidateCaller of executedFlowIds) {
        if (candidateCaller === unlinkedFlow) continue;
        const hanging = hangingByCaller[candidateCaller] || [];
        const hasDynamic = (flowModels[candidateCaller]?.outbound || []).some((o) => {
          const n = (o.address || "").trim().toLowerCase();
          return n.includes("${") || n.includes("{{") || !n.startsWith("/");
        });
        if (hanging.length === 0 && !hasDynamic) continue;

        const hangingCount = hanging.length + (hasDynamic ? 1 : 0);
        if (hangingCount > bestHangingCount) {
          bestHangingCount = hangingCount;
          bestCaller = candidateCaller;
        }
      }

      if (!bestCaller && effectiveRoot !== unlinkedFlow) {
        bestCaller = effectiveRoot;
      }

      if (bestCaller) {
        // If bestCaller had a dynamic hanging outbound, mark it satisfied/removed
        const hangingList = hangingByCaller[bestCaller] || [];
        const dynamicIdx = hangingList.findIndex((h) => h.isDynamic);
        if (dynamicIdx !== -1) {
          hangingList.splice(dynamicIdx, 1);
        }

        const edgeKey = `${bestCaller}->${unlinkedFlow}:inferred`;
        if (!directedEdges.some((e) => e.key === edgeKey || (e.from === bestCaller && e.to === unlinkedFlow))) {
          directedEdges.push({
            key: edgeKey,
            from: bestCaller,
            to: unlinkedFlow,
            address: bestInbound,
            rawAddress: bestInbound,
            isDynamic: true,
            isInferred: true,
            matchType: "Correlation Inference",
            channelName: "Correlated Sub-flow",
          });
          matchedChildren.add(unlinkedFlow);
          resolutionLogs.push({
            Caller: bestCaller,
            "Raw Outbound": "(Correlation Inference)",
            "Matched Callee": unlinkedFlow,
            "Resolved Address": bestInbound,
            "Match Type": "Correlation Inference",
          });
        }
      }
    }

    const distinctFlowIds = Array.from(allDiscoveredFlows);

    // 6. Compute Hierarchical Levels (DAG topological BFS from Root)
    const levels = this.computeDagLevels(effectiveRoot, directedEdges, distinctFlowIds);

    // 7. Construct Final Node objects
    const nodes = distinctFlowIds.map((fid) => {
      const runs = getLogsForFlow(fid);
      const model = flowModels[fid] || {};
      const latestRun = runs[0] || {};

      let totalDuration = 0;
      runs.forEach((r) => {
        const start = parseMs(r.LogStart);
        const end = parseMs(r.LogEnd);
        if (start && end && end >= start) {
          totalDuration += end - start;
        }
      });

      // Filter out hanging entries that are actually satisfied by directed edges from fid
      const edgesFromThisCaller = directedEdges.filter((e) => e.from === fid);
      const rawHanging = hangingByCaller[fid] || [];
      const filteredHanging = rawHanging.filter((h) => {
        const directlyMatched = edgesFromThisCaller.some(
          (e) =>
            e.channelId === h.channelId ||
            e.rawAddress === h.rawAddress ||
            e.address === h.address ||
            matchAddress(e.address, h.address) ||
            matchAddress(e.rawAddress, h.rawAddress)
        );
        if (directlyMatched) return false;

        if (h.isDynamic && edgesFromThisCaller.some((e) => e.isDynamic || e.isInferred)) {
          return false;
        }

        return true;
      });

      const displayName = latestRun.IntegrationArtifact?.Name || latestRun.IntegrationFlowName || (store ? store.getArtifactName(fid) : "") || model.flowName || fid;

      return {
        id: fid,
        name: displayName,
        displayName: displayName,
        description: model.flowDescription || "",
        level: levels[fid] !== undefined ? levels[fid] : 1,
        isRoot: fid === effectiveRoot,
        runsCount: runs.length,
        runs,
        totalDuration,
        status: latestRun.Status || "COMPLETED",
        hanging: filteredHanging,
      };
    });

    nodes.sort((a, b) => a.level - b.level || b.totalDuration - a.totalDuration);

    return {
      rootFlowId: effectiveRoot,
      nodes,
      edges: directedEdges,
      levels,
      hangingNodes: hangingByCaller,
      _diagnostics: {
        flowModels,
        inboundRegistry,
        resolutionLogs,
      },
    };
  },

  /**
   * Computes topological DAG levels using BFS traversal with cycle protection.
   */
  computeDagLevels(root, edges, allNodes) {
    const nodeLevels = { [root]: 0 };
    const queue = [root];
    const visited = new Set([root]);

    while (queue.length > 0) {
      const curr = queue.shift();
      const currLevel = nodeLevels[curr] || 0;
      const outEdges = edges.filter((e) => e.from === curr);

      outEdges.forEach((e) => {
        const nextLevel = currLevel + 1;
        if (nodeLevels[e.to] === undefined || nextLevel > nodeLevels[e.to]) {
          nodeLevels[e.to] = nextLevel;
        }
        if (!visited.has(e.to)) {
          visited.add(e.to);
          queue.push(e.to);
        }
      });
    }

    allNodes.forEach((id) => {
      if (nodeLevels[id] === undefined) nodeLevels[id] = 1;
    });

    return nodeLevels;
  },

  /**
   * Generates ASCII subtree diagram for diagnostics and console reporting.
   */
  generateAsciiTree(rootFlowId, nodes, edges) {
    const lines = [];
    lines.push(`[Root] ${rootFlowId}`);

    function printChildren(parentId, prefix = "  ") {
      const outEdges = edges.filter((e) => e.from === parentId);
      outEdges.forEach((e, idx) => {
        const isLast = idx === outEdges.length - 1;
        const branch = isLast ? "└── " : "├── ";
        const childNode = nodes.find((n) => n.id === e.to);
        const runsStr = childNode ? `(${childNode.runsCount} runs)` : "";
        lines.push(`${prefix}${branch}${e.to} ${runsStr} [${e.address}]`);
        printChildren(e.to, prefix + (isLast ? "    " : "│   "));
      });
    }

    printChildren(rootFlowId);
    return lines.join("\n");
  },
};

// Expose globally
if (typeof window !== "undefined") {
  window.CmdPdDiscoveryEngine = CmdPdDiscoveryEngine;
}
if (typeof global !== "undefined") {
  global.CmdPdDiscoveryEngine = CmdPdDiscoveryEngine;
}
