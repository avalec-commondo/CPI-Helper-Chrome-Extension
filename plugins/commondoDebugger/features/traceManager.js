// ===========================================================================
// COMMODNO IS DEBUGGER - TRACE MANAGER FEATURE
// ===========================================================================
// Manages multi-level flow selection, bulk TRACE log level activation,
// and state synchronization for CPI-Helper's powertrace (red button).

const CmdTraceManager = {
  /**
   * Sets the log level for a specific iFlow and updates the powertrace timestamp.
   */
  async setIFlowLogLevel(iflowId, logLevel = "TRACE") {
    if (!iflowId) return false;

    try {
      let ok = false;

      // 1. Primary: Reuse CPI Helper's native setLogLevel function
      if (typeof setLogLevel === "function") {
        try {
          await setLogLevel(logLevel, iflowId);
          ok = true;
        } catch (eSet) {
          console.warn(`Native setLogLevel failed for ${iflowId}, falling back to command API:`, eSet);
        }
      }

      // 2. Fallback: Direct command/OData invocation if native function is unavailable or failed
      if (!ok) {
        const isNeo = (typeof cpiData !== "undefined" && cpiData.cpiPlatform === "neo") || window.location.host.includes("hana.ondemand.com");
        const selectedRuntimeLocation = typeof cpiData !== "undefined" && cpiData.runtimeLocationId && !isNeo ? cpiData.runtimeLocationId : "";
        const locID = selectedRuntimeLocation ? `, "runtimeLocationId":"${selectedRuntimeLocation}"` : "";
        const urlExt = typeof cpiData !== "undefined" && cpiData.urlExtension ? cpiData.urlExtension : "";
        const commandUrl = "/" + urlExt + "Operations/com.sap.it.op.tmn.commands.dashboard.webui.IntegrationComponentSetMplLogLevelCommand";
        const payload = `{"artifactSymbolicName":"${iflowId}","mplLogLevel":"${logLevel}","nodeType":"IFLMAP"${locID}}`;

        try {
          const rawRes = await makeCallPromise("POST", commandUrl, false, null, payload, true, "application/json;charset=UTF-8");
          if (rawRes) ok = true;
        } catch (errPost) {
          const getApi = (typeof CmdCpiApiHelper !== "undefined" && CmdCpiApiHelper.getApiUrl) ? CmdCpiApiHelper.getApiUrl : window.getApiUrl;
          const putUrl = getApi(`IntegrationRuntimeArtifacts('${encodeURIComponent(iflowId)}')`);
          await makeCallPromise("PUT", putUrl, true, JSON.stringify({ LogLevel: logLevel }), { "Content-Type": "application/json" });
          ok = true;
        }
      }

      // 3. Synchronize red button keep-alive state in storage via CPI Helper's storageSetPromise
      if (ok && logLevel === "TRACE") {
        const currentLocId = typeof cpiData !== "undefined" && cpiData.runtimeLocationId ? cpiData.runtimeLocationId : "cloudintegration";
        const nowStr = Date.now().toString();
        const keysToSet = {
          [`${iflowId}_powertraceLastRefresh`]: nowStr,
          [`${iflowId}_${currentLocId}_powertraceLastRefresh`]: nowStr,
          [`${iflowId}_cloudintegration_powertraceLastRefresh`]: nowStr,
        };

        if (typeof storageSetPromise === "function") {
          await storageSetPromise(keysToSet);
        } else if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set(keysToSet);
        }
      }

      return ok;
    } catch (e) {
      console.warn(`Failed to set log level for ${iflowId}:`, e);
      return false;
    }
  },

  /**
   * Bulk activates log level across multiple flows based on selected scope.
   */
  async bulkActivateLogLevel(scope = "topology", logLevel = "TRACE", onProgress = null) {
    const apiHelper = typeof CmdCpiApiHelper !== "undefined" ? CmdCpiApiHelper : {};
    const discoveryHelper = typeof CmdProcessDirectDiscovery !== "undefined" ? CmdProcessDirectDiscovery : {};

    const rootFlow = (typeof cpiData !== "undefined" && cpiData.integrationFlowId) ? cpiData.integrationFlowId : "";
    const packageId = (typeof cpiData !== "undefined" && cpiData.currentPackageId) ? cpiData.currentPackageId : (await apiHelper.resolveCurrentPackageId(rootFlow));

    let targetFlows = [];

    if (scope === "current" && rootFlow) {
      targetFlows = [rootFlow];
    } else if (scope === "package" && packageId) {
      const arts = await apiHelper.fetchPackageArtifacts(packageId);
      targetFlows = arts.filter((a) => a.type === "IFlow" || !a.type).map((a) => a.id);
    } else if (scope === "topology" && rootFlow && discoveryHelper.discoverProcessDirectTopology) {
      const topo = await discoveryHelper.discoverProcessDirectTopology(rootFlow, packageId);
      targetFlows = topo.nodes.map((n) => n.id);
    } else if (scope === "all" || targetFlows.length === 0) {
      const deployed = await apiHelper.fetchDeployedArtifacts();
      targetFlows = deployed.map((d) => d.id);
    }

    if (targetFlows.length === 0 && rootFlow) {
      targetFlows = [rootFlow];
    }

    const results = [];
    for (let i = 0; i < targetFlows.length; i++) {
      const flowId = targetFlows[i];
      if (onProgress) onProgress(i + 1, targetFlows.length, flowId);
      const ok = await CmdTraceManager.setIFlowLogLevel(flowId, logLevel);
      results.push({ iflowId: flowId, success: ok });
    }

    return results;
  },
};

// Expose to window namespace
if (typeof window !== "undefined") {
  window.CmdTraceManager = CmdTraceManager;
}

