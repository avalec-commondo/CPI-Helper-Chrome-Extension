// ===========================================================================
// COMMODNO IS DEBUGGER - TRACE MANAGER FEATURE
// ===========================================================================
// Manages multi-level flow selection, interactive Trace Manager modal dialog,
// bulk TRACE / INFO log level activation, and keep-alive state synchronization.

const CmdTraceManager = {
  /**
   * Sets the log level for a specific iFlow and synchronizes CPI-Helper keep-alive state.
   */
  async setIFlowLogLevel(iflowId, logLevel = "TRACE") {
    if (!iflowId) return false;

    try {
      let ok = false;

      // 1. Primary: CPI Helper's native setLogLevel
      if (typeof setLogLevel === "function") {
        try {
          await setLogLevel(logLevel, iflowId);
          ok = true;
        } catch (e) {
          console.warn(`Native setLogLevel failed for ${iflowId}:`, e);
        }
      }

      // 2. Fallback: Direct command invocation
      if (!ok) {
        const isNeo = (typeof cpiData !== "undefined" && cpiData.cpiPlatform === "neo") || window.location.host.includes("hana.ondemand.com");
        const selectedLoc = typeof cpiData !== "undefined" && cpiData.runtimeLocationId && !isNeo ? cpiData.runtimeLocationId : "";
        const locClause = selectedLoc ? `, "runtimeLocationId":"${selectedLoc}"` : "";
        const urlExt = typeof cpiData !== "undefined" && cpiData.urlExtension ? cpiData.urlExtension : "";
        const cmdUrl = `/${urlExt}Operations/com.sap.it.op.tmn.commands.dashboard.webui.IntegrationComponentSetMplLogLevelCommand`;
        const payload = `{"artifactSymbolicName":"${iflowId}","mplLogLevel":"${logLevel}","nodeType":"IFLMAP"${locClause}}`;

        const rawRes = await makeCallPromise("POST", cmdUrl, false, null, payload, true, "application/json;charset=UTF-8");
        if (rawRes) ok = true;
      }

      // 3. Synchronize storage keep-alive state for CPI-Helper background heartbeat
      if (ok) {
        const currentLocId = (typeof cpiData !== "undefined" && cpiData.runtimeLocationId) ? cpiData.runtimeLocationId : "cloudintegration";
        const val = logLevel === "TRACE" ? Date.now().toString() : null;

        const keysObj = {
          [`${iflowId}_powertraceLastRefresh`]: val,
          [`${iflowId}_${currentLocId}_powertraceLastRefresh`]: val,
          [`${iflowId}_cloudintegration_powertraceLastRefresh`]: val,
        };

        if (typeof storageSetPromise === "function") {
          await storageSetPromise(keysObj);
        } else if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set(keysObj);
        }

        // Update UI styling if this is the active flow on screen
        const activeFlow = (typeof cpiData !== "undefined" && cpiData.integrationFlowId) ? cpiData.integrationFlowId : "";
        if (iflowId === activeFlow) {
          const stdBtn = document.querySelector(".cpiHelper_traceButton, [id*='traceButton'], #button134345-BDI-content");
          const timerBadge = document.getElementById("__commondo_header_trace_timer");
          if (logLevel === "TRACE") {
            if (stdBtn && !stdBtn.classList.contains("cpiHelper_powertrace")) stdBtn.classList.add("cpiHelper_powertrace");
          } else {
            if (stdBtn) stdBtn.classList.remove("cpiHelper_powertrace");
            if (timerBadge) timerBadge.style.display = "none";
          }
        }
      }

      return ok;
    } catch (e) {
      console.warn(`Failed setting log level for ${iflowId}:`, e);
      return false;
    }
  },

  /**
   * Bulk activates log level across an array of flow IDs.
   */
  async executeBatchLogLevel(idsArray, logLevel = "TRACE") {
    console.log(`[Trace Manager] Setting LogLevel "${logLevel}" on ${idsArray.length} flow(s)...`, idsArray);

    const results = await Promise.allSettled(idsArray.map((id) => this.setIFlowLogLevel(id, logLevel)));
    const successCount = results.filter((r) => r.status === "fulfilled" && r.value === true).length;

    if (logLevel === "TRACE" && successCount > 0) {
      if (typeof CmdHeaderTraceButton !== "undefined" && CmdHeaderTraceButton.updateHeaderTraceTimer) {
        CmdHeaderTraceButton.updateHeaderTraceTimer(Date.now());
      }
    }

    const actionText = logLevel === "TRACE" ? "TRACE activated" : "Set to INFO";
    const msg = `${actionText} for ${successCount} iFlow(s).`;

    if (typeof showToast === "function") {
      showToast(msg, "Trace Manager", successCount > 0 ? "success" : "warning");
    }

    return { successCount, totalCount: idsArray.length };
  },

  /**
   * Opens the compact fixed-size Multi-Select Trace Manager modal dialog.
   */
  async openTraceManagerModal() {
    const apiHelper = typeof CmdCpiApiHelper !== "undefined" ? CmdCpiApiHelper : {};
    const activeIFlow = (typeof cpiData !== "undefined" && cpiData.integrationFlowId) ? cpiData.integrationFlowId : "";
    const packageId = (typeof cpiData !== "undefined" && cpiData.currentPackageId) ? cpiData.currentPackageId : (await apiHelper.resolveCurrentPackageId(activeIFlow));

    // Remove existing overlay if present
    const oldOverlay = document.getElementById("__cmd_trace_modal_overlay");
    if (oldOverlay) oldOverlay.remove();

    const modalContainer = document.createElement("div");
    modalContainer.id = "commondo-trace-manager-modal";
    modalContainer.style.cssText = "padding: 18px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; width: 100%; box-sizing: border-box;";

    const payloadHelper = typeof CmdTracePayloadHelper !== "undefined" ? CmdTracePayloadHelper : {};
    const escapeHtml = payloadHelper.escapeHtml || ((s) => s || "");

    modalContainer.innerHTML = `
      <div style="border-bottom: 2px solid #0070f3; padding-bottom: 8px; margin-bottom: 14px; display: flex; justify-content: space-between; align-items: center;">
        <div>
          <h2 style="margin: 0; color: #1a1a1a; font-size: 1.3rem;">Trace Manager</h2>
          <p style="margin: 3px 0 0 0; color: #666; font-size: 0.85rem;">
            Select integration flows to activate or deactivate TRACE logging in batch.
          </p>
        </div>
        <span class="cmd-trace-mgr-close" style="cursor: pointer; font-size: 1.5rem; font-weight: bold; color: #64748b; line-height: 1; padding: 0 4px;" title="Close">&times;</span>
      </div>

      <!-- Filter & Search Controls -->
      <div style="display: flex; gap: 10px; margin-bottom: 12px; align-items: center;">
        <input type="text" id="cmd-trace-search" placeholder="Search flows by name or ID..." style="flex: 1; padding: 6px 10px; border: 1px solid #ccc; border-radius: 4px; font-size: 0.85rem;" />
        <select id="cmd-trace-scope" style="padding: 6px 8px; border: 1px solid #ccc; border-radius: 4px; font-size: 0.85rem;">
          <option value="package" ${packageId ? "selected" : ""}>Current Package (${escapeHtml(packageId || "Package")})</option>
          <option value="all" ${!packageId ? "selected" : ""}>All Tenant Flows</option>
        </select>
      </div>

      <!-- Quick Selection Buttons -->
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        <div style="display: flex; gap: 6px;">
          <button id="cmd-btn-sel-all" class="ui mini button">Select All</button>
          <button id="cmd-btn-sel-none" class="ui mini button">Deselect All</button>
          <button id="cmd-btn-sel-current" class="ui mini button">Current Flow Only</button>
        </div>
        <span id="cmd-selected-count" style="font-size: 0.85rem; font-weight: bold; color: #0070f3;">0 flows selected</span>
      </div>

      <!-- Flow List Container: Fixed height, only this element scrolls -->
      <div id="cmd-flows-list" style="border: 1px solid #ddd; border-radius: 6px; background: #fafafa; height: 280px; max-height: 280px; overflow-y: auto; padding: 6px 10px; margin-bottom: 14px;">
        <div style="text-align: center; color: #888; padding: 30px;">Loading integration flows...</div>
      </div>

      <!-- Action Buttons -->
      <div style="display: flex; justify-content: flex-end; gap: 10px; border-top: 1px solid #eee; padding-top: 12px;">
        <button id="cmd-btn-deactivate-trace" class="ui mini button" style="color: #666;">
          Set Selected to INFO (Turn OFF)
        </button>
        <button id="cmd-btn-activate-trace" class="ui mini primary button" style="font-weight: bold;">
          Turn ON TRACE for Selected
        </button>
      </div>
    `;

    // Render Compact Fixed-Size Modal Overlay
    const overlay = document.createElement("div");
    overlay.id = "__cmd_trace_modal_overlay";
    overlay.style.cssText = "position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 10000; display: flex; align-items: center; justify-content: center;";

    const box = document.createElement("div");
    box.style.cssText = "background: #fff; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.3); position: relative; width: 700px; max-width: 92vw; overflow: hidden; display: flex; flex-direction: column;";
    box.appendChild(modalContainer);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

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
    const apiHelper = typeof CmdCpiApiHelper !== "undefined" ? CmdCpiApiHelper : {};
    const payloadHelper = typeof CmdTracePayloadHelper !== "undefined" ? CmdTracePayloadHelper : {};
    const escapeHtml = payloadHelper.escapeHtml || ((s) => s || "");

    const listDiv = document.getElementById("cmd-flows-list");
    const countSpan = document.getElementById("cmd-selected-count");
    const searchInput = document.getElementById("cmd-trace-search");
    const scopeSelect = document.getElementById("cmd-trace-scope");

    const [packageArtifacts, allArtifacts] = await Promise.all([
      apiHelper.fetchPackageArtifacts ? apiHelper.fetchPackageArtifacts(packageId) : [],
      apiHelper.fetchDeployedArtifacts ? apiHelper.fetchDeployedArtifacts() : [],
    ]);

    // Fast 1-shot check for active TRACE from storage
    const activeTraceFlows = new Set();
    try {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        const storageItems = await new Promise((resolve) => chrome.storage.local.get(null, resolve));
        const now = Date.now();
        const tenMins = 10 * 60 * 1000;

        if (storageItems) {
          Object.keys(storageItems).forEach((k) => {
            if (k.includes("powertraceLastRefresh")) {
              const ts = Number(storageItems[k]);
              if (ts && now - ts < tenMins) {
                const prefix = k.split("_powertraceLastRefresh")[0];
                if (prefix) {
                  activeTraceFlows.add(prefix);
                  const clean = prefix.replace(/_(cloudintegration|undefined|[a-zA-Z0-9_-]+)$/, "");
                  if (clean) activeTraceFlows.add(clean);
                }
              }
            }
          });
        }
      }
    } catch (e) {}

    // Load saved preferences
    let savedChecked = new Set();
    try {
      const storageKey = `__cmd_trace_checked_${activeIFlow || packageId || "default"}`;
      if (typeof storageGetPromise === "function") {
        const res = await storageGetPromise(storageKey);
        if (res && Array.isArray(res)) {
          savedChecked = new Set(res);
        } else if (res && res[storageKey] && Array.isArray(res[storageKey])) {
          savedChecked = new Set(res[storageKey]);
        }
      }
    } catch (e) {}

    // Default selection: Active flow if no prior selection
    if (savedChecked.size === 0 && activeIFlow) {
      savedChecked.add(activeIFlow);
    }

    function renderList() {
      const searchTerm = (searchInput.value || "").trim().toLowerCase();
      const scope = scopeSelect.value;
      const baseList = scope === "package" && packageArtifacts.length > 0 ? packageArtifacts : allArtifacts;

      const filtered = baseList.filter((a) => {
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
        const isTraceActive = activeTraceFlows.has(art.id) || activeTraceFlows.has(art.name);

        html += `
          <label style="display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-bottom: 1px solid #eee; cursor: pointer; background: ${isChecked ? "#eaf2fd" : "#fff"}; border-radius: 4px; margin-bottom: 2px;">
            <input type="checkbox" class="cmd-flow-checkbox" data-iflow-id="${escapeHtml(art.id)}" ${isChecked ? "checked" : ""} style="cursor: pointer;" />
            <div style="flex: 1; font-size: 0.85rem; display: flex; align-items: center; justify-content: space-between;">
              <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                <b style="color: ${isCurrent ? "#0070f3" : "#333"};">${escapeHtml(art.name)}</b>
                ${art.name !== art.id ? `<span style="color: #777; font-size: 0.75rem;">(${escapeHtml(art.id)})</span>` : ""}
                ${isCurrent ? `<span style="background: #0070f3; color: #fff; font-size: 0.7rem; padding: 1px 5px; border-radius: 3px;">Current</span>` : ""}
              </div>
              ${isTraceActive ? `
                <span title="TRACE is active on this flow" style="display: inline-flex; align-items: center; gap: 4px; background: #ecfdf5; border: 1px solid #10b981; border-radius: 10px; padding: 2px 7px; font-size: 0.72rem; font-weight: bold; color: #065f46; white-space: nowrap;">
                  <span style="display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #10b981; box-shadow: 0 0 4px #10b981;"></span> TRACE
                </span>
              ` : ""}
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

      updateCount();
    }

    function updateCount() {
      countSpan.innerText = `${savedChecked.size} flow(s) selected`;
    }

    searchInput.oninput = renderList;
    scopeSelect.onchange = renderList;

    document.getElementById("cmd-btn-sel-all").onclick = () => {
      listDiv.querySelectorAll(".cmd-flow-checkbox").forEach((cb) => {
        const id = cb.getAttribute("data-iflow-id");
        savedChecked.add(id);
        cb.checked = true;
        cb.closest("label").style.backgroundColor = "#eaf2fd";
      });
      updateCount();
    };

    document.getElementById("cmd-btn-sel-none").onclick = () => {
      savedChecked.clear();
      listDiv.querySelectorAll(".cmd-flow-checkbox").forEach((cb) => {
        cb.checked = false;
        cb.closest("label").style.backgroundColor = "#fff";
      });
      updateCount();
    };

    document.getElementById("cmd-btn-sel-current").onclick = () => {
      savedChecked.clear();
      if (activeIFlow) savedChecked.add(activeIFlow);
      listDiv.querySelectorAll(".cmd-flow-checkbox").forEach((cb) => {
        const id = cb.getAttribute("data-iflow-id");
        cb.checked = id === activeIFlow;
        cb.closest("label").style.backgroundColor = cb.checked ? "#eaf2fd" : "#fff";
      });
      updateCount();
    };

    // Turn ON TRACE
    document.getElementById("cmd-btn-activate-trace").onclick = async () => {
      const selectedIds = Array.from(savedChecked);
      if (selectedIds.length === 0) {
        alert("Please select at least one integration flow.");
        return;
      }

      const storageKey = `__cmd_trace_checked_${activeIFlow || packageId || "default"}`;
      if (typeof storageSetPromise === "function") {
        await storageSetPromise({ [storageKey]: selectedIds });
      }

      const btn = document.getElementById("cmd-btn-activate-trace");
      btn.innerText = "Activating TRACE...";
      btn.disabled = true;

      await CmdTraceManager.executeBatchLogLevel(selectedIds, "TRACE");

      btn.innerText = "Turn ON TRACE for Selected";
      btn.disabled = false;

      closeModal();
    };

    // Turn OFF TRACE (Set to INFO)
    document.getElementById("cmd-btn-deactivate-trace").onclick = async () => {
      const selectedIds = Array.from(savedChecked);
      if (selectedIds.length === 0) {
        alert("Please select at least one integration flow.");
        return;
      }

      const btn = document.getElementById("cmd-btn-deactivate-trace");
      btn.innerText = "Setting to INFO...";
      btn.disabled = true;

      await CmdTraceManager.executeBatchLogLevel(selectedIds, "INFO");

      btn.innerText = "Set Selected to INFO (Turn OFF)";
      btn.disabled = false;

      closeModal();
    };

    renderList();
  },
};

// Expose to window namespace
if (typeof window !== "undefined") {
  window.CmdTraceManager = CmdTraceManager;
  window.openTraceManagerModal = () => CmdTraceManager.openTraceManagerModal();
}
