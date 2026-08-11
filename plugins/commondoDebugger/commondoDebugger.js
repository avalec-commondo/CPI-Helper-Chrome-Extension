// ===========================================================================
// COMMODNO IS DEBUGGER - PLUGIN METADATA & REGISTRATION
// ===========================================================================
// Registers the Commondo IS Debugger plugin metadata and single sidebar entry point with CPI-Helper.

var plugin = {
  metadataVersion: "1.0.0",
  id: "commondoDebugger",
  name: "Commondo IS Debugger",
  version: "3.0.0",
  author: "Commondo",
  website: "https://commondo.eu",
  email: "info@commondo.eu",
  description: "Multi-tier iFlow trace debugger, recursive PD call-chain topology graph & trace exporter.",
  settings: {},

  // Single dedicated button in CPI-Helper sidebar panel
  messageSidebarContent: {
    static: true,
    onRender: (pluginHelper, settings) => {
      const container = document.createElement("div");
      container.style.cssText = "margin-top: 6px;";

      const btn = document.createElement("button");
      btn.id = "cmd-sidebar-open-debugger-btn";
      btn.className = "ui fluid mini primary button";
      btn.style.cssText = "font-weight: bold; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 8px 12px; border-radius: 4px;";
      btn.innerHTML = `<i class="sitemap icon" style="margin: 0;"></i> Open Trace Graph Debugger`;

      btn.onclick = async () => {
        if (typeof CmdDebuggerModal !== "undefined") {
          await CmdDebuggerModal.openModal(null, pluginHelper);
        }
      };

      container.appendChild(btn);
      return container;
    },
  },

  // Script editor button
  scriptButton: {
    icon: { type: "icon", text: "xe0b6" },
    title: "Commondo IS Debugger",
    onClick: async (pluginHelper, settings) => {
      if (typeof CmdDebuggerModal !== "undefined") {
        await CmdDebuggerModal.openModal(null, pluginHelper);
      }
    },
  },
};

if (typeof pluginList !== "undefined") {
  pluginList.push(plugin);
}
