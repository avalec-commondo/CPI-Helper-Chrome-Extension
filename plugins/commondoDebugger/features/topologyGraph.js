// ===========================================================================
// COMMODNO IS DEBUGGER - TOPOLOGY GRAPH FEATURE
// ===========================================================================
// Renders the interactive SVG Multi-Column Execution Map with
// Pan/Zoom matrix canvas, status-coded flow nodes, and cubic Bézier curves.

const CmdTopologyGraph = {
  /**
   * Compute the precise execution window for a flow using its RunSteps.
   */
  getFlowInterval(log) {
    const parseMs = (typeof CmdCpiApiHelper !== "undefined" && CmdCpiApiHelper.parseMs) ? CmdCpiApiHelper.parseMs : (ts) => (typeof ts === "number" ? ts : new Date(ts).getTime() || 0);
    let start = parseMs(log.LogStart);
    let end = parseMs(log.LogEnd) || start;

    if (log.__steps && log.__steps.length > 0) {
      const starts = log.__steps.map((s) => parseMs(s.StepStart)).filter((v) => v > 0);
      const stops = log.__steps.map((s) => parseMs(s.StepStop)).filter((v) => v > 0);
      if (starts.length > 0) start = Math.min(start, ...starts);
      if (stops.length > 0) end = Math.max(end, ...stops);
    }

    return { start, end, duration: Math.max(0, end - start) };
  },

  /**
   * Build the call tree using strict interval containment + balanced assignment.
   */
  buildCallTree(logs) {
    if (!logs || logs.length === 0) return { edges: [], levels: {} };
    if (logs.length === 1) return { edges: [], levels: { [logs[0].MessageGuid]: 0 } };

    const intervals = new Map();
    logs.forEach((log) => intervals.set(log.MessageGuid, CmdTopologyGraph.getFlowInterval(log)));

    const sorted = [...logs].sort((a, b) => {
      const ivA = intervals.get(a.MessageGuid);
      const ivB = intervals.get(b.MessageGuid);
      if (ivA.start !== ivB.start) return ivA.start - ivB.start;
      return ivB.duration - ivA.duration;
    });

    const root = sorted[0];
    const validParentsOf = new Map();

    for (const flow of sorted) {
      if (flow.MessageGuid === root.MessageGuid) continue;
      const flowIv = intervals.get(flow.MessageGuid);
      const parents = [];

      for (const candidate of sorted) {
        if (candidate.MessageGuid === flow.MessageGuid) continue;
        const candIv = intervals.get(candidate.MessageGuid);

        if (candIv.start < flowIv.start && candIv.end > flowIv.end && candIv.duration > flowIv.duration) {
          parents.push({ guid: candidate.MessageGuid, duration: candIv.duration });
        }
      }

      parents.sort((a, b) => a.duration - b.duration);
      validParentsOf.set(flow.MessageGuid, parents);
    }

    const children = sorted.filter((l) => l.MessageGuid !== root.MessageGuid);
    children.sort((a, b) => {
      const aParents = validParentsOf.get(a.MessageGuid) || [];
      const bParents = validParentsOf.get(b.MessageGuid) || [];
      return aParents.length - bParents.length;
    });

    const childCount = new Map();
    sorted.forEach((l) => childCount.set(l.MessageGuid, 0));

    const edges = [];
    const assigned = new Set();

    for (const child of children) {
      const parents = validParentsOf.get(child.MessageGuid) || [];
      if (parents.length === 0) continue;

      let bestParent = null;
      let bestChildCount = Infinity;
      let bestDuration = Infinity;

      for (const p of parents) {
        const cc = childCount.get(p.guid) || 0;
        if (cc < bestChildCount || (cc === bestChildCount && p.duration < bestDuration)) {
          bestChildCount = cc;
          bestDuration = p.duration;
          bestParent = p.guid;
        }
      }

      if (bestParent) {
        edges.push({ from: bestParent, to: child.MessageGuid });
        childCount.set(bestParent, (childCount.get(bestParent) || 0) + 1);
        assigned.add(child.MessageGuid);
      }
    }

    for (const child of children) {
      if (!assigned.has(child.MessageGuid)) {
        edges.push({ from: root.MessageGuid, to: child.MessageGuid });
      }
    }

    const childrenOf = {};
    sorted.forEach((l) => (childrenOf[l.MessageGuid] = []));
    edges.forEach((e) => {
      if (childrenOf[e.from]) childrenOf[e.from].push(e.to);
    });

    const levels = {};
    levels[root.MessageGuid] = 0;
    const queue = [root.MessageGuid];
    while (queue.length > 0) {
      const curr = queue.shift();
      const currLevel = levels[curr] || 0;
      (childrenOf[curr] || []).forEach((childId) => {
        if (levels[childId] === undefined) {
          levels[childId] = currLevel + 1;
          queue.push(childId);
        }
      });
    }

    sorted.forEach((l) => {
      if (levels[l.MessageGuid] === undefined) levels[l.MessageGuid] = 1;
    });

    return { edges, levels };
  },

  /**
   * Renders the interactive SVG Multi-Column Topology Map.
   */
  renderSvgColumnMap(container, logs, selectedLog, onSelectLog) {
    if (!container || !logs || logs.length === 0) {
      if (container) container.innerHTML = `<div style="text-align: center; color: #888; margin-top: 150px;">No execution logs found to display.</div>`;
      return;
    }

    container.innerHTML = "";

    const payloadHelper = typeof CmdTracePayloadHelper !== "undefined" ? CmdTracePayloadHelper : {};
    const escapeHtml = payloadHelper.escapeHtml || ((s) => s || "");

    const { edges, levels } = CmdTopologyGraph.buildCallTree(logs);

    logs.forEach((l) => {
      if (levels[l.MessageGuid] === undefined) levels[l.MessageGuid] = 0;
    });

    // Group logs into columns by Level
    const levelNodesMap = {};
    logs.forEach((log) => {
      const lvl = levels[log.MessageGuid] || 0;
      if (!levelNodesMap[lvl]) levelNodesMap[lvl] = [];
      levelNodesMap[lvl].push(log);
    });

    const levelKeys = Object.keys(levelNodesMap).map(Number).sort((a, b) => a - b);
    if (levelKeys.length === 0) levelKeys.push(0);

    const nodeWidth = 240;
    const nodeHeight = 62;
    const colSpacing = 340;
    const rowSpacing = 85;
    const paddingX = 40;
    const paddingY = 40;

    const posMap = {};

    levelKeys.forEach((lvl) => {
      const nodesAtLevel = levelNodesMap[lvl];
      if (lvl > 0) {
        nodesAtLevel.sort((a, b) => {
          const parentA = edges.find((e) => e.to === a.MessageGuid)?.from || "";
          const parentB = edges.find((e) => e.to === b.MessageGuid)?.from || "";
          const pIndexA = logs.findIndex((l) => l.MessageGuid === parentA);
          const pIndexB = logs.findIndex((l) => l.MessageGuid === parentB);
          return pIndexA - pIndexB;
        });
      }

      nodesAtLevel.forEach((node, idx) => {
        posMap[node.MessageGuid] = {
          x: paddingX + lvl * colSpacing,
          y: paddingY + idx * rowSpacing,
          log: node,
        };
      });
    });

    // Outer Map Wrapper
    const mapWrapper = document.createElement("div");
    mapWrapper.style.cssText = "position: relative; width: 100%; height: 100%; overflow: hidden; background: #f8fafc; user-select: none; border-radius: 6px;";

    // Toolbar Controls
    const toolbar = document.createElement("div");
    toolbar.style.cssText = "position: absolute; top: 10px; right: 10px; z-index: 10; display: flex; gap: 6px; background: rgba(255,255,255,0.9); padding: 4px; border-radius: 6px; box-shadow: 0 2px 8px rgba(0,0,0,0.12);";
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
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#0070f3"/>
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

    // Draw Connecting Bézier Curves
    edges.forEach((edge) => {
      const fromPos = posMap[edge.from];
      const toPos = posMap[edge.to];
      if (fromPos && toPos) {
        const x1 = fromPos.x + nodeWidth;
        const y1 = fromPos.y + nodeHeight / 2;
        const x2 = toPos.x;
        const y2 = toPos.y + nodeHeight / 2;
        const midX = (x1 + x2) / 2;

        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`);
        path.setAttribute("fill", "none");
        path.setAttribute("stroke", "#0070f3");
        path.setAttribute("stroke-width", "2.5");
        path.setAttribute("marker-end", "url(#cmd-arrow)");
        g.appendChild(path);
      }
    });

    // Draw Column Headers
    levelKeys.forEach((lvl, colIdx) => {
      const colX = paddingX + colIdx * colSpacing;
      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("x", colX + 10);
      text.setAttribute("y", paddingY - 15);
      text.setAttribute("fill", "#64748b");
      text.setAttribute("font-size", "12px");
      text.setAttribute("font-weight", "bold");
      text.textContent = `LEVEL ${lvl} ${lvl === 0 ? "(Root Trigger)" : `(Subflow L${lvl})`}`;
      g.appendChild(text);
    });

    // Draw Nodes
    const rootLog = logs[0];
    Object.values(posMap).forEach((pos) => {
      const log = pos.log;
      const isSelected = selectedLog && (selectedLog.MessageGuid === log.MessageGuid);
      const isRoot = log.MessageGuid === rootLog.MessageGuid;
      const status = log.Status || "COMPLETED";

      let statusColor = "#10b981"; // COMPLETED
      if (status === "FAILED") statusColor = "#ef4444";
      else if (status === "PROCESSING") statusColor = "#3b82f6";
      else if (status.match(/^(RETRY|ESCALATED|CANCELLED)$/)) statusColor = "#f59e0b";

      let rawName = log.IntegrationFlowName || log.IntegrationArtifact?.Id || "iFlow";
      if (rawName.length > 28) rawName = rawName.substring(0, 26) + "..";
      const displayName = escapeHtml(rawName);

      const nodeG = document.createElementNS("http://www.w3.org/2000/svg", "g");
      nodeG.setAttribute("class", "cmd-node-group");
      nodeG.style.cursor = "pointer";

      nodeG.innerHTML = `
        <rect x="${pos.x}" y="${pos.y}" width="${nodeWidth}" height="${nodeHeight}" rx="8"
              fill="${isSelected ? "#eff6ff" : "#ffffff"}"
              stroke="${isSelected ? "#0070f3" : isRoot ? "#3b82f6" : "#cbd5e1"}"
              stroke-width="${isSelected ? "3" : isRoot ? "2" : "1.5"}"
              filter="drop-shadow(0 2px 4px rgba(0,0,0,0.06))" />
        <rect x="${pos.x}" y="${pos.y}" width="6" height="${nodeHeight}" rx="3" fill="${statusColor}" />
        <text x="${pos.x + 16}" y="${pos.y + 24}" font-size="13px" font-weight="bold" fill="#1e293b">
          ${displayName}
        </text>
        <text x="${pos.x + 16}" y="${pos.y + 44}" font-size="11px" fill="#64748b">
          Status: <tspan font-weight="bold" fill="${statusColor}">${escapeHtml(status)}</tspan> | Lvl: ${escapeHtml(log.LogLevel || "INFO")}
        </text>
      `;

      nodeG.onclick = (e) => {
        e.stopPropagation();
        if (onSelectLog) onSelectLog(log);
      };

      g.appendChild(nodeG);
    });

    setTransform();
  },
};

// Expose to window namespace
if (typeof window !== "undefined") {
  window.CmdTopologyGraph = CmdTopologyGraph;
}

