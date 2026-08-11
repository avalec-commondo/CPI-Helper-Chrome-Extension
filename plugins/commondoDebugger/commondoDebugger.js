// ===========================================================================
// COMMODNO IS DEBUGGER - PLUGIN METADATA & REGISTRATION
// ===========================================================================
// Registers the Commondo IS Debugger plugin metadata and entry points with CPI-Helper.

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

  messageSidebarButton: {
    icon: { type: "icon", text: "xe0b6" },
    title: "Commondo IS Debugger",
    onClick: async (pluginHelper, settings, runInfo, active) => {
      if (typeof CmdDebuggerModal !== "undefined") {
        await CmdDebuggerModal.openModal(runInfo, pluginHelper);
      }
    },
  },

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
