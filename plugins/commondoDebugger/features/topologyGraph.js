// ===========================================================================
// COMMODNO IS DEBUGGER - TOPOLOGY GRAPH FEATURE
// ===========================================================================
// Renders the interactive SVG Directional Topology Map (DAG) driven by BPMN
// ProcessDirect discovery, with directional arrows, endpoint address labels,
// multi-run instance badges, and smooth pan/zoom controls.

const CmdTopologyGraph = {
  /**
   * Renders the interactive SVG Directional Topology Graph.
   * @param {HTMLElement} container - DOM container element.
   * @param {Object} topologyData - { nodes, edges, levels } from CmdProcessDirectDiscovery.
   * @param {Object} logsByFlowId - Map of flow ID to array of message logs in current run chain.
   * @param {string} selectedNodeId - Currently selected flow ID.
   * @param {Function} onSelectNode - Callback (nodeId, logsForNode) when a node is clicked.
   */
  renderDirectionalTopology(container, topologyData, logsByFlowId = {}, selectedNodeId = null, onSelectNode = null) {
    if (!container) return;
    container.innerHTML = "";

    const nodes = topologyData?.nodes || [];
    const edges = topologyData?.edges || [];

    if (nodes.length === 0) {
      container.innerHTML = `<div style="text-align: center; color: #888; margin-top: 150px; font-size: 0.95rem;">No topology nodes discovered.</div>`;
      return;
    }

    const payloadHelper = typeof CmdTracePayloadHelper !== "undefined" ? CmdTracePayloadHelper : {};
    const escapeHtml = payloadHelper.escapeHtml || ((s) => s || "");

    // Group nodes into columns by hierarchical level
    const levelNodesMap = {};
    nodes.forEach((node) => {
      const lvl = node.level !== undefined ? node.level : 0;
      if (!levelNodesMap[lvl]) levelNodesMap[lvl] = [];
      levelNodesMap[lvl].push(node);
    });

    const levelKeys = Object.keys(levelNodesMap).map(Number).sort((a, b) => a - b);
    if (levelKeys.length === 0) levelKeys.push(0);

    const nodeWidth = 240;
    const nodeHeight = 74;
    const colSpacing = 360;
    const rowSpacing = 110;
    const paddingX = 40;
    const paddingY = 50;

    const posMap = {};

    levelKeys.forEach((lvl) => {
      const nodesAtLevel = levelNodesMap[lvl];
      nodesAtLevel.forEach((node, idx) => {
        posMap[node.id] = {
          x: paddingX + lvl * colSpacing,
          y: paddingY + idx * rowSpacing,
          node: node,
        };
      });
    });

    // Outer Map Wrapper
    const mapWrapper = document.createElement("div");
    mapWrapper.style.cssText = "position: relative; width: 100%; height: 100%; overflow: hidden; background: #f8fafc; user-select: none; border-radius: 6px;";

    // Toolbar Controls
    const toolbar = document.createElement("div");
    toolbar.style.cssText = "position: absolute; top: 10px; right: 10px; z-index: 10; display: flex; gap: 6px; background: rgba(255,255,255,0.95); padding: 4px 6px; border-radius: 6px; box-shadow: 0 2px 8px rgba(0,0,0,0.12); border: 1px solid #e2e8f0;";
    toolbar.innerHTML = `
      <button id="cmd-zoom-in" class="ui mini icon button" title="Zoom In"><i class="plus icon"></i></button>
      <button id="cmd-zoom-out" class="ui mini icon button" title="Zoom Out"><i class="minus icon"></i></button>
      <button id="cmd-zoom-reset" class="ui mini icon button" title="Reset View"><i class="expand icon"></i></button>
    `;
    mapWrapper.appendChild(toolbar);

    // SVG Canvas Element
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.style.cursor = "grab";

    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    defs.innerHTML = `
      <marker id="cmd-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#0284c7"/>
      </marker>
    `;
    svg.appendChild(defs);

    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    svg.appendChild(g);
    mapWrapper.appendChild(svg);
    container.appendChild(mapWrapper);

    // Pan & Zoom State
    let scale = 1;
    let pointX = 0;
    let pointY = 0;
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
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      scale = Math.min(Math.max(0.4, scale + delta), 2.5);
      setTransform();
    };

    toolbar.querySelector("#cmd-zoom-in").onclick = () => { scale = Math.min(scale + 0.15, 2.5); setTransform(); };
    toolbar.querySelector("#cmd-zoom-out").onclick = () => { scale = Math.max(scale - 0.15, 0.4); setTransform(); };
    toolbar.querySelector("#cmd-zoom-reset").onclick = () => { scale = 1; pointX = 0; pointY = 0; setTransform(); };

    // 1. Draw Connecting Directional Bézier Curves with ProcessDirect Endpoint Labels
    edges.forEach((edge) => {
      const fromPos = posMap[edge.from];
      const toPos = posMap[edge.to];
      if (fromPos && toPos) {
        const x1 = fromPos.x + nodeWidth;
        const y1 = fromPos.y + nodeHeight / 2;
        const x2 = toPos.x;
        const y2 = toPos.y + nodeHeight / 2;
        const midX = (x1 + x2) / 2;
        const midY = (y1 + y2) / 2;

        // Path
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`);
        path.setAttribute("fill", "none");
        path.setAttribute("stroke", "#0284c7");
        path.setAttribute("stroke-width", "2.5");
        path.setAttribute("marker-end", "url(#cmd-arrow)");
        g.appendChild(path);

        // ProcessDirect Endpoint Label Pill
        if (edge.address) {
          let labelText = edge.address;
          if (labelText.length > 24) labelText = labelText.substring(0, 22) + "..";

          const edgeG = document.createElementNS("http://www.w3.org/2000/svg", "g");
          const pillWidth = Math.max(60, labelText.length * 7 + 16);
          const pillHeight = 20;

          edgeG.innerHTML = `
            <rect x="${midX - pillWidth / 2}" y="${midY - pillHeight / 2}" width="${pillWidth}" height="${pillHeight}" rx="10"
                  fill="#ffffff" stroke="#0284c7" stroke-width="1.2" filter="drop-shadow(0 1px 2px rgba(0,0,0,0.1))"/>
            <text x="${midX}" y="${midY + 4}" text-anchor="middle" font-size="10px" font-weight="600" fill="#0369a1">
              ${escapeHtml(labelText)}
            </text>
          `;
          g.appendChild(edgeG);
        }
      }
    });



    // 3. Draw Nodes
    Object.values(posMap).forEach((pos) => {
      const node = pos.node;
      const flowId = node.id;
      const logs = logsByFlowId[flowId] || [];
      const hasRuns = logs.length > 0;
      const latestLog = hasRuns ? logs[0] : null;
      const isSelected = selectedNodeId && selectedNodeId === flowId;
      const isRoot = node.level === 0;

      // Status determination
      let status = hasRuns ? (latestLog.Status || "COMPLETED") : "NO RUNS";
      let statusColor = "#94a3b8"; // Gray for no runs
      if (status === "COMPLETED") statusColor = "#10b981";
      else if (status === "FAILED") statusColor = "#ef4444";
      else if (status === "PROCESSING") statusColor = "#3b82f6";
      else if (status.match(/^(RETRY|ESCALATED|CANCELLED)$/)) statusColor = "#f59e0b";

      let rawName = flowId;
      if (rawName.length > 24) rawName = rawName.substring(0, 22) + "..";
      const displayName = escapeHtml(rawName);

      const nodeG = document.createElementNS("http://www.w3.org/2000/svg", "g");
      nodeG.setAttribute("class", "cmd-node-group");
      nodeG.style.cursor = "pointer";

      // Multi-run badge pill if logs.length > 1 (e.g. Iterator/Splitter call)
      const multiRunBadge = logs.length > 1
        ? `<rect x="${pos.x + nodeWidth - 62}" y="${pos.y + 6}" width="54" height="18" rx="9" fill="#fef3c7" stroke="#f59e0b" stroke-width="1"/>
           <text x="${pos.x + nodeWidth - 35}" y="${pos.y + 19}" text-anchor="middle" font-size="10px" font-weight="bold" fill="#b45309">${logs.length} runs</text>`
        : (isRoot
            ? `<rect x="${pos.x + nodeWidth - 52}" y="${pos.y + 6}" width="44" height="18" rx="9" fill="#e0f2fe" stroke="#0284c7" stroke-width="1"/>
               <text x="${pos.x + nodeWidth - 30}" y="${pos.y + 19}" text-anchor="middle" font-size="10px" font-weight="bold" fill="#0369a1">ROOT</text>`
            : "");

      nodeG.innerHTML = `
        <rect x="${pos.x}" y="${pos.y}" width="${nodeWidth}" height="${nodeHeight}" rx="8"
              fill="${isSelected ? "#f0fdf4" : "#ffffff"}"
              stroke="${isSelected ? "#10b981" : isRoot ? "#0284c7" : "#cbd5e1"}"
              stroke-width="${isSelected ? "3" : isRoot ? "2" : "1.5"}"
              filter="drop-shadow(0 2px 5px rgba(0,0,0,0.06))" />
        <rect x="${pos.x}" y="${pos.y}" width="6" height="${nodeHeight}" rx="3" fill="${statusColor}" />
        <text x="${pos.x + 16}" y="${pos.y + 24}" font-size="13px" font-weight="bold" fill="#1e293b">
          ${displayName}
        </text>
        <text x="${pos.x + 16}" y="${pos.y + 46}" font-size="11px" fill="#64748b">
          Status: <tspan font-weight="bold" fill="${statusColor}">${escapeHtml(status)}</tspan> ${hasRuns ? `| Lvl: ${escapeHtml(latestLog.LogLevel || "INFO")}` : ""}
        </text>
        ${multiRunBadge}
      `;

      nodeG.onclick = (e) => {
        e.stopPropagation();
        if (onSelectNode) onSelectNode(flowId, logs);
      };

      g.appendChild(nodeG);
    });

    setTransform();
  },

  /**
   * Backward-compatible call-tree renderer.
   */
  renderSvgColumnMap(container, logs, selectedLog, onSelectLog) {
    const rootLog = logs && logs.length > 0 ? logs[0] : null;
    const rootName = rootLog?.IntegrationFlowName || rootLog?.IntegrationArtifact?.Id || "Root";

    const topologyData = {
      nodes: (logs || []).map((l, i) => ({
        id: l.IntegrationFlowName || l.IntegrationArtifact?.Id || `Flow_${i}`,
        level: i === 0 ? 0 : 1,
      })),
      edges: (logs || []).slice(1).map((l) => ({
        from: rootName,
        to: l.IntegrationFlowName || l.IntegrationArtifact?.Id || "",
        address: "ProcessDirect",
      })),
    };

    const logsByFlowId = {};
    (logs || []).forEach((l) => {
      const id = l.IntegrationFlowName || l.IntegrationArtifact?.Id || "iFlow";
      if (!logsByFlowId[id]) logsByFlowId[id] = [];
      logsByFlowId[id].push(l);
    });

    this.renderDirectionalTopology(
      container,
      topologyData,
      logsByFlowId,
      selectedLog?.IntegrationFlowName || selectedLog?.IntegrationArtifact?.Id,
      (nodeId, logsForNode) => {
        if (onSelectLog && logsForNode.length > 0) onSelectLog(logsForNode[0]);
      }
    );
  },
};

// Expose to window namespace
if (typeof window !== "undefined") {
  window.CmdTopologyGraph = CmdTopologyGraph;
}
