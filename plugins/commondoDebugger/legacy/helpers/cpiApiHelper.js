// ===========================================================================
// COMMODNO IS DEBUGGER - CPI API HELPER
// ===========================================================================
// Universal OData & REST API client, Workspace GUID resolver, and Artifact Fetcher
// Supports both SAP Neo and SAP BTP Cloud Foundry / SAP Integration Suite

const workspaceGuidMap = new Map();
const packageArtifactsCache = new Map();
let deployedArtifactsCache = null;

const artifactGuidMap = new Map();
const artifactNameMap = new Map();
const artifactPackageMap = new Map();

const CmdCpiApiHelper = {
  /**
   * Register human-readable artifact name for an ID.
   */
  registerArtifactName(id, name) {
    if (!id || !name) return;
    artifactNameMap.set(id, name);
    artifactNameMap.set(id.toLowerCase(), name);
    const norm = String(id).trim().toLowerCase().replace(/[\s\-_]+/g, "");
    if (norm) artifactNameMap.set(norm, name);
  },

  /**
   * Get human-readable artifact name for an ID.
   */
  getArtifactName(id) {
    if (!id) return "";
    if (artifactNameMap.has(id)) return artifactNameMap.get(id);
    if (artifactNameMap.has(id.toLowerCase())) return artifactNameMap.get(id.toLowerCase());
    const norm = String(id).trim().toLowerCase().replace(/[\s\-_]+/g, "");
    if (artifactNameMap.has(norm)) return artifactNameMap.get(norm);
    return "";
  },

  /**
   * Register package ID for an artifact.
   */
  registerArtifactPackageId(id, packageId) {
    if (!id || !packageId) return;
    artifactPackageMap.set(id, packageId);
    artifactPackageMap.set(id.toLowerCase(), packageId);
    const norm = String(id).trim().toLowerCase().replace(/[\s\-_]+/g, "");
    if (norm) artifactPackageMap.set(norm, packageId);
  },

  /**
   * Get package ID for an artifact.
   */
  getArtifactPackageId(id) {
    if (!id) return "";
    if (artifactPackageMap.has(id)) return artifactPackageMap.get(id);
    if (artifactPackageMap.has(id.toLowerCase())) return artifactPackageMap.get(id.toLowerCase());
    const norm = String(id).trim().toLowerCase().replace(/[\s\-_]+/g, "");
    if (artifactPackageMap.has(norm)) return artifactPackageMap.get(norm);
    return "";
  },

  /**
   * Build guaranteed direct design-time URL for any iFlow across Cloud Foundry, Neo, and Edge Integration Cell.
   */
  getIFlowDesignUrl(iflowId, fallbackPkgId = "") {
    if (!iflowId) return "#";
    const tenant = (typeof cpiData !== "undefined" && cpiData.tenant) ? cpiData.tenant : window.location.host;
    let urlExt = (typeof cpiData !== "undefined" && cpiData.urlExtension) ? cpiData.urlExtension : "";
    if (urlExt && !urlExt.endsWith("/")) urlExt += "/";

    const pkgId = this.getArtifactPackageId(iflowId) || fallbackPkgId;
    if (pkgId) {
      return `https://${tenant}/${urlExt}shell/design/contentpackage/${encodeURIComponent(pkgId)}/integrationflows/${encodeURIComponent(iflowId)}`;
    }
    return `https://${tenant}/${urlExt}shell/design/integrationflows/${encodeURIComponent(iflowId)}`;
  },

  /**
   * Robust API URL builder for Cloud Foundry (CF), Neo, and Edge Integration Cell.
   */
  getApiUrl(subPath) {
    let cleanPath = (subPath || "").replace(/^\/+/, "");
    const urlExt = typeof cpiData !== "undefined" && cpiData.urlExtension ? cpiData.urlExtension : "";
    const runtimeExt = typeof cpiData !== "undefined" && cpiData.runtimePathExtension ? cpiData.runtimePathExtension : "";
    const host = window.location.host;
    const isCF = host.includes("cfapps") || host.includes("integrationsuite");

    if (cleanPath.startsWith("odata/api/v1/")) {
      if (isCF) cleanPath = cleanPath.replace("odata/api/v1/", "api/v1/");
    } else if (cleanPath.startsWith("api/v1/")) {
      if (!isCF) cleanPath = cleanPath.replace("api/v1/", "odata/api/v1/");
    } else {
      cleanPath = (isCF ? "api/v1/" : "odata/api/v1/") + cleanPath;
    }

    return "/" + urlExt + runtimeExt + cleanPath;
  },

  /**
   * Parse SAP OData timestamp /Date(172304800000)/ or ISO string into milliseconds.
   */
  parseMs(ts) {
    if (!ts) return 0;
    if (typeof ts === "number") return ts;
    const match = String(ts).match(/\d+/);
    if (match) return parseInt(match[0], 10);
    return new Date(ts).getTime() || 0;
  },

  /**
   * Returns normalized API URL prefixes for the current tenant environment.
   */
  getApiPrefixes() {
    const urlExt = typeof cpiData !== "undefined" && cpiData.urlExtension ? cpiData.urlExtension : "";
    const runtimeExt = typeof cpiData !== "undefined" && cpiData.runtimePathExtension ? cpiData.runtimePathExtension : "";

    const raw = [
      "/" + urlExt + runtimeExt,
      "/" + urlExt,
      "/itspaces/",
      "/",
    ];

    return Array.from(new Set(raw.map((p) => "/" + p.replace(/^\/+|\/+$/g, "") + "/"))).map((p) => (p === "//" ? "/" : p));
  },

  /**
   * Platform detection helpers.
   */
  isNeo() {
    if (typeof cpiData !== "undefined" && cpiData.cpiPlatform) {
      return cpiData.cpiPlatform === "neo";
    }
    const host = window.location.host;
    const path = window.location.pathname;
    if (host.includes("-tmn.hci.") || host.includes(".hci.") || (path.startsWith("/itspaces") && !host.includes("cfapps") && !host.includes("integrationsuite"))) {
      return true;
    }
    return false;
  },

  isCloudFoundry() {
    return !this.isNeo();
  },

  /**
   * Resolves the current package ID for a given flow or the active page.
   */
  async resolveCurrentPackageId(iFlowId = null) {
    // 1. From active URL
    const url = window.location.href;
    const match = url.match(/\/contentpackage\/([^\/?#]+)/i) || url.match(/\/packages\/([^\/?#]+)/i);
    if (match && match[1]) return decodeURIComponent(match[1]);

    // 2. From CPI data context
    if (typeof cpiData !== "undefined" && cpiData.currentPackageId) {
      return cpiData.currentPackageId;
    }
    if (typeof cpiData !== "undefined" && cpiData.packageId) {
      return cpiData.packageId;
    }

    // 3. Fallback: Lookup via package query if iFlowId is provided
    if (iFlowId) {
      try {
        const urlExt = typeof cpiData !== "undefined" && cpiData.urlExtension ? cpiData.urlExtension : "";
        if (this.isNeo()) {
          const pkgQueryUrl = `/${urlExt}odata/1.0/workspace.svc/ContentPackages?$format=json&$expand=Artifacts`;
          const rawPkgs = await makeCallPromise("GET", pkgQueryUrl, false, null, null, false, null, true);
          const pkgRes = typeof rawPkgs === "string" ? JSON.parse(rawPkgs) : rawPkgs;
          const foundPkg = (pkgRes?.d?.results || []).find((p) =>
            p.Artifacts?.results?.some((a) => a.Name === iFlowId || a.Id === iFlowId || a.symbolicName === iFlowId)
          );
          if (foundPkg) return foundPkg.Name || foundPkg.TechnicalName;
        } else {
          const cfPkgUrls = [
            `/${urlExt}api/v1/IntegrationPackages?$format=json&$expand=IntegrationDesigntimeArtifacts`,
            `/api/v1/IntegrationPackages?$format=json&$expand=IntegrationDesigntimeArtifacts`,
          ];
          for (const u of cfPkgUrls) {
            try {
              const rawCf = await makeCallPromise("GET", u, false, null, null, false, null, true);
              const cfRes = typeof rawCf === "string" ? JSON.parse(rawCf) : rawCf;
              const pkgs = cfRes?.d?.results || cfRes?.value || [];
              const matchPkg = pkgs.find((p) =>
                (p.IntegrationDesigntimeArtifacts?.results || p.IntegrationDesigntimeArtifacts || []).some((a) => a.Id === iFlowId || a.Name === iFlowId)
              );
              if (matchPkg) return matchPkg.Id || matchPkg.Name;
            } catch (eCf) {}
          }
        }
      } catch (e) {}
    }

    return "";
  },

  /**
   * Resolves the internal Cloud Foundry Workspace GUID for a technical package name.
   */
  async resolveWorkspaceGuid(pkgName) {
    if (!pkgName) return "";
    if (this.isNeo()) return pkgName; // On Neo, packages are technical names, not GUIDs
    if (workspaceGuidMap.has(pkgName)) return workspaceGuidMap.get(pkgName);

    const tenant = (typeof cpiData !== "undefined" && cpiData.tenant) ? cpiData.tenant : window.location.host;
    const wsUrls = [
      `https://${tenant}/api/1.0/workspace/`,
      `https://${tenant}/api/1.0/workspace`,
      `/api/1.0/workspace/`,
      `/api/1.0/workspace`,
    ];

    for (const u of wsUrls) {
      try {
        let wsList = null;
        if (u.startsWith("http")) {
          const resp = await fetch(u, { method: "GET", headers: { Accept: "application/json" }, credentials: "include" });
          if (resp.ok) wsList = await resp.json();
        } else {
          const raw = await makeCallPromise("GET", u, false, null, null, true, "application/json", true);
          wsList = typeof raw === "string" ? JSON.parse(raw) : raw;
        }

        if (Array.isArray(wsList)) {
          wsList.forEach((ws) => {
            if (ws.technicalName && ws.id) workspaceGuidMap.set(ws.technicalName, ws.id);
            if (ws.name && ws.id) workspaceGuidMap.set(ws.name, ws.id);
          });
          if (workspaceGuidMap.has(pkgName)) return workspaceGuidMap.get(pkgName);
        }
      } catch (e) {}
    }

    return pkgName;
  },

  /**
   * Fetches all artifacts within a specific package (with type metadata and Hex GUIDs).
   */
  async fetchPackageArtifacts(packageId) {
    if (!packageId) return [];
    if (packageArtifactsCache.has(packageId) && packageArtifactsCache.get(packageId).length > 0) {
      return packageArtifactsCache.get(packageId);
    }

    let packageArts = [];
    const isNeoTenant = this.isNeo();

    // 1. Neo: Query Neo OData workspace service directly
    if (isNeoTenant) {
      try {
        const urlExt = typeof cpiData !== "undefined" && cpiData.urlExtension ? cpiData.urlExtension : "";
        const neoUrls = [
          `/${urlExt}odata/1.0/workspace.svc/ContentPackages('${encodeURIComponent(packageId)}')/Artifacts?$format=json`,
          `/itspaces/odata/1.0/workspace.svc/ContentPackages('${encodeURIComponent(packageId)}')/Artifacts?$format=json`,
          `/odata/1.0/workspace.svc/ContentPackages('${encodeURIComponent(packageId)}')/Artifacts?$format=json`,
        ];
        for (const pkgUrl of neoUrls) {
          try {
            const rawPkg = await makeCallPromise("GET", encodeURI(pkgUrl), false, null, null, false, null, true);
            const pkgRes = typeof rawPkg === "string" ? JSON.parse(rawPkg) : rawPkg;
            const arts = pkgRes?.d?.results || (Array.isArray(pkgRes) ? pkgRes : []);
            if (arts.length > 0) {
              arts.forEach((a) => {
                const id = a.Name || a.Id || a.symbolicName;
                const name = a.DisplayName || a.Name || id;
                const type = a.Type || a.type || a.artifactType || "IFlow";
                if (id) {
                  packageArts.push({ id, name, packageId, type, entityId: id, rawId: id });
                  artifactGuidMap.set(id, id);
                  artifactGuidMap.set(name, id);
                  this.registerArtifactName(id, name);
                  this.registerArtifactName(name, name);
                  this.registerArtifactPackageId(id, packageId);
                  this.registerArtifactPackageId(name, packageId);
                }
              });
              break;
            }
          } catch (e) {}
        }
      } catch (e) {}
    }

    // 2. Cloud Foundry: Query REST workspace API
    if (!isNeoTenant || packageArts.length === 0) {
      try {
        const wsGuid = await this.resolveWorkspaceGuid(packageId);
        const targetId = wsGuid || packageId;
        const tenant = (typeof cpiData !== "undefined" && cpiData.tenant) ? cpiData.tenant : window.location.host;
        const restUrls = [
          `https://${tenant}/api/1.0/workspace/${encodeURIComponent(targetId)}/artifacts`,
          `/api/1.0/workspace/${encodeURIComponent(targetId)}/artifacts`,
        ];
        for (const rUrl of restUrls) {
          try {
            let arts = null;
            if (rUrl.startsWith("http")) {
              const resp = await fetch(rUrl, { method: "GET", headers: { Accept: "application/json" }, credentials: "include" });
              if (resp.ok) {
                const restRes = await resp.json();
                arts = Array.isArray(restRes) ? restRes : restRes?.artifacts || [];
              }
            } else {
              const raw = await makeCallPromise("GET", rUrl, false, null, null, true, "application/json", true);
              const restRes = typeof raw === "string" ? JSON.parse(raw) : raw;
              arts = Array.isArray(restRes) ? restRes : restRes?.artifacts || [];
            }

            if (Array.isArray(arts) && arts.length > 0) {
              arts.forEach((a) => {
                const symName = a.tooltip || a.additionalAttrs?.OriginBundleSymbolicName?.[0] || a.symbolicName || a.Name || a.id || a.Id;
                const name = a.name || a.DisplayName || symName;
                const type = a.type || a.Type || a.artifactType || "IFlow";
                const entityId = a.entityID || a.id || symName;
                const rawId = a.id || a.entityID || symName;

                packageArts.push({ id: symName, name, packageId, type, entityId, rawId, tooltip: a.tooltip });

                artifactGuidMap.set(symName, entityId);
                artifactGuidMap.set(name, entityId);
                if (a.id) artifactGuidMap.set(a.id, entityId);
                if (a.tooltip) artifactGuidMap.set(a.tooltip, entityId);
                if (a.additionalAttrs?.OriginBundleSymbolicName) {
                  a.additionalAttrs.OriginBundleSymbolicName.forEach((s) => artifactGuidMap.set(s, entityId));
                }

                if (symName && name) {
                  this.registerArtifactName(symName, name);
                  this.registerArtifactName(entityId, name);
                  this.registerArtifactName(rawId, name);
                  this.registerArtifactPackageId(symName, packageId);
                  this.registerArtifactPackageId(entityId, packageId);
                  this.registerArtifactPackageId(rawId, packageId);
                }
              });
              break;
            }
          } catch (e) {}
        }
      } catch (e) {}
    }

    if (packageArts.length > 0) {
      packageArtifactsCache.set(packageId, packageArts);
    }
    return packageArts;
  },

  /**
   * Resolves the internal Cloud Foundry Artifact Entity GUID for a given flow in a package.
   */
  async resolveArtifactGuid(packageId, iflowId) {
    if (!iflowId) return "";
    if (artifactGuidMap.has(iflowId)) return artifactGuidMap.get(iflowId);

    if (packageId) {
      const arts = await this.fetchPackageArtifacts(packageId);
      if (artifactGuidMap.has(iflowId)) return artifactGuidMap.get(iflowId);
      const found = arts.find((a) => a.id === iflowId || a.name === iflowId || a.tooltip === iflowId || a.entityId === iflowId || a.rawId === iflowId);
      if (found) {
        const guid = found.entityId || found.rawId || found.id;
        artifactGuidMap.set(iflowId, guid);
        return guid;
      }
    }
    return iflowId;
  },

  /**
   * Fetches all deployed artifacts across the entire tenant.
   */
  async fetchDeployedArtifacts(forceRefresh = false) {
    if (!forceRefresh && deployedArtifactsCache) {
      return deployedArtifactsCache;
    }

    let artifacts = [];

    // 1. Primary: IntegrationComponentsListCommand
    try {
      const urlExt = typeof cpiData !== "undefined" && cpiData.urlExtension ? cpiData.urlExtension : "";
      const cmdUrl = `/${urlExt}Operations/com.sap.it.op.tmn.commands.dashboard.webui.IntegrationComponentsListCommand`;
      const rawCmd = await makeCallPromise("GET", cmdUrl, false, null, null, null, null, true);
      let cmdData = null;
      if (typeof rawCmd === "string" && rawCmd.trim().startsWith("<")) {
        cmdData = new XmlToJson().parse(rawCmd);
      } else if (typeof rawCmd === "string") {
        cmdData = JSON.parse(rawCmd);
      } else {
        cmdData = rawCmd;
      }
      const resp = cmdData?.["com.sap.it.op.tmn.commands.dashboard.webui.IntegrationComponentsListResponse"] || cmdData;
      const raw = resp?.artifactInformations || resp?.artifactInformation || [];
      artifacts = Array.isArray(raw) ? raw : [raw];
    } catch (e) {}

    // 2. Fallback: IntegrationRuntimeArtifacts OData
    if (artifacts.length === 0) {
      try {
        const artUrl = CmdCpiApiHelper.getApiUrl("IntegrationRuntimeArtifacts?$format=json&$select=Id,Name");
        const rawArt = await makeCallPromise("GET", encodeURI(artUrl), false, null, null, false, null, true);
        const artRes = typeof rawArt === "string" ? JSON.parse(rawArt) : rawArt;
        artifacts = artRes.d && artRes.d.results ? artRes.d.results : [];
      } catch (e) {}
    }

    deployedArtifactsCache = artifacts
      .map((a) => ({
        id: a.symbolicName || a.Id || a.id || a.name || "",
        name: a.name || a.Name || a.symbolicName || a.id || "",
        deployState: a.deployState || "DEPLOYED",
        deployedOn: a.deployedOn || "",
      }))
      .filter((a) => a.id);

    return deployedArtifactsCache;
  },
};

// Expose to window namespace
if (typeof window !== "undefined") {
  window.CmdCpiApiHelper = CmdCpiApiHelper;
  window.getApiUrl = CmdCpiApiHelper.getApiUrl;
  window.parseMs = CmdCpiApiHelper.parseMs;
}
