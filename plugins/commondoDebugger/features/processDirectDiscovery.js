// ===========================================================================
// COMMODNO IS DEBUGGER - PROCESSDIRECT DISCOVERY ENGINE
// ===========================================================================
// Multi-tier recursive ProcessDirect dependency resolution engine.
// Supports both static BPMN parsing and runtime correlation-driven dynamic topology
// resolution (resolving dynamic expressions like /${property.reportId}).

const CmdProcessDirectDiscovery = {
  /**
   * Constructs the runtime ProcessDirect execution topology for a specific Correlation ID.
   * Resolves dynamic outbound expressions using BPMN static analysis, externalized
   * parameters, trace payload inspection, and correlation-based structural inference.
   * Zero timestamp/timing heuristics. Fast and strictly cached.
   */
  async buildCorrelationTopology(rootFlowId, correlationLogs = [], packageId = null) {
    const apiHelper = typeof CmdCpiApiHelper !== "undefined" ? CmdCpiApiHelper : {};
    const bpmnHelper = typeof CmdBpmnModelHelper !== "undefined" ? CmdBpmnModelHelper : {};

    if (!correlationLogs || correlationLogs.length === 0) {
      return {
        nodes: [{ id: rootFlowId, level: 0, runCount: 1 }],
        edges: [],
        levels: { [rootFlowId]: 0 },
      };
    }

    // 1. Group correlation logs by flow ID
    const logsByFlowId = {};
    correlationLogs.forEach((log) => {
      const flowId = log.IntegrationFlowName || log.IntegrationArtifact?.Id || "iFlow";
      if (!logsByFlowId[flowId]) logsByFlowId[flowId] = [];
      logsByFlowId[flowId].push(log);
    });

    const executedFlowIds = Object.keys(logsByFlowId);
    const pkgId = packageId || (await apiHelper.resolveCurrentPackageId(rootFlowId));
    const flowModels = {};
    const inboundRegistry = []; // { flowId, address, normalized }
    const combinedParamMap = {}; // Shared across all flows in the package

    // Address matching helper (strips leading/trailing slashes, case-insensitive)
    function matchAddress(a1, a2) {
      if (!a1 || !a2) return false;
      const s1 = String(a1).trim().toLowerCase().replace(/^\/+|\/+$/g, "");
      const s2 = String(a2).trim().toLowerCase().replace(/^\/+|\/+$/g, "");
      return Boolean(s1 && s2 && s1 === s2);
    }

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
      // Copy parameters to combined map
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
          // Also register param name and raw template as fallback match targets
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
    // Load ONLY the executed flows and active flow initially (prevents downloading 50 unneeded ZIPs)
    const initialFlows = Array.from(new Set([...executedFlowIds, rootFlowId])).filter(Boolean);
    await Promise.all(
      initialFlows.map(async (flowId) => {
        try {
          const model = await bpmnHelper.fetchIFlowBpmnModel(flowId, pkgId);
          flowModels[flowId] = model;
          registerFlowInbounds(flowId, model);
        } catch (e) {
          flowModels[flowId] = { inbound: [], outbound: [], steps: {}, paramMap: {} };
        }
      })
    );

    // 3. Structural Root Detection (Zero timing heuristics):
    // The entry point flow is the executed flow that has NO inbound ProcessDirect channel
    // (e.g. triggered via HTTPS / Timer / SFTP / Mail).
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

    // 4. Unified Recursive Graph Worklist (Static -> Parameters.prop -> Trace Payload)
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
      if (!flowModels[callerId]) {
        try {
          const model = await bpmnHelper.fetchIFlowBpmnModel(callerId, pkgId);
          flowModels[callerId] = model;
          registerFlowInbounds(callerId, model);
        } catch (e) {
          flowModels[callerId] = { inbound: [], outbound: [], steps: {}, paramMap: {} };
        }
      }

      const model = flowModels[callerId] || { outbound: [], paramMap: {} };
      const callerLogs = logsByFlowId[callerId] || [];

      // Lazy load trace data if caller has dynamic outbounds and trace is available
      let traceData = null;
      const hasDynamicOutbounds = model.outbound.some((o) => {
        const n = (o.address || "").trim().toLowerCase();
        return n.includes("${") || n.includes("{{") || !n.startsWith("/");
      });

      if (hasDynamicOutbounds && callerLogs.length > 0 && typeof CmdTracePayloadHelper !== "undefined") {
        for (const log of callerLogs) {
          if (log.MessageGuid && (log.LogLevel === "TRACE" || !traceData)) {
            try {
              traceData = await CmdTracePayloadHelper.fetchRunTraceHeadersAndProperties(log.MessageGuid);
              if (traceData && (Object.keys(traceData.properties || {}).length > 0 || Object.keys(traceData.headers || {}).length > 0)) {
                break;
              }
            } catch (eTrace) {}
          }
        }
      }

      for (const outChan of model.outbound) {
        const rawAddress = (outChan.address || "").trim();
        const normOut = rawAddress.toLowerCase();

        let resolvedTargetFlow = null;
        let resolvedEndpointAddress = null;
        let isDynamic = false;
        let matchDescription = "";

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
          // Recursive resolution if pVal is itself a {{param}}
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
        const isDynamicExpr = normOut.includes("${") || normOut.includes("{{") || !normOut.startsWith("/");
        if (!resolvedTargetFlow && isDynamicExpr && traceData) {
          let traceVal = null;
          let extractedKey = "";

          // 3a. Try explicit ${property.xxx} or ${header.xxx} extraction
          const propMatch = rawAddress.match(/\$\{(?:property\.)?([^\}]+)\}/i);
          const headerMatch = rawAddress.match(/\$\{(?:header\.)?([^\}]+)\}/i);

          if (propMatch && propMatch[1]) {
            extractedKey = propMatch[1].trim();
            traceVal = traceData.properties?.[extractedKey] || traceData.properties?.[extractedKey.toLowerCase()];
          } else if (headerMatch && headerMatch[1]) {
            extractedKey = headerMatch[1].trim();
            traceVal = traceData.headers?.[extractedKey] || traceData.headers?.[extractedKey.toLowerCase()];
          }

          // 3b. Fallback: scan all property/header keys for substring match
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

          // 3c. Deep scan: check if ANY property or header value matches a known flow or endpoint
          if (!traceVal) {
            const allTraceValues = [
              ...Object.values(traceData.properties || {}),
              ...Object.values(traceData.headers || {}),
            ].filter((v) => typeof v === "string" && v.length > 2 && (v.startsWith("/") || executedFlowIds.some((f) => matchAddress(f, v))));

            for (const tv of allTraceValues) {
              const deepMatch = inboundRegistry.find((r) => matchAddress(r.address, tv) && r.flowId !== callerId)
                             || inboundRegistry.find((r) => matchAddress(r.flowId, tv) && r.flowId !== callerId);
              if (deepMatch) {
                traceVal = tv;
                extractedKey = "Deep Trace Match";
                resolvedTargetFlow = deepMatch.flowId;
                resolvedEndpointAddress = deepMatch.address;
                isDynamic = true;
                matchDescription = `Trace Payload Deep Match (${tv} -> ${deepMatch.flowId})`;
                break;
              }
            }
          }

          if (traceVal && !resolvedTargetFlow) {
            const traceMatch = inboundRegistry.find((r) => matchAddress(r.address, traceVal) && r.flowId !== callerId)
                            || inboundRegistry.find((r) => matchAddress(r.flowId, traceVal) && r.flowId !== callerId);
            if (traceMatch) {
              resolvedTargetFlow = traceMatch.flowId;
              resolvedEndpointAddress = traceMatch.address;
              isDynamic = true;
              matchDescription = `Trace Payload Inspection (${extractedKey || rawAddress} = ${traceVal})`;
            }
          }
        }

        // Pass 4: Link Edge or Fallback to Hanging Dynamic Pill
        if (resolvedTargetFlow) {
          allDiscoveredFlows.add(resolvedTargetFlow);
          if (!directedEdges.some((e) => e.from === callerId && e.to === resolvedTargetFlow && e.address === resolvedEndpointAddress)) {
            directedEdges.push({
              from: callerId,
              to: resolvedTargetFlow,
              address: resolvedEndpointAddress,
              rawAddress: rawAddress,
              isDynamic: isDynamic,
              matchType: matchDescription,
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

          // Enqueue newly discovered flow to resolve its children as well
          if (!visitedInWorkQueue.has(resolvedTargetFlow)) {
            workQueue.push(resolvedTargetFlow);
          }
        } else if (isDynamicExpr) {
          if (!hangingByCaller[callerId]) hangingByCaller[callerId] = [];
          if (!hangingByCaller[callerId].some((h) => h.rawAddress === rawAddress)) {
            hangingByCaller[callerId].push({
              address: rawAddress,
              rawAddress: rawAddress,
              isDynamic: true,
            });
            resolutionLogs.push({
              Caller: callerId,
              "Raw Outbound": rawAddress,
              "Matched Callee": "(None - Trace Missing / Hanging Call)",
              "Resolved Address": rawAddress,
              "Match Type": "Hanging Dynamic Endpoint",
            });
          }
        }
      }
    }

    // Pass 5: Correlation-Based Structural Inference (Zero timing)
    // For any executed flow in this correlation that has NO incoming edge,
    // link it from the caller that has unresolved hanging outbounds or dynamic outbounds.
    const flowsWithIncomingEdge = new Set(directedEdges.map((e) => e.to));
    const executedButUnlinked = executedFlowIds.filter((fId) => fId !== effectiveRoot && !flowsWithIncomingEdge.has(fId));

    for (const unlinkedFlow of executedButUnlinked) {
      const unlinkedModel = flowModels[unlinkedFlow] || {};
      const unlinkedInbounds = (unlinkedModel.inbound || []).map((i) => (i.address || "").trim()).filter(Boolean);
      const bestInbound = unlinkedInbounds[0] || `/${unlinkedFlow}`;

      // Structural parent selection: find the caller with the most hanging/dynamic outbounds
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

      // If no hanging caller found, link from effectiveRoot
      if (!bestCaller && effectiveRoot !== unlinkedFlow) {
        bestCaller = effectiveRoot;
      }

      if (bestCaller) {
        if (!directedEdges.some((e) => e.from === bestCaller && e.to === unlinkedFlow)) {
          directedEdges.push({
            from: bestCaller,
            to: unlinkedFlow,
            address: bestInbound,
            rawAddress: bestInbound,
            isDynamic: true,
            matchType: "Correlation Inference",
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

    // 4. Compute Hierarchical Levels (DAG topological BFS from Root)
    const nodeLevels = { [effectiveRoot]: 0 };
    const queue = [effectiveRoot];
    const visited = new Set([effectiveRoot]);

    while (queue.length > 0) {
      const curr = queue.shift();
      const currLevel = nodeLevels[curr] || 0;

      const outEdges = directedEdges.filter((e) => e.from === curr);
      outEdges.forEach((e) => {
        const nextLevel = currLevel + 1;
        // In a DAG, node level should be at least (parentLevel + 1)
        if (nodeLevels[e.to] === undefined || nextLevel > nodeLevels[e.to]) {
          nodeLevels[e.to] = nextLevel;
        }
        if (!visited.has(e.to)) {
          visited.add(e.to);
          queue.push(e.to);
        }
      });
    }

    distinctFlowIds.forEach((id) => {
      if (nodeLevels[id] === undefined) nodeLevels[id] = 1;
    });

    // 5. Construct Final Nodes
    const topologyNodes = distinctFlowIds.map((id) => ({
      id: id,
      level: nodeLevels[id] || 0,
      runCount: (logsByFlowId[id] || []).length,
      outboundCalls: (flowModels[id]?.outbound || []).length,
      inboundEndpoints: (flowModels[id]?.inbound || []).map((i) => i.address).join(", "),
      hangingOutbounds: hangingByCaller[id] || [],
    }));

    return {
      nodes: topologyNodes,
      edges: directedEdges,
      levels: nodeLevels,
      rootFlowId: effectiveRoot,
      _diagnostics: {

        flowModels,
        inboundRegistry,
        resolutionLogs,
      },
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
      const hangingOutbounds = [];

      for (const outChan of model.outbound) {
        const rawAddress = (outChan.address || "").trim();
        const normTarget = rawAddress.toLowerCase();
        let targetFlow = endpointToIFlowMap.get(normTarget);

        if (targetFlow) {
          if (!directedEdges.some((e) => e.from === currFlow && e.to === targetFlow && e.address === rawAddress)) {
            directedEdges.push({
              from: currFlow,
              to: targetFlow,
              address: rawAddress,
              channel: "ProcessDirect",
              sourceLevel: currLevel,
              targetLevel: currLevel + 1,
              isDynamic: false,
              matchType: "Static Match",
            });

            if (!visitedNodes.has(targetFlow)) {
              visitedNodes.add(targetFlow);
              queue.push({ flowId: targetFlow, level: currLevel + 1 });
            }
          }
        } else if (normTarget.includes("${") || normTarget.includes("{{") || !normTarget.startsWith("/")) {
          hangingOutbounds.push({
            address: rawAddress,
            rawAddress: rawAddress,
            isDynamic: true,
          });
        }
      }

      topologyNodes.push({
        id: currFlow,
        level: currLevel,
        outboundCalls: model.outbound.length,
        outboundAddresses: model.outbound.map((o) => o.address).join(", "),
        inboundEndpoints: model.inbound.map((i) => i.address).join(", "),
        totalBpmnSteps: Object.keys(model.steps).length,
        hangingOutbounds: hangingOutbounds,
      });
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

    // Clear caches for this test execution run so fresh trace data and graph are generated
    if (typeof CmdTracePayloadHelper !== "undefined" && CmdTracePayloadHelper.clearCache) {
      CmdTracePayloadHelper.clearCache();
    }
    if (typeof CmdBpmnModelHelper !== "undefined" && CmdBpmnModelHelper.clearCache) {
      CmdBpmnModelHelper.clearCache();
    }

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

    console.log(`\n[1/5] Executed iFlows in Correlation ID "${targetRun.CorrelationId}" (${corrLogs.length} total message logs):`);
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
    console.log("\n[2/5] Resolving ProcessDirect Topology Graph (Static-First -> Dynamic)...");
    const topoResult = await this.buildCorrelationTopology(activeFlow, corrLogs, pkgId);
    const diag = topoResult._diagnostics || {};

    // 4. Detailed Diagnostic Breakdowns
    console.groupCollapsed("[3/5] BPMN Models & Inbound/Outbound Channels per Executed Flow");
    console.log("Inbound Endpoint Registry:");
    console.table(diag.inboundRegistry || []);
    Object.keys(diag.flowModels || {}).forEach((fId) => {
      const m = diag.flowModels[fId];
      console.log(`%cFlow: ${fId}`, "font-weight: bold; color: #0284c7;", {
        inbound: m.inbound,
        outbound: m.outbound,
      });
    });
    console.groupEnd();

    console.groupCollapsed("[4/5] Step-by-Step Channel Resolution Decision Trail");
    console.log("Resolution Trail:");
    console.table(diag.resolutionLogs || []);
    console.groupEnd();

    console.log("\n[5/5] Final Discovered Topology Graph:");
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
        "Match Type": e.matchType || (e.isDynamic ? "Dynamic" : "Static"),
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
