// ===========================================================================
// COMMNDO IS DEBUGGER - TOPOLOGY GRAPH VIEW (CmdTopologyGraphView)
// ===========================================================================
// Renders the interactive SVG Directional Topology Map (DAG) driven by BPMN
// ProcessDirect discovery, with top-to-bottom layout, directional arrows,
// endpoint address labels, multi-run instance badges, and smooth pan/zoom controls.

const CmdTopologyGraphView = {
  /**
   * Renders the interactive SVG Directional Topology Graph (Top-to-Bottom).
   * @param {HTMLElement} container - DOM container element.
   * @param {Object} topologyData - { nodes, edges, levels } from CmdPdDiscoveryEngine.
   * @param {Object} logsByFlowId - Map of flow ID to array of message logs in current run chain.
   * @param {string} selectedNodeId - Currently selected flow ID.
   * @param {Function} onSelectNode - Callback (nodeId, logsForNode) when a node is clicked.
   */
  renderDirectionalTopology(container, topologyData, logsByFlowId = {}, selectedNodeId = null, onSelectNode = null) {
    if (!container) return;
    container.innerHTML = "";

    const regularNodes = topologyData?.nodes || [];
    const regularEdges = topologyData?.edges || [];

    if (regularNodes.length === 0) {
      container.innerHTML = `<div style="text-align: center; color: #888; margin-top: 150px; font-size: 0.95rem;">No topology nodes discovered.</div>`;
      return;
    }

    const utils = typeof CmdUtils !== "undefined" ? CmdUtils : {};
    const escapeHtml = utils.escapeHtml || ((s) => s || "");
    const store = typeof CmdStateStore !== "undefined" ? CmdStateStore : null;

    const nodeWidth = 260;
    const nodeHeight = 74;
    const hangingWidth = 165;
    const hangingHeight = 28;
    const posMap = {};
    const edgeRoutes = [];

    // Construct full graph elements including aggregated hanging nodes (1 hanging node per flow)
    const allNodes = [...regularNodes];
    const allEdges = [...regularEdges];

    regularNodes.forEach((n) => {
      const hangings = n.hangingOutbounds || n.hanging || [];
      if (!hangings || hangings.length === 0) return;

      const count = hangings.length;
      const hangingId = `hanging__${n.id}`;

      // Dynamic sizing based on number of items:
      // 1 item: 180x28px
      // 2 items: 215x56px
      // 3 items: 215x74px
      // N items: 215x(24 + N*18)px
      const hHeight = count === 1 ? 28 : Math.min(140, 24 + count * 18);
      const hWidth = count === 1 ? 180 : 215;

      const hangingNode = {
        id: hangingId,
        isHanging: true,
        callerId: n.id,
        count: count,
        hangings: hangings,
        address: hangings[0].address || hangings[0].rawAddress || "Unresolved",
        rawAddress: hangings[0].rawAddress || hangings[0].address || "Unresolved",
        width: hWidth,
        height: hHeight,
        level: (n.level !== undefined ? n.level : 0) + 1,
      };
      allNodes.push(hangingNode);

      allEdges.push({
        from: n.id,
        to: hangingId,
        address: count === 1 ? (hangings[0].address || hangings[0].rawAddress) : `${count} unresolved`,
        rawAddress: count === 1 ? (hangings[0].rawAddress || hangings[0].address) : `${count} unresolved`,
        isHangingEdge: true,
        matchType: "Unresolved Outbound",
      });
    });

    // Check if Dagre layout engine is available
    const dagreLib = typeof dagre !== "undefined" && dagre.graphlib ? dagre : typeof window !== "undefined" && window.dagre ? window.dagre : null;

    if (dagreLib) {
      const gLayout = new dagreLib.graphlib.Graph({ multigraph: true });
      gLayout.setGraph({
        rankdir: "TB",
        nodesep: 60, // Horizontal space between sibling cards on the same rank
        ranksep: 80, // Vertical space between ranks
        marginx: 40,
        marginy: 30,
      });
      gLayout.setDefaultEdgeLabel(() => ({}));

      allNodes.forEach((n) => {
        const w = n.isHanging ? (n.width || hangingWidth) : nodeWidth;
        const h = n.isHanging ? (n.height || hangingHeight) : nodeHeight;
        gLayout.setNode(n.id, { width: w, height: h, node: n });
      });

      allEdges.forEach((e, idx) => {
        gLayout.setEdge(e.from, e.to, { address: e.address, edgeData: e }, `edge_${idx}`);
      });

      dagreLib.layout(gLayout);

      // Collect node positions (Dagre node.x and node.y represent the center of the node)
      allNodes.forEach((n) => {
        const dNode = gLayout.node(n.id);
        const w = n.isHanging ? (n.width || hangingWidth) : nodeWidth;
        const h = n.isHanging ? (n.height || hangingHeight) : nodeHeight;
        if (dNode) {
          posMap[n.id] = {
            x: dNode.x - w / 2,
            y: dNode.y - h / 2,
            width: w,
            height: h,
            node: n,
          };
        }
      });

      // Collect edge waypoint routes
      allEdges.forEach((e, idx) => {
        const dEdge = gLayout.edge(e.from, e.to, `edge_${idx}`);
        if (dEdge && dEdge.points) {
          const midIdx = Math.floor(dEdge.points.length / 2);
          const midPoint = dEdge.points[midIdx] || dEdge.points[0];
          edgeRoutes.push({
            edge: e,
            points: dEdge.points,
            labelX: dEdge.x !== undefined ? dEdge.x : midPoint.x,
            labelY: dEdge.y !== undefined ? dEdge.y : midPoint.y,
          });
        }
      });
    } else {
      // Fallback manual layout if Dagre is unavailable
      const nodeSpacingX = 320;
      const levelSpacingY = 130;
      const paddingX = 50;
      const paddingY = 30;

      const levelNodesMap = {};
      allNodes.forEach((node) => {
        const lvl = node.level !== undefined ? node.level : 0;
        if (!levelNodesMap[lvl]) levelNodesMap[lvl] = [];
        levelNodesMap[lvl].push(node);
      });

      const levelKeys = Object.keys(levelNodesMap)
        .map(Number)
        .sort((a, b) => a - b);
      const maxNodesInAnyLevel = Math.max(...levelKeys.map((k) => levelNodesMap[k].length), 1);
      const maxRowWidth = (maxNodesInAnyLevel - 1) * nodeSpacingX + nodeWidth;

      levelKeys.forEach((lvl) => {
        const nodesAtLevel = levelNodesMap[lvl];
        const count = nodesAtLevel.length;
        const rowWidth = (count - 1) * nodeSpacingX + nodeWidth;
        const rowStartX = paddingX + Math.max(0, (maxRowWidth - rowWidth) / 2);

        nodesAtLevel.forEach((node, idx) => {
          const w = node.isHanging ? (node.width || hangingWidth) : nodeWidth;
          const h = node.isHanging ? (node.height || hangingHeight) : nodeHeight;
          posMap[node.id] = {
            x: rowStartX + idx * nodeSpacingX,
            y: paddingY + lvl * levelSpacingY,
            width: w,
            height: h,
            node: node,
          };
        });
      });

      allEdges.forEach((e) => {
        const fromPos = posMap[e.from];
        const toPos = posMap[e.to];
        if (fromPos && toPos) {
          const x1 = fromPos.x + fromPos.width / 2;
          const y1 = fromPos.y + fromPos.height;
          const x2 = toPos.x + toPos.width / 2;
          const y2 = toPos.y;
          const midY = (y1 + y2) / 2;
          const midX = (x1 + x2) / 2;
          edgeRoutes.push({
            edge: e,
            points: [
              { x: x1, y: y1 },
              { x: x1, y: midY },
              { x: x2, y: midY },
              { x: x2, y: y2 },
            ],
            labelX: midX,
            labelY: midY,
          });
        }
      });
    }

    // Save exact computed layout coordinates for export persistence
    if (topologyData && typeof topologyData === "object") {
      topologyData.layout = {
        posMap: JSON.parse(JSON.stringify(posMap)),
        edgeRoutes: JSON.parse(JSON.stringify(edgeRoutes)),
      };
    }

    // Outer Map Wrapper
    const mapWrapper = document.createElement("div");
    mapWrapper.style.cssText = "position: relative; width: 100%; height: 100%; overflow: hidden; background: #f8fafc; user-select: none; border-radius: 6px;";

    // Toolbar Controls
    const toolbar = document.createElement("div");
    toolbar.style.cssText =
      "position: absolute; top: 12px; right: 12px; z-index: 10; display: flex; gap: 4px; background: rgba(255,255,255,0.95); padding: 4px 6px; border-radius: 6px; box-shadow: 0 2px 8px rgba(0,0,0,0.12); border: 1px solid #e2e8f0;";
    toolbar.innerHTML = `
      <button id="cmd-zoom-in" class="ui mini button" title="Zoom In" style="padding: 4px 8px; font-weight: bold; margin: 0;">+</button>
      <button id="cmd-zoom-out" class="ui mini button" title="Zoom Out" style="padding: 4px 8px; font-weight: bold; margin: 0;">-</button>
      <button id="cmd-zoom-reset" class="ui mini button" title="Reset View" style="padding: 4px 8px; font-size: 0.75rem; margin: 0;">Fit</button>
    `;
    mapWrapper.appendChild(toolbar);

    // SVG Canvas Element
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.style.cursor = "grab";

    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    defs.innerHTML = `
      <marker id="cmd-arrow-down" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#0284c7"/>
      </marker>
      <marker id="cmd-arrow-down-gray" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#64748b"/>
      </marker>
      <marker id="cmd-arrow-hanging" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#f59e0b"/>
      </marker>
    `;
    svg.appendChild(defs);

    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    svg.appendChild(g);
    mapWrapper.appendChild(svg);
    container.appendChild(mapWrapper);

    // Pan & Zoom State
    let scale = 0.95;
    let pointX = 20;
    let pointY = 15;
    let isPanning = false;
    let startX = 0;
    let startY = 0;

    function setTransform() {
      g.setAttribute("transform", `translate(${pointX}, ${pointY}) scale(${scale})`);
    }

    svg.onmousedown = (e) => {
      if (e.target.closest(".cmd-node-group")) return;
      isPanning = true;
      startX = e.clientX - pointX;
      startY = e.clientY - pointY;
      svg.style.cursor = "grabbing";
    };

    const handleMouseMove = (e) => {
      if (!isPanning) return;
      pointX = e.clientX - startX;
      pointY = e.clientY - startY;
      setTransform();
    };

    const handleMouseUp = () => {
      isPanning = false;
      svg.style.cursor = "grab";
    };

    if (window.__cmdHandleMouseMove) window.removeEventListener("mousemove", window.__cmdHandleMouseMove);
    if (window.__cmdHandleMouseUp) window.removeEventListener("mouseup", window.__cmdHandleMouseUp);
    window.__cmdHandleMouseMove = handleMouseMove;
    window.__cmdHandleMouseUp = handleMouseUp;
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    svg.onwheel = (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.08 : 0.08;
      scale = Math.min(Math.max(0.35, scale + delta), 2.5);
      setTransform();
    };

    toolbar.querySelector("#cmd-zoom-in").onclick = () => {
      scale = Math.min(scale + 0.15, 2.5);
      setTransform();
    };
    toolbar.querySelector("#cmd-zoom-out").onclick = () => {
      scale = Math.max(scale - 0.15, 0.35);
      setTransform();
    };
    toolbar.querySelector("#cmd-zoom-reset").onclick = () => {
      scale = 0.95;
      pointX = 20;
      pointY = 15;
      setTransform();
    };

    // Helper to generate smooth SVG path from Dagre points
    function pointsToSmoothPath(points) {
      if (!points || points.length < 2) return "";
      if (points.length === 2) {
        return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
      }
      if (points.length === 3) {
        return `M ${points[0].x} ${points[0].y} Q ${points[1].x} ${points[1].y}, ${points[2].x} ${points[2].y}`;
      }
      if (points.length === 4) {
        return `M ${points[0].x} ${points[0].y} C ${points[1].x} ${points[1].y}, ${points[2].x} ${points[2].y}, ${points[3].x} ${points[3].y}`;
      }
      let d = `M ${points[0].x} ${points[0].y}`;
      for (let i = 1; i < points.length; i++) {
        d += ` L ${points[i].x} ${points[i].y}`;
      }
      return d;
    }

    const isStaticGraph = Boolean(topologyData?.isStatic || (topologyData?.nodes || []).every((n) => n.status === "STATIC"));

    // 3. Draw Connecting Directional Curves (Top to Bottom) with ProcessDirect Endpoint Labels
    edgeRoutes.forEach((route) => {
      const edge = route.edge;
      const points = route.points;
      if (!points || points.length === 0) return;

      const isHangingEdge = Boolean(edge.isHangingEdge);
      const strokeColor = isHangingEdge ? "#f59e0b" : (isStaticGraph ? "#64748b" : "#0284c7");
      const strokeWidth = isHangingEdge ? "1.4" : "2.0";
      const strokeDash = isHangingEdge ? "3,3" : "none";
      const markerEnd = isHangingEdge ? "url(#cmd-arrow-hanging)" : (isStaticGraph ? "url(#cmd-arrow-down-gray)" : "url(#cmd-arrow-down)");

      const pathData = pointsToSmoothPath(points);
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", pathData);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", strokeColor);
      path.setAttribute("stroke-width", strokeWidth);
      path.setAttribute("stroke-dasharray", strokeDash);
      path.setAttribute("marker-end", markerEnd);
      g.appendChild(path);

      // ProcessDirect Endpoint Label Pill
      if (edge.address && !isHangingEdge) {
        let labelText = edge.address;
        if (labelText.length > 28) labelText = labelText.substring(0, 26) + "..";

        const edgeG = document.createElementNS("http://www.w3.org/2000/svg", "g");
        const pillWidth = Math.max(70, labelText.length * 6.8 + 18);
        const pillHeight = 22;
        const midX = route.labelX;
        const midY = route.labelY;
        const pillFill = isStaticGraph ? "#f8fafc" : "#ffffff";
        const pillStroke = isStaticGraph ? "#94a3b8" : "#0284c7";
        const pillTextColor = isStaticGraph ? "#334155" : "#0369a1";

        edgeG.innerHTML = `
          <title>${escapeHtml(edge.rawAddress || edge.address)} (${escapeHtml(edge.matchType || "ProcessDirect")})</title>
          <rect x="${midX - pillWidth / 2}" y="${midY - pillHeight / 2}" width="${pillWidth}" height="${pillHeight}" rx="11"
                fill="${pillFill}" stroke="${pillStroke}" stroke-width="1.2" filter="drop-shadow(0 1px 3px rgba(0,0,0,0.1))"/>
          <text x="${midX}" y="${midY + 4}" text-anchor="middle" font-size="10.5px" font-weight="600" fill="${pillTextColor}">
            ${escapeHtml(labelText)}
          </text>
        `;
        g.appendChild(edgeG);
      }
    });

    // 4. Draw Nodes
    Object.values(posMap).forEach((pos) => {
      const node = pos.node;
      const flowId = node.id;
      const isHanging = Boolean(node.isHanging);

      const nodeG = document.createElementNS("http://www.w3.org/2000/svg", "g");
      nodeG.setAttribute("class", "cmd-node-group");
      nodeG.style.cursor = "pointer";

      if (isHanging) {
        if (node.count > 1) {
          const subItems = (node.hangings || []).slice(0, 5);
          let subItemsSvg = "";
          subItems.forEach((it, idx) => {
            let itemText = it.rawAddress || it.address || "outbound";
            if (itemText.length > 25) itemText = itemText.substring(0, 23) + "..";
            const itemY = pos.y + 36 + idx * 17;
            subItemsSvg += `
              <circle cx="${pos.x + 12}" cy="${itemY - 3.5}" r="2" fill="#f59e0b" />
              <text x="${pos.x + 19}" y="${itemY}" font-size="8.8px" font-family="monospace, sans-serif" fill="#78350f">
                ${escapeHtml(itemText)}
              </text>
            `;
          });

          const tooltipList = (node.hangings || []).map((h, i) => `${i + 1}. ${h.rawAddress || h.address}`).join("\n");

          nodeG.innerHTML = `
            <title>Unresolved Outbounds (${node.count}):\n${escapeHtml(tooltipList)}\nCaller: ${escapeHtml(node.callerId)}</title>
            <rect x="${pos.x}" y="${pos.y}" width="${pos.width}" height="${pos.height}" rx="8"
                  fill="#fffdf5" stroke="#f59e0b" stroke-width="1.2" stroke-dasharray="3,2"
                  filter="drop-shadow(0 1px 3px rgba(245,158,11,0.18))" />
            <rect x="${pos.x}" y="${pos.y}" width="${pos.width}" height="22" rx="8" fill="#fef3c7" />
            <circle cx="${pos.x + 10}" cy="${pos.y + 11}" r="3" fill="#f59e0b" />
            <text x="${pos.x + 18}" y="${pos.y + 14.5}" font-size="9.5px" font-weight="bold" fill="#92400e">
              ${node.count} Unresolved Endpoints
            </text>
            <text x="${pos.x + pos.width - 8}" y="${pos.y + 14.5}" text-anchor="end" font-size="9px" font-weight="bold" fill="#d97706">&gt;</text>
            ${subItemsSvg}
          `;
        } else {
          let labelText = node.rawAddress || node.address || "Unresolved";
          if (labelText.length > 20) labelText = labelText.substring(0, 18) + "..";

          nodeG.innerHTML = `
            <title>Unresolved Outbound: ${escapeHtml(node.rawAddress || node.address)}\nCaller: ${escapeHtml(node.callerId)} (Not executed or unmatched)</title>
            <rect x="${pos.x}" y="${pos.y}" width="${pos.width}" height="${pos.height}" rx="14"
                  fill="#fffdf5" stroke="#f59e0b" stroke-width="1.1" stroke-dasharray="3,2"
                  filter="drop-shadow(0 1px 2px rgba(245,158,11,0.15))" />
            <circle cx="${pos.x + 12}" cy="${pos.y + pos.height / 2}" r="3" fill="#f59e0b" />
            <text x="${pos.x + 20}" y="${pos.y + pos.height / 2 + 3.5}" font-size="9.5px" font-family="monospace, sans-serif" font-weight="bold" fill="#92400e">
              ${escapeHtml(labelText)}
            </text>
            <text x="${pos.x + pos.width - 10}" y="${pos.y + pos.height / 2 + 3}" text-anchor="end" font-size="9px" font-weight="bold" fill="#d97706">&gt;</text>
          `;
        }

        nodeG.onclick = (e) => {
          e.stopPropagation();
          if (onSelectNode) {
            onSelectNode(node.id, [], {
              isHanging: true,
              callerId: node.callerId,
              address: node.address,
              rawAddress: node.rawAddress,
              count: node.count,
              hangings: node.hangings || [node],
            });
          }
        };
      } else {
        const logs = logsByFlowId[flowId] || [];
        const hasRuns = logs.length > 0 && !isStaticGraph;
        const latestLog = hasRuns ? logs[0] : null;
        const isSelected = selectedNodeId && selectedNodeId === flowId;
        const isRoot = node.level === 0;

        // Status determination
        let status = isStaticGraph ? "DESIGN-TIME ARTIFACT" : hasRuns ? latestLog.Status || "COMPLETED" : "NOT EXECUTED";
        let statusColor = isStaticGraph ? "#64748b" : "#94a3b8"; // Neutral slate for static, gray for unexecuted
        if (hasRuns) {
          if (status === "COMPLETED") statusColor = "#10b981";
          else if (status === "FAILED") statusColor = "#ef4444";
          else if (status === "PROCESSING") statusColor = "#3b82f6";
          else if (status.match(/^(RETRY|ESCALATED|CANCELLED|DISCARDED)$/)) statusColor = "#f59e0b";
        }

        // Calculate total execution duration across all runs of this node
        let totalDurationMs = 0;
        if (hasRuns) {
          logs.forEach((l) => {
            if (l.LogStart && l.LogEnd) {
              const parseMs = (dt) => {
                const match = String(dt).match(/\d+/);
                return match ? parseInt(match[0], 10) : new Date(dt).getTime() || 0;
              };
              const s = parseMs(l.LogStart);
              const e = parseMs(l.LogEnd);
              if (e >= s) totalDurationMs += e - s;
            } else if (l.Duration) {
              totalDurationMs += Number(l.Duration);
            }
          });
        }

        const formatDur = utils.formatDuration || ((ms) => `${ms}ms`);
        const durationText = hasRuns ? formatDur(totalDurationMs) : "";

        const cachedModel = store ? store.getCachedBpmnModel(flowId) : null;
        const artName =
          (!isStaticGraph && logs[0]?.IntegrationArtifact?.Name) ||
          (!isStaticGraph && logs[0]?.IntegrationFlowName) ||
          node.displayName ||
          node.name ||
          (store ? store.getArtifactName(flowId) : "") ||
          cachedModel?.flowName ||
          flowId;

        let rawName = artName;
        if (rawName.length > 26) rawName = rawName.substring(0, 24) + "..";
        const displayName = escapeHtml(rawName);

        // Badge pill in top-right: Multi-run, Static, or Root
        const rightBadge = isStaticGraph
          ? (isRoot
              ? `<rect x="${pos.x + pos.width - 56}" y="${pos.y + 6}" width="48" height="18" rx="9" fill="#f1f5f9" stroke="#94a3b8" stroke-width="1"/>
                 <text x="${pos.x + pos.width - 32}" y="${pos.y + 19}" text-anchor="middle" font-size="10px" font-weight="bold" fill="#334155">ROOT</text>`
              : `<rect x="${pos.x + pos.width - 58}" y="${pos.y + 6}" width="50" height="18" rx="9" fill="#f8fafc" stroke="#cbd5e1" stroke-width="1"/>
                 <text x="${pos.x + pos.width - 33}" y="${pos.y + 19}" text-anchor="middle" font-size="10px" font-weight="bold" fill="#64748b">STATIC</text>`)
          : (!hasRuns
              ? `<rect x="${pos.x + pos.width - 62}" y="${pos.y + 6}" width="54" height="18" rx="9" fill="#f1f5f9" stroke="#94a3b8" stroke-width="1"/>
                 <text x="${pos.x + pos.width - 35}" y="${pos.y + 19}" text-anchor="middle" font-size="10px" font-weight="bold" fill="#64748b">0 runs</text>`
              : logs.length > 1
              ? `<rect x="${pos.x + pos.width - 66}" y="${pos.y + 6}" width="58" height="18" rx="9" fill="#fef3c7" stroke="#f59e0b" stroke-width="1"/>
                 <text x="${pos.x + pos.width - 37}" y="${pos.y + 19}" text-anchor="middle" font-size="10px" font-weight="bold" fill="#b45309">${logs.length} runs</text>`
              : isRoot
              ? `<rect x="${pos.x + pos.width - 52}" y="${pos.y + 6}" width="44" height="18" rx="9" fill="#e0f2fe" stroke="#0284c7" stroke-width="1"/>
                 <text x="${pos.x + pos.width - 30}" y="${pos.y + 19}" text-anchor="middle" font-size="10px" font-weight="bold" fill="#0369a1">ROOT</text>`
              : "");

        let runsBreakdownText = "";
        if (logs.length > 1 && !isStaticGraph) {
          runsBreakdownText = "\n\nRuns Duration Breakdown:\n" + logs.map((l, i) => {
            const parseMsFn = (dt) => {
              if (utils && utils.parseMs) return utils.parseMs(dt);
              const match = String(dt).match(/\d+/);
              return match ? parseInt(match[0], 10) : new Date(dt).getTime() || 0;
            };
            const s = parseMsFn(l.LogStart);
            const e = parseMsFn(l.LogEnd);
            const d = (s && e && e >= s) ? (e - s) : Number(l.Duration || 0);
            return `  • Run #${i + 1}: ${formatDur(d)} (${escapeHtml(l.Status || "COMPLETED")})`;
          }).join("\n");
        }

        const tooltipTitle = isStaticGraph
          ? `${escapeHtml(artName)}\nTechnical ID: ${escapeHtml(flowId)}\nDesign-Time Package Architecture Node`
          : `${escapeHtml(artName)}\nTechnical ID: ${escapeHtml(flowId)}${hasRuns ? `\nTotal Duration: ${durationText} (${logs.length} run${logs.length === 1 ? "" : "s"})${runsBreakdownText}` : " (Not executed in this correlation run)"}`;

        const cardFill = isStaticGraph ? (isSelected ? "#f1f5f9" : "#ffffff") : (!hasRuns ? "#f8fafc" : isSelected ? "#f0fdf4" : "#ffffff");
        const cardStroke = isStaticGraph ? (isSelected ? "#0284c7" : isRoot ? "#64748b" : "#cbd5e1") : (!hasRuns ? "#cbd5e1" : isSelected ? "#10b981" : isRoot ? "#0284c7" : "#cbd5e1");
        const cardStrokeWidth = isSelected ? "3" : isRoot ? "2" : "1.5";
        const cardStrokeDash = (!hasRuns && !isStaticGraph) ? "4,3" : "none";

        nodeG.innerHTML = `
          <title>${tooltipTitle}</title>
          <rect x="${pos.x}" y="${pos.y}" width="${pos.width}" height="${pos.height}" rx="8"
                fill="${cardFill}"
                stroke="${cardStroke}"
                stroke-width="${cardStrokeWidth}"
                stroke-dasharray="${cardStrokeDash}"
                filter="drop-shadow(0 2px 6px rgba(0,0,0,0.05))" />
          <rect x="${pos.x}" y="${pos.y}" width="6" height="${pos.height}" rx="3" fill="${statusColor}" />
          <text x="${pos.x + 16}" y="${pos.y + 24}" font-size="12.5px" font-weight="bold" fill="#1e293b">
            ${displayName}
          </text>
          <text x="${pos.x + 16}" y="${pos.y + 46}" font-size="11px" fill="#64748b">
            Status: <tspan font-weight="bold" fill="${statusColor}">${escapeHtml(status)}</tspan>${hasRuns && durationText ? ` | <tspan font-weight="600" fill="#334155">${logs.length > 1 ? `Total: ${durationText}` : durationText}</tspan>` : ""}
          </text>
          ${rightBadge}
        `;

        nodeG.onclick = (e) => {
          e.stopPropagation();
          if (onSelectNode) onSelectNode(flowId, logs);
        };
      }

      g.appendChild(nodeG);
    });

    setTransform();
  },
};

// Expose globally
if (typeof window !== "undefined") {
  window.CmdTopologyGraphView = CmdTopologyGraphView;
  window.CmdTopologyGraph = CmdTopologyGraphView; // backward-compatibility alias
}
if (typeof global !== "undefined") {
  global.CmdTopologyGraphView = CmdTopologyGraphView;
  global.CmdTopologyGraph = CmdTopologyGraphView;
}
