// ===========================================================================
// COMMNDO IS DEBUGGER - TRACE MANAGER MODAL (CmdTraceManagerModal)
// ===========================================================================
// Exact 1:1 legacy visual design and multi-flow selection manager.
// Pure UI component: delegates all domain logic to CmdTraceService and CmdApiClient.

const CmdTraceManagerModal = {
  /**
   * Opens the compact fixed-size Multi-Select Trace Manager modal dialog.
   */
  async open() {
    const api = typeof CmdApiClient !== "undefined" ? CmdApiClient : {};
    const utils = typeof CmdUtils !== "undefined" ? CmdUtils : {};
    const escapeHtml = utils.escapeHtml || ((s) => s || "");

    const activeIFlow = (typeof cpiData !== "undefined" && cpiData.integrationFlowId) ? cpiData.integrationFlowId : "";
    let packageId = (typeof cpiData !== "undefined" && cpiData.currentPackageId) ? cpiData.currentPackageId : "";
    if (!packageId && api.resolveCurrentPackageId) {
      packageId = await api.resolveCurrentPackageId(activeIFlow);
    }

    // Remove existing overlay if present
    const oldOverlay = document.getElementById("__cmd_trace_modal_overlay");
    if (oldOverlay) oldOverlay.remove();

    const modalContainer = document.createElement("div");
    modalContainer.id = "commondo-trace-manager-modal";
    modalContainer.style.cssText = "padding: 18px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; width: 100%; box-sizing: border-box;";

    modalContainer.innerHTML = `
      <div style="border-bottom: 2px solid #0070f3; padding-bottom: 8px; margin-bottom: 14px; display: flex; justify-content: space-between; align-items: center;">
        <div>
          <h2 style="margin: 0; color: #1a1a1a; font-size: 1.3rem;">Trace Manager</h2>
          <p style="margin: 3px 0 0 0; color: #666; font-size: 0.85rem;">
            Select package integration flows to activate or deactivate TRACE logging in batch.
          </p>
        </div>
        <span class="cmd-trace-mgr-close" style="cursor: pointer; font-size: 1.5rem; font-weight: bold; color: #64748b; line-height: 1; padding: 0 4px;" title="Close">&times;</span>
      </div>

      <!-- Filter & Search Controls -->
      <div style="display: flex; gap: 10px; margin-bottom: 12px; align-items: center;">
        <input type="text" id="cmd-trace-search" placeholder="Search flows in package..." style="flex: 1; padding: 6px 10px; border: 1px solid #ccc; border-radius: 4px; font-size: 0.85rem;" />
        ${packageId ? `<span style="font-size: 0.8rem; color: #475569; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 4px; padding: 5px 10px; white-space: nowrap; font-weight: 500;">Package: <b>${escapeHtml(packageId)}</b></span>` : ""}
      </div>

      <!-- Quick Selection Buttons -->
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        <div style="display: flex; gap: 6px;">
          <button id="cmd-btn-sel-all" class="ui mini button" style="cursor: pointer;">Select All</button>
          <button id="cmd-btn-sel-none" class="ui mini button" style="cursor: pointer;">Deselect All</button>
          <button id="cmd-btn-sel-current" class="ui mini button" style="cursor: pointer;">Current Flow Only</button>
        </div>
        <span id="cmd-selected-count" style="font-size: 0.85rem; font-weight: bold; color: #0070f3;">0 flows selected</span>
      </div>

      <!-- Flow List Container: Fixed height, only this element scrolls -->
      <div id="cmd-flows-list" style="border: 1px solid #ddd; border-radius: 6px; background: #fafafa; height: 280px; max-height: 280px; overflow-y: auto; padding: 6px 10px; margin-bottom: 14px;">
        <div style="text-align: center; color: #888; padding: 30px;">Loading package integration flows...</div>
      </div>

      <!-- Action Buttons -->
      <div style="display: flex; justify-content: flex-end; gap: 10px; border-top: 1px solid #eee; padding-top: 12px;">
        <button id="cmd-btn-deactivate-trace" class="ui mini button" style="color: #666; cursor: pointer;">
          Set Selected to INFO (Turn OFF)
        </button>
        <button id="cmd-btn-activate-trace" class="ui mini primary button" style="font-weight: bold; cursor: pointer; background-color: #0070f3; color: #fff;">
          Turn ON TRACE for Selected
        </button>
      </div>
    `;

    // Render Modal Overlay
    const overlay = document.createElement("div");
    overlay.id = "__cmd_trace_modal_overlay";
    overlay.style.cssText = "position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 10000; display: flex; align-items: center; justify-content: center;";

    const box = document.createElement("div");
    box.style.cssText = "background: #fff; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.3); position: relative; width: 700px; max-width: 92vw; overflow: hidden; display: flex; flex-direction: column;";
    box.appendChild(modalContainer);
    overlay.appendChild(box);
    body().appendChild(overlay);

    const closeModal = () => overlay.remove();

    overlay.onclick = (e) => {
      if (e.target === overlay) closeModal();
    };

    modalContainer.querySelector(".cmd-trace-mgr-close").onclick = closeModal;

    // Populate data
    await this.loadFlowsIntoManager(activeIFlow, packageId, closeModal);
  },

  /**
   * Loads artifacts and manages selection inside Trace Manager modal.
   */
  async loadFlowsIntoManager(activeIFlow, packageId, closeModal) {
    const api = typeof CmdApiClient !== "undefined" ? CmdApiClient : {};
    const utils = typeof CmdUtils !== "undefined" ? CmdUtils : {};
    const traceService = typeof CmdTraceService !== "undefined" ? CmdTraceService : {};
    const escapeHtml = utils.escapeHtml || ((s) => s || "");

    const listDiv = document.getElementById("cmd-flows-list");
    const countSpan = document.getElementById("cmd-selected-count");
    const searchInput = document.getElementById("cmd-trace-search");
    if (!listDiv) return;

    let targetPkgId = packageId;
    if (!targetPkgId && activeIFlow && api.resolveCurrentPackageId) {
      targetPkgId = await api.resolveCurrentPackageId(activeIFlow);
    }

    const [packageArtifacts, activeTraceFlows] = await Promise.all([
      targetPkgId && api.fetchPackageArtifacts ? api.fetchPackageArtifacts(targetPkgId) : [],
      traceService.getActiveTracedFlowsFromStorage ? traceService.getActiveTracedFlowsFromStorage() : new Set(),
    ]);

    // Filter candidate flow IDs in this package (only IFlows, skipping Script Collections, Mappings, etc.)
    const iflowList = (packageArtifacts || []).filter((a) => {
      const t = String(a.type || "").toLowerCase();
      const isPureHex = /^[0-9a-f]{32}$/i.test(a.id);
      if (isPureHex) return false;
      return t.includes("iflow") || t.includes("integration") || (!t && !isPureHex);
    });

    if (iflowList.length === 0 && activeIFlow) {
      iflowList.push({ id: activeIFlow, name: activeIFlow, type: "IFlow" });
    }

    // Load saved preferences
    let savedChecked = new Set();
    const storageKey = `__cmd_trace_checked_${activeIFlow || targetPkgId || "default"}`;
    if (utils.storageGet) {
      const stored = await utils.storageGet(storageKey);
      if (Array.isArray(stored)) {
        savedChecked = new Set(stored);
      }
    }

    // Default selection: Active flow if no prior selection
    if (savedChecked.size === 0 && activeIFlow) {
      savedChecked.add(activeIFlow);
    }

    function renderList() {
      const searchTerm = (searchInput.value || "").trim().toLowerCase();
      const filtered = iflowList.filter((a) => {
        if (searchTerm) {
          return a.id.toLowerCase().includes(searchTerm) || a.name.toLowerCase().includes(searchTerm);
        }
        return true;
      });

      // Sort: Current iFlow on top, rest sorted alphabetically by name
      filtered.sort((a, b) => {
        const isCurrentA = a.id === activeIFlow;
        const isCurrentB = b.id === activeIFlow;
        if (isCurrentA && !isCurrentB) return -1;
        if (!isCurrentA && isCurrentB) return 1;
        return (a.name || a.id || "").localeCompare(b.name || b.id || "", undefined, { sensitivity: "base" });
      });

      if (filtered.length === 0) {
        listDiv.innerHTML = `<div style="text-align: center; color: #888; padding: 20px;">No integration flows found matching filter.</div>`;
        updateCount();
        return;
      }

      let html = "";
      filtered.forEach((art) => {
        const isChecked = savedChecked.has(art.id);
        const isCurrent = art.id === activeIFlow;
        const normId = utils.normalizeFlowId ? utils.normalizeFlowId(art.id) : "";
        const normName = utils.normalizeFlowId ? utils.normalizeFlowId(art.name) : "";
        const isTraceActive =
          activeTraceFlows.has(art.id) ||
          activeTraceFlows.has(art.name) ||
          activeTraceFlows.has(art.id.toLowerCase()) ||
          (art.name && activeTraceFlows.has(art.name.toLowerCase())) ||
          (normId && activeTraceFlows.has(normId)) ||
          (normName && activeTraceFlows.has(normName));

        html += `
          <label style="display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-bottom: 1px solid #eee; cursor: pointer; background: ${isChecked ? "#eaf2fd" : "#fff"}; border-radius: 4px; margin-bottom: 2px;">
            <input type="checkbox" class="cmd-flow-checkbox" data-iflow-id="${escapeHtml(art.id)}" ${isChecked ? "checked" : ""} style="cursor: pointer;" />
            <div style="flex: 1; font-size: 0.85rem; display: flex; align-items: center; justify-content: space-between; gap: 8px;">
              <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                <b style="color: ${isCurrent ? "#0070f3" : "#333"};">${escapeHtml(art.name)}</b>
                ${art.name !== art.id ? `<span style="color: #777; font-size: 0.75rem;">(${escapeHtml(art.id)})</span>` : ""}
                ${isCurrent ? `<span style="background: #0070f3; color: #fff; font-size: 0.7rem; padding: 1px 5px; border-radius: 3px;">Current</span>` : ""}
              </div>
              <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
                ${isTraceActive ? `
                  <span title="TRACE is active on this flow" style="display: inline-flex; align-items: center; gap: 4px; background: #ecfdf5; border: 1px solid #10b981; border-radius: 10px; padding: 2px 7px; font-size: 0.72rem; font-weight: bold; color: #065f46; white-space: nowrap;">
                    <span style="display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #10b981; box-shadow: 0 0 4px #10b981;"></span> TRACE
                  </span>
                ` : ""}
                <button class="cmd-row-btn cmd-row-deploy" data-iflow-id="${escapeHtml(art.id)}" data-iflow-name="${escapeHtml(art.name)}" title="Deploy this flow to runtime" style="padding: 2px 8px; font-size: 0.72rem; font-weight: 600; border-radius: 4px; border: 1px solid #0070f3; background: #ffffff; color: #0070f3; cursor: pointer;">
                  Deploy
                </button>
              </div>
            </div>
          </label>
        `;
      });

      listDiv.innerHTML = html;

      listDiv.querySelectorAll(".cmd-flow-checkbox").forEach((cb) => {
        cb.onchange = () => {
          const id = cb.getAttribute("data-iflow-id");
          if (cb.checked) {
            savedChecked.add(id);
            cb.closest("label").style.backgroundColor = "#eaf2fd";
          } else {
            savedChecked.delete(id);
            cb.closest("label").style.backgroundColor = "#fff";
          }
          updateCount();
        };
      });

      listDiv.querySelectorAll(".cmd-row-deploy").forEach((btn) => {
        btn.onclick = async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const id = btn.getAttribute("data-iflow-id");
          const name = btn.getAttribute("data-iflow-name") || id;
          btn.innerText = "Deploying...";
          btn.disabled = true;
          try {
            if (traceService.deployFlow) {
              await traceService.deployFlow(id, name);
            }
          } finally {
            btn.innerText = "Deploy";
            btn.disabled = false;
          }
        };
      });

      updateCount();
    }

    function updateCount() {
      if (countSpan) {
        countSpan.innerText = `${savedChecked.size} flow(s) selected`;
      }
    }

    searchInput.oninput = renderList;

    const selAllBtn = document.getElementById("cmd-btn-sel-all");
    const selNoneBtn = document.getElementById("cmd-btn-sel-none");
    const selCurBtn = document.getElementById("cmd-btn-sel-current");

    if (selAllBtn) {
      selAllBtn.onclick = () => {
        listDiv.querySelectorAll(".cmd-flow-checkbox").forEach((cb) => {
          const id = cb.getAttribute("data-iflow-id");
          savedChecked.add(id);
          cb.checked = true;
          cb.closest("label").style.backgroundColor = "#eaf2fd";
        });
        updateCount();
      };
    }

    if (selNoneBtn) {
      selNoneBtn.onclick = () => {
        savedChecked.clear();
        listDiv.querySelectorAll(".cmd-flow-checkbox").forEach((cb) => {
          cb.checked = false;
          cb.closest("label").style.backgroundColor = "#fff";
        });
        updateCount();
      };
    }

    if (selCurBtn) {
      selCurBtn.onclick = () => {
        savedChecked.clear();
        if (activeIFlow) savedChecked.add(activeIFlow);
        listDiv.querySelectorAll(".cmd-flow-checkbox").forEach((cb) => {
          const id = cb.getAttribute("data-iflow-id");
          cb.checked = id === activeIFlow;
          cb.closest("label").style.backgroundColor = cb.checked ? "#eaf2fd" : "#fff";
        });
        updateCount();
      };
    }

    // Turn ON TRACE
    const actBtn = document.getElementById("cmd-btn-activate-trace");
    if (actBtn) {
      actBtn.onclick = async () => {
        const selectedIds = Array.from(savedChecked);
        if (selectedIds.length === 0) {
          if (typeof showToast === "function") {
            showToast("Trace Manager", "Please select at least one integration flow.", "warning");
          }
          return;
        }

        if (utils.storageSet) {
          await utils.storageSet(storageKey, selectedIds);
        }

        actBtn.innerText = "Activating TRACE...";
        actBtn.disabled = true;

        if (traceService.executeBatchLogLevel) {
          await traceService.executeBatchLogLevel(selectedIds, "TRACE");
        }

        actBtn.innerText = "Turn ON TRACE for Selected";
        actBtn.disabled = false;

        closeModal();
      };
    }

    // Turn OFF TRACE (Set to INFO)
    const deactBtn = document.getElementById("cmd-btn-deactivate-trace");
    if (deactBtn) {
      deactBtn.onclick = async () => {
        const selectedIds = Array.from(savedChecked);
        if (selectedIds.length === 0) {
          if (typeof showToast === "function") {
            showToast("Trace Manager", "Please select at least one integration flow.", "warning");
          }
          return;
        }

        deactBtn.innerText = "Setting to INFO...";
        deactBtn.disabled = true;

        if (traceService.executeBatchLogLevel) {
          await traceService.executeBatchLogLevel(selectedIds, "INFO");
        }

        deactBtn.innerText = "Set Selected to INFO (Turn OFF)";
        deactBtn.disabled = false;

        closeModal();
      };
    }

    renderList();
  },
};

// Expose globally
if (typeof window !== "undefined") {
  window.CmdTraceManagerModal = CmdTraceManagerModal;
  window.CmdTraceManager = CmdTraceManagerModal;
  window.openTraceManagerModal = () => CmdTraceManagerModal.open();
}
if (typeof global !== "undefined") {
  global.CmdTraceManagerModal = CmdTraceManagerModal;
  global.CmdTraceManager = CmdTraceManagerModal;
}
