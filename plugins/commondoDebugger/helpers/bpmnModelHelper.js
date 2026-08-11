// ===========================================================================
// COMMODNO IS DEBUGGER - BPMN MODEL HELPER
// ===========================================================================
// Downloads and extracts iFlow ZIP bundles, parses BPMN XML,
// resolves externalized parameters.prop, and maps ProcessDirect channels.
// Fully compatible with both SAP Neo and SAP BTP Cloud Foundry / Integration Suite.

const iflowStepNameCache = new Map();
const iflowBpmnModelCache = new Map();

const CmdBpmnModelHelper = {
  /**
   * Downloads and parses the BPMN XML model and parameters.prop for any iFlow.
   */
  async fetchIFlowBpmnModel(iflowId, passedPkgId = null) {
    if (!iflowId) return { iflowId: "", outbound: [], inbound: [], steps: {} };
    if (iflowBpmnModelCache.has(iflowId)) {
      return iflowBpmnModelCache.get(iflowId);
    }

    let bpmnXml = null;
    let paramMap = {};

    const apiHelper = typeof CmdCpiApiHelper !== "undefined" ? CmdCpiApiHelper : {};
    const pkgName = passedPkgId || (await apiHelper.resolveCurrentPackageId(iflowId)) || "";
    const urlExt = typeof cpiData !== "undefined" && cpiData.urlExtension ? cpiData.urlExtension : "";
    const runtimeExt = typeof cpiData !== "undefined" && cpiData.runtimePathExtension ? cpiData.runtimePathExtension : "";

    // Helper to download ZIP and extract BPMN XML + parameters.prop
    async function tryDownloadZip(url) {
      try {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", url, true);
        xhr.responseType = "arraybuffer";
        const buf = await new Promise((resolve, reject) => {
          xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve(xhr.response) : reject(new Error(`HTTP ${xhr.status}`)));
          xhr.onerror = () => reject(new Error("Network error"));
          xhr.send();
        });

        if (buf && typeof JSZip !== "undefined") {
          const zip = await JSZip.loadAsync(buf);

          // 1. Parse parameters.prop (externalized configuration parameters)
          const propFile = Object.keys(zip.files).find((fn) => fn.endsWith("parameters.prop") || fn.includes("parameters.prop"));
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
            } catch (eProp) {}
          }

          // 2. Find BPMN scenario flow XML
          const iflw = Object.keys(zip.files).find((fn) => fn.endsWith(".iflw") || fn.endsWith(".bpmn") || fn.includes("scenarioflows"));
          if (iflw) {
            return await zip.files[iflw].async("string");
          }
        }
      } catch (e) {}
      return null;
    }

    const isNeoTenant = apiHelper.isNeo ? apiHelper.isNeo() : false;
    const wsGuid = (apiHelper.resolveWorkspaceGuid && pkgName) ? await apiHelper.resolveWorkspaceGuid(pkgName) : pkgName;
    const artGuid = (apiHelper.resolveArtifactGuid && pkgName) ? await apiHelper.resolveArtifactGuid(pkgName, iflowId) : iflowId;
    const tenant = (typeof cpiData !== "undefined" && cpiData.tenant) ? cpiData.tenant : window.location.host;

    // 1. PRIMARY METHOD FOR CLOUD FOUNDRY: Pure JSON Web Modeler Diagram (Zero-unzip, direct JSON, works in browser session)
    if (!isNeoTenant && pkgName && wsGuid && artGuid) {
      try {
        const modelUrls = [
          `https://${tenant}/api/1.0/workspace/${encodeURIComponent(wsGuid)}/artifacts/${encodeURIComponent(artGuid)}/entities/${encodeURIComponent(artGuid)}/iflows/${encodeURIComponent(iflowId)}?$format=json`,
          `/api/1.0/workspace/${encodeURIComponent(wsGuid)}/artifacts/${encodeURIComponent(artGuid)}/entities/${encodeURIComponent(artGuid)}/iflows/${encodeURIComponent(iflowId)}?$format=json`,
        ];

        let modelJson = null;
        for (const mu of modelUrls) {
          try {
            if (mu.startsWith("http")) {
              const resp = await fetch(mu, { method: "GET", headers: { Accept: "application/json" }, credentials: "include" });
              if (resp.ok) {
                modelJson = await resp.json();
                if (modelJson) break;
              }
            } else {
              const raw = await makeCallPromise("GET", mu, false, null, null, true, "application/json", true);
              modelJson = typeof raw === "string" ? JSON.parse(raw) : raw;
              if (modelJson) break;
            }
          } catch (eMu) {}
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
            const result = { iflowId, outbound, inbound, steps };
            iflowBpmnModelCache.set(iflowId, result);
            return result;
          }
        }
      } catch (eJson) {
        console.warn(`Pure JSON model extraction failed for ${iflowId}, falling back to ZIP:`, eJson);
      }
    }

    // 2. PRIMARY METHOD FOR NEO & ZIP FALLBACK: Candidate URLs for ZIP Archive
    const candidateUrls = isNeoTenant ? [
      `/${urlExt}odata/api/v1/IntegrationDesigntimeArtifacts(Id='${encodeURIComponent(iflowId)}',Version='active')/$value`,
      `/itspaces/odata/api/v1/IntegrationDesigntimeArtifacts(Id='${encodeURIComponent(iflowId)}',Version='active')/$value`,
      `/${urlExt}odata/1.0/workspace.svc/ContentEntities.Artifacts(Name='${encodeURIComponent(iflowId)}',Type='IFlow')/$value`,
      pkgName ? `/${urlExt}odata/1.0/workspace.svc/ContentPackages('${encodeURIComponent(pkgName)}')/Artifacts('${encodeURIComponent(iflowId)}')/$value` : null,
    ].filter(Boolean) : [
      (wsGuid && artGuid) ? `https://${tenant}/api/1.0/workspace/${encodeURIComponent(wsGuid)}/artifacts/${encodeURIComponent(artGuid)}/archive` : null,
      (wsGuid && artGuid) ? `/api/1.0/workspace/${encodeURIComponent(wsGuid)}/artifacts/${encodeURIComponent(artGuid)}/archive` : null,
      `/${urlExt}api/v1/IntegrationDesigntimeArtifacts(Id='${encodeURIComponent(iflowId)}',Version='active')/$value`,
      `/itspaces/api/v1/IntegrationDesigntimeArtifacts(Id='${encodeURIComponent(iflowId)}',Version='active')/$value`,
    ].filter(Boolean);

    for (const u of candidateUrls) {
      bpmnXml = await tryDownloadZip(u);
      if (bpmnXml) break;
    }

    // 2. If Version='active' returns 404 (Cloud Foundry numeric version requirement), query real version
    if (!bpmnXml) {
      try {
        const getApi = (typeof CmdCpiApiHelper !== "undefined" && CmdCpiApiHelper.getApiUrl) ? CmdCpiApiHelper.getApiUrl : window.getApiUrl;
        const metaUrls = [
          getApi ? getApi(`IntegrationDesigntimeArtifacts?$format=json&$filter=Id eq '${encodeURIComponent(iflowId)}'&$select=Id,Version`) : null,
          `/${urlExt}api/v1/IntegrationDesigntimeArtifacts?$format=json&$filter=Id eq '${encodeURIComponent(iflowId)}'`,
          `/${urlExt}odata/api/v1/IntegrationDesigntimeArtifacts?$format=json&$filter=Id eq '${encodeURIComponent(iflowId)}'`,
          `/itspaces/api/v1/IntegrationDesigntimeArtifacts?$format=json&$filter=Id eq '${encodeURIComponent(iflowId)}'`,
          `/itspaces/odata/api/v1/IntegrationDesigntimeArtifacts?$format=json&$filter=Id eq '${encodeURIComponent(iflowId)}'`,
        ].filter(Boolean);

        let realVersion = "";
        for (const mu of metaUrls) {
          try {
            const rawM = await makeCallPromise("GET", mu, false, null, null, false, null, true);
            const resM = typeof rawM === "string" ? JSON.parse(rawM) : rawM;
            const items = resM?.d?.results || resM?.value || (Array.isArray(resM) ? resM : []);
            if (items.length > 0 && items[0].Version) {
              realVersion = items[0].Version;
              break;
            }
          } catch (eM) {}
        }

        if (realVersion) {
          const versionUrls = [
            `/${urlExt}api/v1/IntegrationDesigntimeArtifacts(Id='${encodeURIComponent(iflowId)}',Version='${realVersion}')/$value`,
            `/${urlExt}odata/api/v1/IntegrationDesigntimeArtifacts(Id='${encodeURIComponent(iflowId)}',Version='${realVersion}')/$value`,
            `/itspaces/api/v1/IntegrationDesigntimeArtifacts(Id='${encodeURIComponent(iflowId)}',Version='${realVersion}')/$value`,
            `/itspaces/odata/api/v1/IntegrationDesigntimeArtifacts(Id='${encodeURIComponent(iflowId)}',Version='${realVersion}')/$value`,
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

    const result = { iflowId, outbound, inbound, steps };
    iflowBpmnModelCache.set(iflowId, result);
    return result;
  },
};
