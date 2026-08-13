// ===========================================================================
// COMMODNO IS DEBUGGER - HEADER TRACE BUTTON FEATURE
// ===========================================================================
// Injects the UI5 header 'Trace IFlows' action button into SAP CPI's navigation bar,
// auto-activates TRACE for root + ProcessDirect children, provides live countdown
// badge display, and triggers informational toasts.

const CmdHeaderTraceButton = {
  timerInterval: null,

  /**
   * Updates or starts the live 10-minute countdown badge next to the header button.
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
        if (CmdHeaderTraceButton.timerInterval) {
          clearInterval(CmdHeaderTraceButton.timerInterval);
          CmdHeaderTraceButton.timerInterval = null;
        }
      }
    };

    update();
    this.timerInterval = setInterval(update, 1000);
  },

  /**
   * Checks Chrome storage to see if TRACE was recently activated and starts header countdown.
   */
  async checkExistingHeaderTraceStatus() {
    try {
      const rootFlow = (typeof cpiData !== "undefined" && cpiData.integrationFlowId) ? cpiData.integrationFlowId : "";
      const locId = (typeof cpiData !== "undefined" && cpiData.runtimeLocationId) ? cpiData.runtimeLocationId : "cloudintegration";
      if (!rootFlow) return;

      if (typeof storageGetPromise === "function") {
        const stored = await storageGetPromise(`${rootFlow}_${locId}_powertraceLastRefresh`);
        if (stored) {
          const lastTime = Number(stored);
          const elapsed = Date.now() - lastTime;
          if (elapsed < 10 * 60 * 1000) {
            this.updateHeaderTraceTimer(lastTime);
          }
        }
      }
    } catch (e) {}
  },

  /**
   * Injects the Trace IFlows button and live countdown badge into the UI5 header bar.
   */
  injectButton() {
    let area = document.querySelector("[id*='--iflowObjectPageHeader-actions']");
    if (!area) {
      area = document.querySelector(".sapUxAPObjectPageHeaderIdentifierActions");
    }
    if (!area) return;

    if (document.getElementById("__commondo_trace_all_header_btn")) {
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
    timerBadge.innerHTML = `<span>⏱</span> <span id="__commondo_header_timer_text">10:00</span>`;

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

    traceBtn.onclick = async () => {
      if (typeof CmdTraceManager !== "undefined" && CmdTraceManager.openTraceManagerModal) {
        await CmdTraceManager.openTraceManagerModal();
      } else if (typeof window.openTraceManagerModal === "function") {
        await window.openTraceManagerModal();
      }
    };

    container.appendChild(timerBadge);
    container.appendChild(traceBtn);

    if (stdTraceBtn.parentNode) {
      stdTraceBtn.parentNode.insertBefore(container, stdTraceBtn);
    }

    this.checkExistingHeaderTraceStatus();
  },

  /**
   * Initializes periodic injection observer.
   */
  init() {
    this.injectButton();
    setInterval(() => this.injectButton(), 2000);
  },
};

// Expose to window namespace
if (typeof window !== "undefined") {
  window.CmdHeaderTraceButton = CmdHeaderTraceButton;
}

// Auto-initialize header integration
CmdHeaderTraceButton.init();
