// ===========================================================================
// COMMODNO IS DEBUGGER - BPMN MODEL HELPER
// ===========================================================================
// Downloads and extracts iFlow ZIP bundles, parses BPMN XML,
// resolves externalized parameters.prop, and maps ProcessDirect channels.
// Fully compatible with both SAP Neo and SAP BTP Cloud Foundry / Integration Suite.

const iflowBpmnModelCache = new Map();

const CmdBpmnModelHelper = {
  /**
   * Clears the BPMN model cache for a fresh session or reload.
   */
  clearCache() {
    iflowBpmnModelCache.clear();
  },

  /**
   * Downloads and parses the BPMN XML model and parameters.prop for any iFlow.
   */
  async fetchIFlowBpmnModel(iflowId, passedPkgId = null, forceRefresh = false) {
    if (!iflowId) return { iflowId: "", outbound: [], inbound: [], steps: {}, paramMap: {} };
    if (!forceRefresh && iflowBpmnModelCache.has(iflowId)) {
      return iflowBpmnModelCache.get(iflowId);
    }

    let bpmnXml = null;
    let paramMap = {};

    const apiHelper = typeof CmdCpiApiHelper !== "undefined" ? CmdCpiApiHelper : {};
    const isNeoTenant = apiHelper.isNeo ? apiHelper.isNeo() : false;
    let pkgName = passedPkgId || "";
    let artGuid = iflowId;
    let wsGuid = pkgName;

    // Helper to download ZIP and extract BPMN XML + parameters.prop
    async function tryDownloadZip(url) {
      if (!url) return null;
      console.log(`%c[ZIP Download] Attempting: ${url}`, "color: #d97706;");
      try {
        let buf = null;
        try {
          const resp = await fetch(url, { method: "GET", credentials: "include" });
          console.log(`[ZIP Download] HTTP ${resp.status} for ${url}`);
          if (resp.ok) {
            buf = await resp.arrayBuffer();
          }
        } catch (eFetch) {
          console.warn(`[ZIP Download] fetch failed, trying XHR for ${url}:`, eFetch);
          const xhr = new XMLHttpRequest();
          xhr.open("GET", url, true);
          xhr.responseType = "arraybuffer";
          buf = await new Promise((resolve, reject) => {
            xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve(xhr.response) : reject(new Error(`HTTP ${xhr.status}`)));
            xhr.onerror = () => reject(new Error("Network error"));
            xhr.send();
          });
        }

        if (buf && typeof JSZip !== "undefined") {
          const zip = await JSZip.loadAsync(buf);
          console.log(`[ZIP Download] Extracted ZIP (${buf.byteLength} bytes). Contained files:`, Object.keys(zip.files));

          // 1. Parse parameters.prop (key=value properties file)
          const propFile = Object.keys(zip.files).find((fn) => fn.endsWith("/parameters.prop") || fn.endsWith("\\parameters.prop") || fn === "parameters.prop");
          if (propFile) {
            try {
              const propText = await zip.files[propFile].async("string");
              propText.split(/\r?\n/).forEach((line) => {
                const trimmed = line.trim();
                if (trimmed && !trimmed.startsWith("#") && !trimmed.startsWith("!")) {
                  const eqIdx = trimmed.indexOf("=");
                  if (eqIdx > 0) {
                    const k = trimmed.substring(0, eqIdx).trim();
                    let v = trimmed.substring(eqIdx + 1).trim();
                    v = v.replace(/\\\//g, "/").replace(/\\\\/g, "\\");
                    paramMap[k] = v;
                  }
                }
              });
              console.log(`%c[BPMN Model Helper] Parsed parameters.prop for "${iflowId}":`, "color: #10b981; font-weight: bold;", paramMap);
            } catch (eProp) {}
          }

          // Also inspect parameters.propdef (XML metadata) for defaults
          const propDefFile = Object.keys(zip.files).find((fn) => fn.endsWith("parameters.propdef"));
          if (propDefFile) {
            try {
              const defText = await zip.files[propDefFile].async("string");
              const parser = new DOMParser();
              const xmlDoc = parser.parseFromString(defText, "text/xml");
              const paramEls = xmlDoc.getElementsByTagName("param");
              for (let i = 0; i < paramEls.length; i++) {
                const p = paramEls[i];
                const id = p.getAttribute("id") || p.getAttribute("name");
                const defVal = p.getAttribute("defaultValue") || p.getAttribute("value") || p.getAttribute("default");
                if (id && defVal && !paramMap[id]) {
                  paramMap[id] = defVal.trim();
                }
              }
            } catch (eDef) {}
          }

          // 2. Find BPMN scenario flow XML
          const iflw = Object.keys(zip.files).find((fn) => fn.endsWith(".iflw") || fn.endsWith(".bpmn") || fn.includes("scenarioflows"));
          if (iflw) {
            console.log(`[ZIP Download] Found BPMN scenario XML file: "${iflw}"`);
            return await zip.files[iflw].async("string");
          }
        }
      } catch (e) {
        console.warn(`[ZIP Download] Failed for ${url}:`, e);
      }
      return null;
    }

    // Auto-resolve package and artifact GUID across the tenant
    try {
      if (pkgName && apiHelper.fetchPackageArtifacts) {
        const arts = await apiHelper.fetchPackageArtifacts(pkgName);
        const match = arts.find((a) => a.id === iflowId || a.name === iflowId || a.tooltip === iflowId || a.entityId === iflowId);
        if (match) {
          artGuid = match.entityId || match.rawId || iflowId;
        } else if (apiHelper.resolveCurrentPackageId) {
          const realPkg = await apiHelper.resolveCurrentPackageId(iflowId);
          if (realPkg && realPkg !== pkgName) {
            pkgName = realPkg;
            const realArts = await apiHelper.fetchPackageArtifacts(pkgName);
            const realMatch = realArts.find((a) => a.id === iflowId || a.name === iflowId || a.tooltip === iflowId || a.entityId === iflowId);
            if (realMatch) artGuid = realMatch.entityId || realMatch.rawId || iflowId;
          }
        }
      } else if (!pkgName && apiHelper.resolveCurrentPackageId) {
        pkgName = await apiHelper.resolveCurrentPackageId(iflowId);
        if (pkgName && apiHelper.fetchPackageArtifacts) {
          const arts = await apiHelper.fetchPackageArtifacts(pkgName);
          const match = arts.find((a) => a.id === iflowId || a.name === iflowId || a.tooltip === iflowId || a.entityId === iflowId);
          if (match) artGuid = match.entityId || match.rawId || iflowId;
        }
      }

      if (pkgName && apiHelper.resolveWorkspaceGuid) {
        wsGuid = await apiHelper.resolveWorkspaceGuid(pkgName);
      }
    } catch (eRes) {}

    const tenant = (typeof cpiData !== "undefined" && cpiData.tenant) ? cpiData.tenant : window.location.host;
    console.log(`[BPMN Model Helper] Resolving model for "${iflowId}" in package "${pkgName}" (wsGuid: ${wsGuid}, artGuid: ${artGuid})`);

    // 1. PRIMARY METHOD FOR CLOUD FOUNDRY: Pure JSON Web Modeler Diagram (Zero-unzip, direct JSON, works in browser session)
    if (!isNeoTenant && pkgName && wsGuid && artGuid) {
      try {
        const modelUrls = [
          `https://${tenant}/api/1.0/workspace/${encodeURIComponent(wsGuid)}/artifacts/${encodeURIComponent(artGuid)}/entities/${encodeURIComponent(artGuid)}/iflows/${encodeURIComponent(iflowId)}?$format=json`,
          `https://${tenant}/api/1.0/workspace/${encodeURIComponent(wsGuid)}/artifacts/${encodeURIComponent(artGuid)}/entities/${encodeURIComponent(artGuid)}/iflows/${encodeURIComponent(artGuid)}?$format=json`,
        ];

        let modelJson = null;
        for (const mu of modelUrls) {
          try {
            console.log(`%c[API CALL] GET Modeler JSON: ${mu}`, "color: #0284c7;");
            const resp = await fetch(mu, { method: "GET", headers: { Accept: "application/json" }, credentials: "include" });
            console.log(`[API RESP] HTTP ${resp.status} for ${mu}`);
            if (resp.ok) {
              modelJson = await resp.json();
              if (modelJson) break;
            }
          } catch (eMu) {
            console.warn(`[Modeler JSON] Failed querying ${mu}:`, eMu);
          }
        }

        if (modelJson) {
          const outbound = [];
          const inbound = [];
          const steps = {};

          // 1. Extract human-readable step names
          function extractShapes(obj) {
            if (!obj || typeof obj !== "object") return;
            if (obj.id && (obj.attributes?.name || obj.name?.value || (typeof obj.name === "string" && obj.name))) {
              const id = obj.id;
              const name = (obj.attributes?.name || obj.name?.value || obj.name || "").trim();
              if (id && name && name !== id) {
                steps[id] = name;
              }
            }
            if (Array.isArray(obj)) {
              obj.forEach(extractShapes);
            } else {
              Object.values(obj).forEach(extractShapes);
            }
          }
          extractShapes(modelJson.bpmnModel?.shapes || modelJson.shapes || modelJson);

          // 2. Recursively collect all channel objects across the entire JSON tree
          function collectChannelElements(obj, collected = []) {
            if (!obj || typeof obj !== "object") return collected;
            if (obj.ITYPE === "DEFAULT_CHANNEL" || (obj.adapterType && (obj.allAttributes || obj.address || obj.direction)) || obj.type === "Connection") {
              collected.push(obj);
            }
            if (Array.isArray(obj)) {
              for (const item of obj) collectChannelElements(item, collected);
            } else {
              for (const k of Object.keys(obj)) {
                collectChannelElements(obj[k], collected);
              }
            }
            return collected;
          }

          const allRawChannels = collectChannelElements(modelJson);
          const channelMap = new Map();

          allRawChannels.forEach((c) => {
            const chanId = String(c.id || c.channelId || "");
            const rawAdapter = typeof c.adapterType === "object" ? c.adapterType?.value : c.adapterType;
            const adapterType = String(rawAdapter || c.attributes?.name || (typeof c.name === "object" ? c.name?.value : c.name) || "").toLowerCase();
            const chanName = String((typeof c.name === "object" ? c.name?.value : c.name) || c.attributes?.name || chanId || "");
            const rawDirection = typeof c.direction === "object" ? c.direction?.value : c.direction;
            let direction = String(rawDirection || "").toUpperCase();
            const tooltipStr = String(c.tooltip || "");

            const isProcessDirect = adapterType.includes("processdirect") || chanName.toLowerCase().includes("processdirect") || tooltipStr.toLowerCase().includes("processdirect");
            if (isProcessDirect) {
              let address = String(c.allAttributes?.address?.value || c.allAttributes?.url?.value || (typeof c.address === "object" ? c.address?.value : c.address) || c.attributes?.address || "").trim();
              if (!address && tooltipStr) {
                const match = tooltipStr.match(/Address\s*=\s*([^\n_]+)/i);
                if (match) address = match[1].trim();
              }

              if (!direction) {
                if (c.source && String(c.source).includes("Participant") && c.target && (String(c.target).includes("Start") || String(c.target).includes("Event"))) {
                  direction = "SENDER";
                } else if (c.target && String(c.target).includes("Participant")) {
                  direction = "RECEIVER";
                }
              }

              const isSender = direction.includes("SENDER") || direction.includes("INBOUND") || chanName.toLowerCase().includes("sender") || (c.source && String(c.source).includes("Participant") && c.target && String(c.target).includes("Start"));

              if (address && chanId) {
                channelMap.set(chanId, { id: chanId, name: chanName, componentType: "ProcessDirect", address: address, isSender });
              } else if (address) {
                const chan = { id: chanId || `pd_${Math.random()}`, name: chanName, componentType: "ProcessDirect", address: address };
                if (isSender) inbound.push(chan);
                else outbound.push(chan);
              }
            }
          });

          // Consolidate unique channels
          channelMap.forEach((chan) => {
            if (chan.isSender) {
              if (!inbound.some((i) => i.address === chan.address)) inbound.push(chan);
            } else {
              if (!outbound.some((o) => o.address === chan.address)) outbound.push(chan);
            }
          });

          console.log(`[BPMN Model Helper] ${iflowId} model parsed -> Inbound: ${inbound.length}, Outbound: ${outbound.length}, Steps: ${Object.keys(steps).length}`, { inbound, outbound, steps });

          if (outbound.length > 0 || inbound.length > 0 || Object.keys(steps).length > 0) {
            const result = { iflowId, outbound, inbound, steps, paramMap };
            iflowBpmnModelCache.set(iflowId, result);
            return result;
          }
        }
      } catch (eJson) {
        console.warn(`Pure JSON model extraction failed for ${iflowId}, falling back to ZIP:`, eJson);
      }
    }

    // Helper to generate a guaranteed absolute HTTPS URL
    function toAbsoluteUrl(p) {
      if (!p) return "";
      if (p.startsWith("http://") || p.startsWith("https://")) return p;
      const clean = p.replace(/^\/+/, "");
      return `https://${tenant}/${clean}`;
    }

    // 2. Candidate URLs for ZIP Archive (Standard OData Artifact Download)
    const candidateUrls = [
      toAbsoluteUrl(`api/v1/IntegrationDesigntimeArtifacts(Id='${encodeURIComponent(iflowId)}',Version='active')/$value`),
      toAbsoluteUrl(`odata/api/v1/IntegrationDesigntimeArtifacts(Id='${encodeURIComponent(iflowId)}',Version='active')/$value`),
    ];

    for (const u of candidateUrls) {
      bpmnXml = await tryDownloadZip(u);
      if (bpmnXml) break;
    }

    // 3. If needed, query real version via OData and download exact version value
    if (!bpmnXml) {
      try {
        const metaUrls = [
          toAbsoluteUrl(`api/v1/IntegrationDesigntimeArtifacts?$format=json&$filter=Id eq '${encodeURIComponent(iflowId)}'&$select=Id,Version`),
          toAbsoluteUrl(`odata/api/v1/IntegrationDesigntimeArtifacts?$format=json&$filter=Id eq '${encodeURIComponent(iflowId)}'&$select=Id,Version`),
        ];

        let realVersion = "";
        for (const mu of metaUrls) {
          try {
            const resp = await fetch(mu, { headers: { Accept: "application/json" }, credentials: "include" });
            if (resp.ok) {
              const resM = await resp.json();
              const items = resM?.d?.results || resM?.value || (Array.isArray(resM) ? resM : []);
              if (items.length > 0 && items[0].Version) {
                realVersion = items[0].Version;
                break;
              }
            }
          } catch (eM) {}
        }

        if (realVersion) {
          const versionUrls = [
            toAbsoluteUrl(`api/v1/IntegrationDesigntimeArtifacts(Id='${encodeURIComponent(iflowId)}',Version='${realVersion}')/$value`),
            toAbsoluteUrl(`odata/api/v1/IntegrationDesigntimeArtifacts(Id='${encodeURIComponent(iflowId)}',Version='${realVersion}')/$value`),
          ];

          for (const vu of versionUrls) {
            bpmnXml = await tryDownloadZip(vu);
            if (bpmnXml) break;
          }
        }
      } catch (eMeta) {}
    }

    const outbound = [];
    const inbound = [];
    const steps = {};

    // 3. Parse BPMN XML
    if (bpmnXml) {
      try {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(bpmnXml, "text/xml");

        // Step names
        const allEls = xmlDoc.getElementsByTagName("*");
        for (let i = 0; i < allEls.length; i++) {
          const el = allEls[i];
          const id = el.getAttribute("id");
          const name = el.getAttribute("name");
          if (id && name && name.trim() && name !== id) {
            steps[id] = name.trim();
          }
        }

        // MessageFlows
        const messageFlows = xmlDoc.getElementsByTagNameNS("*", "messageFlow");
        for (let i = 0; i < messageFlows.length; i++) {
          const mf = messageFlows[i];
          const mfId = mf.getAttribute("id") || "";
          const mfName = mf.getAttribute("name") || mfId;

          const props = mf.getElementsByTagNameNS("*", "property");
          const sourceRef = (mf.getAttribute("sourceRef") || "").toLowerCase();
          const targetRef = (mf.getAttribute("targetRef") || "").toLowerCase();
          let cmdVariantUri = "";
          let componentType = "";
          let address = "";
          let direction = "";

          for (let pIdx = 0; pIdx < props.length; pIdx++) {
            const p = props[pIdx];
            const keyEl = p.getElementsByTagNameNS("*", "key")[0] || p.querySelector("key");
            const valEl = p.getElementsByTagNameNS("*", "value")[0] || p.querySelector("value");
            const k = keyEl ? keyEl.textContent.trim() : (p.getAttribute("key") || p.getAttribute("name") || "").trim();
            const v = valEl ? valEl.textContent.trim() : (p.getAttribute("value") || "").trim();
            if (k === "ComponentType" || k === "adapterType" || k === "ComponentNS") componentType = v;
            if (k.toLowerCase() === "address" || k.toLowerCase() === "url") address = v;
            if (k === "direction") direction = v.toUpperCase();
            if (k === "cmdVariantUri" || k === "cmdVariant") cmdVariantUri = v.toLowerCase();
          }

          // Resolve externalized parameter (e.g. {{ProcessDirectAddress}} -> /real_endpoint)
          const paramMatch = address.match(/^\{\{\s*([a-zA-Z0-9_.\-]+)\s*\}\}$/);
          if (paramMatch && paramMap[paramMatch[1]]) {
            address = paramMap[paramMatch[1]];
          }

          // STRICT FILTER: ProcessDirect ONLY (Exclude RFC, HTTP, SOAP, Mail, SFTP)
          const isStrictProcessDirect = componentType.toLowerCase() === "processdirect" || mfName.toLowerCase().includes("processdirect");
          if (isStrictProcessDirect && address) {
            const chan = { id: mfId, name: mfName, componentType: "ProcessDirect", address: address };

            let isSender = false;
            if (direction.includes("SENDER") || direction.includes("INBOUND")) {
              isSender = true;
            } else if (cmdVariantUri.includes("/sender/") || cmdVariantUri.includes("::sender")) {
              isSender = true;
            } else if (targetRef.includes("startevent") || targetRef.includes("start_") || (sourceRef.includes("participant") && !targetRef.includes("participant"))) {
              isSender = true;
            }

            if (isSender) {
              inbound.push(chan);
            } else {
              outbound.push(chan);
            }
          }
        }
      } catch (eXml) {
        console.warn(`Error parsing BPMN XML for ${iflowId}:`, eXml);
      }
    }

    const result = { iflowId, outbound, inbound, steps, paramMap };
    iflowBpmnModelCache.set(iflowId, result);
    return result;
  },
};

// Expose to window namespace
if (typeof window !== "undefined") {
  window.CmdBpmnModelHelper = CmdBpmnModelHelper;
}

