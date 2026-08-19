// ===========================================================================
// COMMNDO IS DEBUGGER - HEADER TRACE BUTTON COMPONENT (CmdHeaderTraceButton)
// ===========================================================================
// Injects the UI5 header 'Trace IFlows' action button and live 10-minute
// countdown badge into SAP CPI's top navigation bar only when Commondo Debugger is active.

const CmdHeaderTraceButton = {
  timerInterval: null,

  /**
   * Checks whether the commondoDebugger plugin is active in CPI Helper settings.
   */
  async isPluginActive() {
    try {
      if (typeof getPluginSettings === "function") {
        const s = await getPluginSettings("commondoDebugger");
        if (s && s["commondoDebugger---isActive"] !== undefined) {
          return s["commondoDebugger---isActive"] === true;
        }
      }
      if (typeof getStorageValue === "function") {
        const v = await getStorageValue("commondoDebugger", "isActive");
        if (v !== undefined && v !== null) {
          return v === true;
        }
      }
      if (typeof chrome !== "undefined" && chrome.storage?.sync) {
        return new Promise((resolve) => {
          chrome.storage.sync.get("commondoDebugger---isActive", (items) => {
            if (items && items["commondoDebugger---isActive"] !== undefined) {
              resolve(items["commondoDebugger---isActive"] === true);
            } else {
              resolve(true);
            }
          });
        });
      }
    } catch (eActive) {
      console.warn("[CmdHeaderTraceButton] Failed to check isPluginActive status:", eActive);
    }
    return true;
  },

  /**
   * Updates or starts the live 10-minute countdown badge in the UI5 header.
   */
  updateHeaderTraceTimer(activatedAt = Date.now()) {
    const timerBadge = document.getElementById("__commondo_header_trace_timer");
    const timerText = document.getElementById("__commondo_header_timer_text");
    if (!timerBadge || !timerText) return;

    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }

    const update = () => {
      const elapsedMs = Date.now() - activatedAt;
      const remainingMs = Math.max(0, 10 * 60 * 1000 - elapsedMs);
      const totalSec = Math.floor(remainingMs / 1000);
      const mins = Math.floor(totalSec / 60);
      const secs = totalSec % 60;
      const formatted = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;

      if (remainingMs > 0) {
        timerBadge.style.display = "inline-flex";
        timerText.textContent = formatted;
      } else {
        timerBadge.style.display = "none";
        if (this.timerInterval) {
          clearInterval(this.timerInterval);
          this.timerInterval = null;
        }
      }
    };

    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }

    update();
    this.timerInterval = setInterval(update, 1000);
  },

  /**
   * Checks Chrome storage to see if TRACE was recently activated and starts countdown.
   */
  async checkExistingHeaderTraceStatus() {
    try {
      const rootFlow = (typeof cpiData !== "undefined" && cpiData.integrationFlowId) ? cpiData.integrationFlowId : "";
      const locId = (typeof cpiData !== "undefined" && cpiData.runtimeLocationId) ? cpiData.runtimeLocationId : "cloudintegration";
      if (!rootFlow) return;

      const utils = typeof CmdUtils !== "undefined" ? CmdUtils : null;
      if (!utils) return;

      const storageKey = `${rootFlow}_${locId}_powertraceLastRefresh`;
      const stored = await utils.storageGet(storageKey);

      if (stored) {
        const lastTime = Number(stored);
        const elapsed = Date.now() - lastTime;
        if (elapsed < 10 * 60 * 1000) {
          this.updateHeaderTraceTimer(lastTime);
        }
      }
    } catch (eStatus) {
      console.warn("[CmdHeaderTraceButton] checkExistingHeaderTraceStatus failed:", eStatus);
    }
  },

  /**
   * Injects the Trace IFlows button and live countdown badge into the UI5 header bar.
   * Only renders if the commondoDebugger plugin is active.
   */
  async injectButton() {
    const isActive = await this.isPluginActive();
    const existing = document.getElementById("__commondo_header_trace_container");
    if (!isActive) {
      if (existing) existing.remove();
      return;
    }

    let area = document.querySelector("[id*='--iflowObjectPageHeader-actions']");
    if (!area) {
      area = document.querySelector(".sapUxAPObjectPageHeaderIdentifierActions");
    }
    if (!area) return;

    if (existing) {
      this.checkExistingHeaderTraceStatus();
      return;
    }

    const stdTraceBtn = document.getElementById("__buttonxx") || document.querySelector("[id*='--traceButton']");
    if (!stdTraceBtn) return;

    const container = document.createElement("div");
    container.id = "__commondo_header_trace_container";
    container.style.cssText = "display: inline-flex; align-items: center; float: right; margin-right: 6px; gap: 6px;";

    const timerBadge = document.createElement("span");
    timerBadge.id = "__commondo_header_trace_timer";
    timerBadge.title = "TRACE remaining active time (10 min keep-alive)";
    timerBadge.style.cssText = "display: none; align-items: center; gap: 4px; padding: 3px 8px; background: #ecfdf5; border: 1px solid #10b981; border-radius: 4px; color: #065f46; font-family: monospace; font-size: 0.8rem; font-weight: bold; line-height: 1.2;";
    timerBadge.innerHTML = `<span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #10b981;"></span> <span id="__commondo_header_timer_text">10:00</span>`;

    const traceBtn = document.createElement("button");
    traceBtn.id = "__commondo_trace_all_header_btn";
    traceBtn.title = "Open Multi-Select Trace Manager";
    traceBtn.className = "sapMBtn sapMBtnBase spcHeaderActionButton";
    traceBtn.style.cssText = "display: inline-block; margin: 0;";
    traceBtn.innerHTML = `
      <span class="sapMBtnHoverable sapMBtnInner sapMBtnText sapMBtnTransparent sapMFocusable">
        <span class="sapMBtnContent">
          <bdi id="__commondo_trace_btn_text" style="color: #0070f3; font-weight: bold;">Trace IFlows</bdi>
        </span>
      </span>
    `;

    traceBtn.onclick = () => {
      if (typeof CmdTraceManagerModal !== "undefined" && CmdTraceManagerModal.open) {
        CmdTraceManagerModal.open();
      } else if (typeof window.openTraceManagerModal === "function") {
        window.openTraceManagerModal();
      }
    };

    container.appendChild(timerBadge);
    container.appendChild(traceBtn);

    if (stdTraceBtn.parentNode) {
      stdTraceBtn.parentNode.insertBefore(container, stdTraceBtn);
    }

    this.checkExistingHeaderTraceStatus();
  },

  _observer: null,
  _debounceTimer: null,

  /**
   * Initializes lightweight event-driven MutationObserver for header button injection.
   * Only attaches observer if the plugin is actively enabled in CPI Helper.
   */
  async init() {
    const isActive = await this.isPluginActive();
    if (!isActive) {
      if (this._observer) {
        this._observer.disconnect();
        this._observer = null;
      }
      return;
    }

    this.injectButton();

    if (typeof MutationObserver !== "undefined" && typeof document !== "undefined" && document.body) {
      if (this._observer) {
        this._observer.disconnect();
      }

      this._observer = new MutationObserver(() => {
        if (document.getElementById("__commondo_header_trace_container")) return;

        if (this._debounceTimer) clearTimeout(this._debounceTimer);
        this._debounceTimer = setTimeout(() => {
          this.injectButton();
        }, 150);
      });

      try {
        this._observer.observe(document.body, {
          childList: true,
          subtree: true,
        });
      } catch (eObs) {
        console.debug("[CmdHeaderTraceButton] MutationObserver attach skipped:", eObs);
      }
    }
  },
};

// Expose globally
if (typeof window !== "undefined") {
  window.CmdHeaderTraceButton = CmdHeaderTraceButton;
}
if (typeof global !== "undefined") {
  global.CmdHeaderTraceButton = CmdHeaderTraceButton;
}

// Auto-initialize header integration
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => CmdHeaderTraceButton.init());
} else {
  CmdHeaderTraceButton.init();
}
