// ===========================================================================
// COMMNDO IS DEBUGGER - CORE API CLIENT (CmdApiClient)
// ===========================================================================
// Universal OData, REST, and Operations API Client for SAP CPI.
// Fully encapsulates all 18 SAP CPI endpoints across SAP Neo, Cloud Foundry (BTP),
// and Edge Integration Cell with zero duplicate prefixes and pure data returns.

const workspaceGuidCache = new Map();

const CmdApiClient = {
  /**
   * Clears internal workspace and artifact GUID cache.
   */
  clearCache() {
    workspaceGuidCache.clear();
  },

  // -------------------------------------------------------------------------
  // Platform & Environment Detection
  // -------------------------------------------------------------------------

  getPlatform() {
    if (typeof cpiData !== "undefined" && cpiData.cpiPlatform) {
      return cpiData.cpiPlatform;
    }
    const host = typeof window !== "undefined" && window.location ? window.location.host : "";
    const path = typeof window !== "undefined" && window.location ? window.location.pathname : "";
    if (host.includes("-tmn.hci.") || host.includes(".hci.") || (path.startsWith("/itspaces") && !host.includes("cfapps") && !host.includes("integrationsuite"))) {
      return "neo";
    }
    return "cf";
  },

  isNeo() {
    return this.getPlatform() === "neo";
  },

  isCloudFoundry() {
    return this.getPlatform() === "cf";
  },

  getTenantHost() {
    if (typeof cpiData !== "undefined" && cpiData.tenant) {
      return cpiData.tenant;
    }
    if (typeof window !== "undefined" && window.location) {
      return window.location.host;
    }
    return "";
  },

  getUrlExtension() {
    if (typeof cpiData !== "undefined" && cpiData.urlExtension) {
      return cpiData.urlExtension.replace(/^\/+|\/+$/g, "") + "/";
    }
    return this.isNeo() ? "itspaces/" : "";
  },

  // -------------------------------------------------------------------------
  // URL Construction & Idempotent Routing
  // -------------------------------------------------------------------------

  buildUrl(rawPath) {
    if (!rawPath) return "/";
    if (rawPath.startsWith("http://") || rawPath.startsWith("https://")) {
      return rawPath;
    }

    const isNeo = this.isNeo();
    const ext = this.getUrlExtension(); // "itspaces/" on Neo, "" on CF

    // Strip duplicate prefixes for idempotency
    let clean = String(rawPath).trim().replace(/^\/+/, "");
    clean = clean.replace(/^(?:itspaces\/)+/i, "");

    // 1. Operations Commands
    if (clean.startsWith("Operations/") || clean.includes(".commands.dashboard.")) {
      return "/" + ext + clean;
    }

    // 2. Neo Workspace OData Service
    if (clean.startsWith("odata/1.0/workspace.svc/")) {
      return "/" + ext + clean;
    }

    // 3. Cloud Foundry Workspace REST
    if (clean.startsWith("api/1.0/workspace")) {
      if (isNeo) {
        if (clean.includes("/artifacts")) {
          const pkgMatch = clean.match(/workspace\/([^\/]+)\/artifacts/);
          if (pkgMatch && pkgMatch[1]) {
            return "/" + ext + `odata/1.0/workspace.svc/ContentPackages('${pkgMatch[1]}')/Artifacts?$format=json`;
          }
        }
        return "/" + ext + "odata/1.0/workspace.svc/ContentPackages?$format=json";
      }
      return "/" + clean;
    }

    // 4. Standard OData v1 Entities
    clean = clean.replace(/^(?:odata\/api\/v1\/|api\/v1\/)/i, "");

    if (isNeo) {
      return "/" + ext + "odata/api/v1/" + clean;
    }
    return "/" + ext + "api/v1/" + clean;
  },

  buildDesignUrl(iflowId, fallbackPkgId = "") {
    if (!iflowId) return "#";
    const tenant = this.getTenantHost();
    const ext = this.getUrlExtension();
    const store = typeof CmdStateStore !== "undefined" ? CmdStateStore : null;
    const pkgId = (store ? store.getArtifactPackageId(iflowId) : "") || fallbackPkgId;

    if (pkgId) {
      return `https://${tenant}/${ext}shell/design/contentpackage/${encodeURIComponent(pkgId)}/integrationflows/${encodeURIComponent(iflowId)}`;
    }
    return `https://${tenant}/${ext}shell/design/integrationflows/${encodeURIComponent(iflowId)}`;
  },

  // -------------------------------------------------------------------------
  // Base HTTP Request Wrapper with CSRF Support & Flexible Accept Headers
  // -------------------------------------------------------------------------

  async request(method, path, options = {}) {
    const url = this.buildUrl(path);
    const isOperations = url.includes("/Operations/") || url.includes(".commands.dashboard.");
    const {
      headers = {},
      body = null,
      responseType = "json", // "json" | "text" | "arraybuffer"
      includeCsrf = false,
    } = options;

    const reqHeaders = { ...headers };

    // Operations commands return XML or plain text, so Accept must be */*
    if (!reqHeaders["Accept"]) {
      if (isOperations) {
        reqHeaders["Accept"] = "*/*";
      } else {
        reqHeaders["Accept"] = responseType === "json" ? "application/json" : "*/*";
      }
    }

    if (includeCsrf || method === "POST" || method === "PUT" || method === "DELETE") {
      if (typeof getCsrfToken === "function") {
        try {
          const token = await getCsrfToken(false);
          if (token) reqHeaders["X-CSRF-Token"] = token;
        } catch (eCsrf) {}
      }
    }

    let fetchBody = body;
    if (body && typeof body === "object" && !(body instanceof ArrayBuffer) && !(body instanceof Blob) && !(body instanceof FormData)) {
      fetchBody = JSON.stringify(body);
      if (!reqHeaders["Content-Type"]) {
        reqHeaders["Content-Type"] = "application/json;charset=UTF-8";
      }
    }

    try {
      const resp = await fetch(url, {
        method,
        headers: reqHeaders,
        body: fetchBody,
        credentials: "include",
      });

      if (!resp.ok) {
        return {
          ok: false,
          status: resp.status,
          statusText: resp.statusText,
          data: null,
          url,
        };
      }

      let data = null;
      if (responseType === "json") {
        const text = await resp.text();
        try {
          data = text ? JSON.parse(text) : null;
        } catch (eJson) {
          data = text;
        }
      } else if (responseType === "arraybuffer") {
        data = await resp.arrayBuffer();
      } else {
        data = await resp.text();
      }

      return {
        ok: true,
        status: resp.status,
        statusText: resp.statusText,
        data,
        url,
      };
    } catch (err) {
      return {
        ok: false,
        status: 0,
        statusText: err.message,
        data: null,
        url,
      };
    }
  },

  async getJson(path, options = {}) {
    const res = await this.request("GET", path, { ...options, responseType: "json" });
    return res.ok ? res.data?.d?.results || res.data?.d || res.data?.value || res.data : null;
  },

  async getText(path, options = {}) {
    const res = await this.request("GET", path, { ...options, responseType: "text" });
    return res.ok ? res.data : null;
  },

  async getArrayBuffer(path, options = {}) {
    const res = await this.request("GET", path, { ...options, responseType: "arraybuffer" });
    return res.ok ? res.data : null;
  },

  async post(path, body, options = {}) {
    return this.request("POST", path, { ...options, body, includeCsrf: true });
  },

  // -------------------------------------------------------------------------
  // 1. Deployed Components & Runtime Artifacts
  // -------------------------------------------------------------------------

  async fetchDeployedArtifacts(forceRefresh = false) {
    const store = typeof CmdStateStore !== "undefined" ? CmdStateStore : null;
    if (!forceRefresh && store) {
      const cached = store.getCachedDeployedArtifacts();
      if (cached) return cached;
    }

    let artifacts = [];

    if (this.isNeo()) {
      // SAP Neo: Operations IntegrationComponentsListCommand
      try {
        const rawRes = await this.getText("Operations/com.sap.it.op.tmn.commands.dashboard.webui.IntegrationComponentsListCommand");
        if (rawRes) {
          let cmdData = null;
          if (rawRes.trim().startsWith("<")) {
            if (typeof XmlToJson !== "undefined") {
              cmdData = new XmlToJson().parse(rawRes);
            }
          } else {
            cmdData = JSON.parse(rawRes);
          }
          const resp = cmdData?.["com.sap.it.op.tmn.commands.dashboard.webui.IntegrationComponentsListResponse"] || cmdData;
          const raw = resp?.artifactInformations || resp?.artifactInformation || [];
          artifacts = Array.isArray(raw) ? raw : [raw];
        }
      } catch (e) {}
    } else {
      // Cloud Foundry: IntegrationRuntimeArtifacts OData entity
      try {
        const res = await this.getJson("IntegrationRuntimeArtifacts?$format=json&$select=Id,Name");
        if (Array.isArray(res)) artifacts = res;
      } catch (e) {}
    }

    const deployedList = artifacts
      .map((a) => ({
        id: a.symbolicName || a.Id || a.id || a.name || "",
        name: a.name || a.Name || a.symbolicName || a.id || "",
        deployState: a.deployState || "DEPLOYED",
        deployedOn: a.deployedOn || "",
      }))
      .filter((a) => a.id);

    if (store) {
      store.setCachedDeployedArtifacts(deployedList);
    }
    return deployedList;
  },

  // -------------------------------------------------------------------------
  // 2. Message Processing Logs & Correlation Call-Chains
  // -------------------------------------------------------------------------

  async fetchMessageLogs(iflowId = null, top = 10, orderby = "LogStart desc") {
    let filterStr = iflowId ? `&$filter=IntegrationArtifact/Id eq '${encodeURIComponent(iflowId)}'` : "";
    const url = `MessageProcessingLogs?$top=${top}&$orderby=${orderby}&$format=json${filterStr}`;
    const data = await this.getJson(url);
    return Array.isArray(data) ? data : [];
  },

  async fetchCorrelationLogs(correlationId) {
    if (!correlationId) return [];
    const url = `MessageProcessingLogs?$format=json&$filter=CorrelationId eq '${encodeURIComponent(correlationId)}'&$orderby=LogStart`;
    const data = await this.getJson(url);
    return Array.isArray(data) ? data : [];
  },

  // -------------------------------------------------------------------------
  // 3. Execution Runs, Steps & Trace Payloads
  // -------------------------------------------------------------------------

  async fetchMessageRuns(messageGuid) {
    if (!messageGuid) return [];
    const url = `MessageProcessingLogs('${encodeURIComponent(messageGuid)}')/Runs?$format=json`;
    const data = await this.getJson(url);
    return Array.isArray(data) ? data : [];
  },

  async fetchCustomHeaderProperties(messageGuid) {
    if (!messageGuid) return [];
    const url = `MessageProcessingLogs('${encodeURIComponent(messageGuid)}')/CustomHeaderProperties?$format=json`;
    const data = await this.getJson(url);
    return Array.isArray(data) ? data : [];
  },

  async fetchRunSteps(runId, top = 300) {
    if (!runId) return [];
    const url = `MessageProcessingLogRuns('${encodeURIComponent(runId)}')/RunSteps?$format=json&$top=${top}`;
    const data = await this.getJson(url);
    return Array.isArray(data) ? data : [];
  },

  async fetchRunTraceMessages(runId) {
    if (!runId) return [];
    try {
      const url = `TraceMessages?$format=json&$filter=RunId eq '${encodeURIComponent(runId)}'&$expand=Properties,ExchangeProperties`;
      const data = await this.getJson(url);
      if (Array.isArray(data) && data.length > 0) return data;
    } catch (e) {}

    try {
      const fallbackUrl = `TraceMessages?$format=json&$filter=RunId eq '${encodeURIComponent(runId)}'`;
      const fbData = await this.getJson(fallbackUrl);
      return Array.isArray(fbData) ? fbData : [];
    } catch (e2) {
      return [];
    }
  },

  async fetchStepTraceMessages(runId, childCount) {
    if (!runId || childCount === undefined || childCount === null) return [];
    const url = `MessageProcessingLogRunSteps(RunId='${encodeURIComponent(runId)}',ChildCount=${childCount})/TraceMessages?$format=json`;
    const data = await this.getJson(url);
    return Array.isArray(data) ? data : [];
  },

  async fetchStepExchangeProperties(traceId) {
    if (!traceId) return [];
    const url = `TraceMessages(${traceId})/ExchangeProperties?$format=json`;
    const data = await this.getJson(url);
    return Array.isArray(data) ? data : [];
  },

  async fetchStepHeaders(traceId) {
    if (!traceId) return [];
    const url = `TraceMessages(${traceId})/Properties?$format=json`;
    const data = await this.getJson(url);
    return Array.isArray(data) ? data : [];
  },

  async fetchStepBodyPayload(traceId, responseType = "text") {
    if (!traceId) return null;
    const url = `TraceMessages(${traceId})/$value`;
    const res = await this.request("GET", url, { responseType });
    return res.ok ? res.data : null;
  },

  async fetchErrorInformation(messageGuid, runId = null) {
    if (!messageGuid && !runId) return null;

    if (messageGuid) {
      try {
        const rawText = await this.getText(`MessageProcessingLogs('${encodeURIComponent(messageGuid)}')/ErrorInformation/$value`);
        if (rawText && typeof rawText === "string" && rawText.trim()) {
          return rawText.trim();
        }
      } catch (e1) {}

      try {
        const errorJson = await this.getJson(`MessageProcessingLogs('${encodeURIComponent(messageGuid)}')/ErrorInformation?$format=json`);
        if (errorJson) {
          const msg = errorJson.ErrorMessage || errorJson.LastError || errorJson.ModelStepId || errorJson.StepId;
          if (msg) return String(msg).trim();
          if (typeof errorJson === "string") return errorJson.trim();
        }
      } catch (e2) {}
    }

    if (runId) {
      try {
        const runText = await this.getText(`MessageProcessingLogRuns('${encodeURIComponent(runId)}')/ErrorInformation/$value`);
        if (runText && typeof runText === "string" && runText.trim()) {
          return runText.trim();
        }
      } catch (e3) {}

      try {
        const runJson = await this.getJson(`MessageProcessingLogRuns('${encodeURIComponent(runId)}')/ErrorInformation?$format=json`);
        if (runJson) {
          const msg = runJson.ErrorMessage || runJson.LastError;
          if (msg) return String(msg).trim();
        }
      } catch (e4) {}
    }

    return null;
  },

  // -------------------------------------------------------------------------
  // 4. Log Level Management (Operations Command)
  // -------------------------------------------------------------------------

  async setMplLogLevel(iflowId, logLevel = "TRACE") {
    if (!iflowId) return { ok: false, iflowId, error: "Empty iFlow ID" };
    const cmdUrl = "Operations/com.sap.it.op.tmn.commands.dashboard.webui.IntegrationComponentSetMplLogLevelCommand";
    const body = {
      artifactSymbolicName: iflowId,
      mplLogLevel: String(logLevel).toUpperCase(),
      nodeType: "IFLMAP",
    };
    return this.post(cmdUrl, body, { responseType: "text" });
  },

  async deployIntegrationArtifact(iflowId, version = "active") {
    if (!iflowId) return { ok: false, iflowId, error: "Empty iFlow ID" };

    const isNeo = this.isNeo();
    const tenant = this.getTenantHost() ? this.getTenantHost().split(".")[0] : (typeof cpiData !== "undefined" ? cpiData.tenantId : "");

    // 1. Cloud Foundry: Direct SAP Web Modeler WebDAV DEPLOY endpoint
    if (!isNeo) {
      try {
        const pkgId = await this.resolveCurrentPackageId(iflowId);
        let wsGuid = pkgId ? await this.resolveWorkspaceGuid(pkgId) : "";
        let artGuid = iflowId;
        let symbolicName = iflowId;

        if (pkgId) {
          const arts = await this.fetchPackageArtifacts(pkgId);
          const match = arts.find((a) => a.id === iflowId || a.name === iflowId || a.entityId === iflowId || a.rawId === iflowId);
          if (match) {
            artGuid = match.entityId || match.rawId || iflowId;
            symbolicName = match.id || iflowId;
          }
        }

        if (wsGuid && artGuid) {
          const deployPath = `api/1.0/workspace/${encodeURIComponent(wsGuid)}/artifacts/${encodeURIComponent(artGuid)}/entities/${encodeURIComponent(artGuid)}/iflows/${encodeURIComponent(symbolicName)}?webdav=DEPLOY`;

          // Execute via CPI-Helper native makeCallPromise (handles cookies, session and CSRF with null payload)
          if (typeof makeCallPromise === "function") {
            try {
              const fullUrl = this.buildUrl(deployPath);
              const mRes = await makeCallPromise("PUT", fullUrl, false, "*/*", null, true, null, false);
              if (mRes !== undefined && mRes !== null) {
                return { ok: true, iflowId, data: mRes };
              }
            } catch (eM) {}
          }

          // Direct fetch fallback with null body
          const res = await this.request("PUT", deployPath, {
            responseType: "text",
            body: null,
            headers: { "If-Match": "*", Accept: "*/*" },
            includeCsrf: true,
          });
          if (res.ok) {
            return { ok: true, iflowId, data: res.data };
          }
        }
      } catch (eCf) {
        console.warn(`[CmdApiClient] CF Workspace deploy error for ${iflowId}:`, eCf);
      }
    }

    // 2. Neo: Direct OData Workspace Deploy Function Import (Clean 200 OK without trial calls)
    if (this.isNeo()) {
      const odataPath = this.buildUrl(`DeployIntegrationDesigntimeArtifact?Id='${encodeURIComponent(iflowId)}'&Version='${encodeURIComponent(version)}'`);

      // Execute via CPI-Helper native makeCallPromise
      if (typeof makeCallPromise === "function") {
        try {
          const oRes = await makeCallPromise("POST", odataPath, false, "application/json", null, true, null, false);
          if (oRes !== undefined && oRes !== null) {
            return { ok: true, iflowId, data: oRes };
          }
        } catch (eOdata) {
          console.warn(`[CmdApiClient] Neo OData deploy error for ${iflowId}:`, eOdata);
        }
      }

      // Direct fetch fallback for Neo OData
      try {
        const res = await this.request("POST", odataPath, {
          responseType: "json",
          includeCsrf: true,
        });
        if (res.ok) {
          return { ok: true, iflowId, data: res.data };
        }
      } catch (eReq) {}
    }

    return { ok: false, iflowId, error: "Deployment failed on all routes." };
  },

  // -------------------------------------------------------------------------
  // 5. Workspace Packages & Artifact Metadata
  // -------------------------------------------------------------------------

  async fetchWorkspacePackages() {
    if (this.isNeo()) {
      const data = await this.getJson("odata/1.0/workspace.svc/ContentPackages?$format=json");
      return Array.isArray(data) ? data : [];
    }
    const data = await this.getJson("api/1.0/workspace");
    return Array.isArray(data) ? data : [];
  },

  async resolveCurrentPackageId(iFlowId = null) {
    const url = typeof window !== "undefined" && window.location ? window.location.href : "";
    const match = url.match(/\/contentpackage\/([^\/?#]+)/i) || url.match(/\/packages\/([^\/?#]+)/i);
    if (match && match[1]) return decodeURIComponent(match[1]);

    if (typeof cpiData !== "undefined") {
      if (cpiData.currentPackageId) return cpiData.currentPackageId;
      if (cpiData.packageId) return cpiData.packageId;
    }

    if (iFlowId) {
      try {
        if (this.isNeo()) {
          const data = await this.getJson("odata/1.0/workspace.svc/ContentPackages?$format=json&$expand=Artifacts");
          if (Array.isArray(data)) {
            const found = data.find((p) =>
              p.Artifacts?.results?.some((a) => a.Name === iFlowId || a.Id === iFlowId || a.symbolicName === iFlowId)
            );
            if (found) return found.Name || found.TechnicalName;
          }
        } else {
          const wsList = await this.fetchWorkspacePackages();
          if (Array.isArray(wsList)) {
            for (const ws of wsList) {
              const wsGuid = ws.id;
              if (wsGuid) {
                const arts = await this.getJson(`api/1.0/workspace/${encodeURIComponent(wsGuid)}/artifacts`);
                const artList = Array.isArray(arts) ? arts : arts?.artifacts || [];
                if (artList.some((a) => a.id === iFlowId || a.name === iFlowId || a.symbolicName === iFlowId)) {
                  return ws.technicalName || ws.name || wsGuid;
                }
              }
            }
          }
        }
      } catch (e) {}
    }

    return "";
  },

  async resolveWorkspaceGuid(pkgName) {
    if (!pkgName) return "";
    if (this.isNeo()) return pkgName;
    if (workspaceGuidCache.has(pkgName)) return workspaceGuidCache.get(pkgName);

    try {
      const wsList = await this.getJson("api/1.0/workspace");
      if (Array.isArray(wsList)) {
        wsList.forEach((ws) => {
          if (ws.technicalName && ws.id) workspaceGuidCache.set(ws.technicalName, ws.id);
          if (ws.name && ws.id) workspaceGuidCache.set(ws.name, ws.id);
        });
        if (workspaceGuidCache.has(pkgName)) return workspaceGuidCache.get(pkgName);
      }
    } catch (e) {}

    return pkgName;
  },

  async fetchPackageArtifacts(packageId) {
    if (!packageId) return [];
    const store = typeof CmdStateStore !== "undefined" ? CmdStateStore : null;
    if (store) {
      const cached = store.getCachedPackageArtifacts(packageId);
      if (cached) return cached;
    }

    const packageArts = [];
    const isNeo = this.isNeo();

    if (isNeo) {
      try {
        const arts = await this.getJson(`odata/1.0/workspace.svc/ContentPackages('${encodeURIComponent(packageId)}')/Artifacts?$format=json`);
        if (Array.isArray(arts)) {
          arts.forEach((a) => {
            const id = a.Name || a.Id || a.symbolicName;
            const name = a.DisplayName || a.Name || id;
            const type = a.Type || a.type || a.artifactType || "IFlow";
            if (id) {
              packageArts.push({ id, name, packageId, type, entityId: id, rawId: id });
              if (store) {
                store.registerArtifactName(id, name);
                store.registerArtifactGuid(id, id);
                store.registerArtifactPackageId(id, packageId);
              }
            }
          });
        }
      } catch (e) {}
    } else {
      try {
        const wsGuid = await this.resolveWorkspaceGuid(packageId);
        const targetId = wsGuid || packageId;
        const restRes = await this.getJson(`api/1.0/workspace/${encodeURIComponent(targetId)}/artifacts`);
        const arts = Array.isArray(restRes) ? restRes : restRes?.artifacts || [];

        arts.forEach((a) => {
          const symName = a.additionalAttrs?.OriginBundleSymbolicName?.[0] || a.symbolicName || a.Name || a.id || a.Id;
          const name = a.name || a.DisplayName || symName;
          const rawType = a.type || a.Type || a.artifactType || a.additionalAttrs?.Type?.[0] || a.typeDescription || "";
          let type = rawType || "IFlow";

          // If artifact has no explicit type, check if it's a Script Collection, Mapping, or Value Mapping
          if (!rawType) {
            const lowName = (name + " " + symName).toLowerCase();
            if (lowName.includes("script") || lowName.includes("collection")) type = "ScriptCollection";
            else if (lowName.includes("value mapping") || lowName.includes("valuemapping")) type = "ValueMapping";
            else if (lowName.includes("mapping") || lowName.includes("map_")) type = "MessageMapping";
          }

          const entityId = a.entityID || a.id || symName;
          const rawId = a.id || a.entityID || symName;

          if (symName) {
            packageArts.push({ id: symName, name, packageId, type, entityId, rawId });
            if (store) {
              store.registerArtifactName(symName, name);
              store.registerArtifactGuid(symName, entityId);
              store.registerArtifactPackageId(symName, packageId);
            }
          }
        });
      } catch (e) {}
    }

    if (store && packageArts.length > 0) {
      store.setCachedPackageArtifacts(packageId, packageArts);
    }
    return packageArts;
  },

  // -------------------------------------------------------------------------
  // 6. BPMN Modeler Diagram & ZIP Download
  // -------------------------------------------------------------------------

  async fetchModelerJson(iflowId, packageId = null) {
    if (!iflowId || this.isNeo()) return null;
    const pkgId = packageId || (await this.resolveCurrentPackageId(iflowId));
    const wsGuid = await this.resolveWorkspaceGuid(pkgId);
    let artGuid = iflowId;
    let symbolicName = iflowId;

    if (pkgId) {
      const arts = await this.fetchPackageArtifacts(pkgId);
      const match = arts.find((a) => a.id === iflowId || a.name === iflowId || a.entityId === iflowId || a.rawId === iflowId);
      if (match) {
        artGuid = match.entityId || match.rawId || iflowId;
        symbolicName = match.id || iflowId;
        const t = String(match.type || "").toLowerCase();
        if (t && !t.includes("iflow") && !t.includes("integration")) {
          return null;
        }
      }
    }

    if (wsGuid && artGuid) {
      const paths = [
        `api/1.0/workspace/${encodeURIComponent(wsGuid)}/artifacts/${encodeURIComponent(artGuid)}/entities/${encodeURIComponent(artGuid)}/iflows/${encodeURIComponent(symbolicName)}?$format=json`,
        `api/1.0/workspace/${encodeURIComponent(wsGuid)}/artifacts/${encodeURIComponent(artGuid)}/entities/${encodeURIComponent(artGuid)}/iflows/${encodeURIComponent(artGuid)}?$format=json`,
      ];

      for (const p of paths) {
        try {
          const res = await this.getJson(p);
          if (res) return res;
        } catch (e) {}
      }
    }
    return null;
  },

  async fetchArtifactZip(iflowId, version = "active") {
    if (!iflowId) return null;
    const path = `IntegrationDesigntimeArtifacts(Id='${encodeURIComponent(iflowId)}',Version='${encodeURIComponent(version)}')/$value`;
    return this.getArrayBuffer(path);
  },
};

// Expose globally
if (typeof window !== "undefined") {
  window.CmdApiClient = CmdApiClient;
  window.getApiUrl = (p) => CmdApiClient.buildUrl(p);
}
if (typeof global !== "undefined") {
  global.CmdApiClient = CmdApiClient;
}
