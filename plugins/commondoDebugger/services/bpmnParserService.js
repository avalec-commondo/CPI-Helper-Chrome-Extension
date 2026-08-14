// ===========================================================================
// COMMNDO IS DEBUGGER - BPMN PARSER SERVICE (CmdBpmnParserService)
// ===========================================================================
// Extracts ProcessDirect channels, human-readable step names, parameters,
// and descriptions from iFlow models.
// - On Cloud Foundry: Uses Web Modeler REST JSON Diagram API (Zero-unzip, ultra-fast ~300ms)
// - On SAP Neo: Uses in-memory ZIP extraction (.iflw / .bpmn XML + parameters.prop)

const CmdBpmnParserService = {
  /**
   * Retrieves and parses the BPMN model and parameters for any iFlow.
   * Cached in CmdStateStore.
   * @param {string} iflowId - Technical iFlow ID
   * @param {string} passedPkgId - Package ID if known
   * @param {boolean} forceRefresh - Ignore cache if true
   * @returns {Promise<{ iflowId: string, flowName: string, flowDescription: string, outbound: Array, inbound: Array, steps: Object, paramMap: Object }>}
   */
  async getModel(iflowId, passedPkgId = null, forceRefresh = false) {
    if (!iflowId) {
      return { iflowId: "", flowName: "", flowDescription: "", outbound: [], inbound: [], steps: {}, paramMap: {} };
    }

    const store = typeof CmdStateStore !== "undefined" ? CmdStateStore : null;
    if (!forceRefresh && store) {
      const cached = store.getCachedBpmnModel(iflowId);
      if (cached) return cached;
    }

    const api = typeof CmdApiClient !== "undefined" ? CmdApiClient : null;
    if (!api) {
      return { iflowId, flowName: iflowId, flowDescription: "", outbound: [], inbound: [], steps: {}, paramMap: {} };
    }

    const isNeo = api.isNeo();
    const pkgId = passedPkgId || (await api.resolveCurrentPackageId(iflowId));
    let modelResult = null;

    // 1. Cloud Foundry: Modeler JSON Diagram API
    if (!isNeo) {
      try {
        const modelJson = await api.fetchModelerJson(iflowId, pkgId);
        if (modelJson) {
          modelResult = this.parseModelerJson(iflowId, modelJson);
        }
      } catch (eCf) {
        console.warn(`[CmdBpmnParserService] CF Modeler JSON extraction failed for ${iflowId}:`, eCf);
      }
    }

    // 2. SAP Neo / Fallback: In-memory ZIP archive ($value)
    if (!modelResult && isNeo) {
      try {
        const zipBuf = await api.fetchArtifactZip(iflowId, "active");
        if (zipBuf && typeof JSZip !== "undefined") {
          modelResult = await this.parseZipBuffer(iflowId, zipBuf);
        }
      } catch (eZip) {
        console.warn(`[CmdBpmnParserService] ZIP download extraction failed for ${iflowId}:`, eZip);
      }
    }

    // Default fallback if parsing produced no model
    if (!modelResult) {
      modelResult = {
        iflowId,
        flowName: iflowId,
        flowDescription: "",
        outbound: [],
        inbound: [],
        steps: {},
        paramMap: {},
      };
    }

    if (store) {
      store.setCachedBpmnModel(iflowId, modelResult);
      if (modelResult.flowName && modelResult.flowName !== iflowId) {
        store.registerArtifactName(iflowId, modelResult.flowName);
      }
    }

    return modelResult;
  },

  /**
   * Parses Cloud Foundry Web Modeler JSON diagram structure.
   */
  parseModelerJson(iflowId, modelJson) {
    const outbound = [];
    const inbound = [];
    const steps = {};
    const paramMap = {};
    const exceptionShapes = {};

    // 1. Extract Step Names and Exception Subprocess shapes
    function extractShapes(obj, inExceptionScope = false) {
      if (!obj || typeof obj !== "object") return;
      const props = obj.properties || obj.attributes || {};
      const id = obj.id || obj.resourceId || "";
      const name = (props.name || obj.name?.value || obj.name || "").trim();
      const activityType = String(props.activityType || props.type || obj.type || "");

      const isException = inExceptionScope ||
        activityType.toLowerCase().includes("errorstart") ||
        activityType.toLowerCase().includes("exceptionsubprocess") ||
        name.toLowerCase().includes("exception subprocess") ||
        name.toLowerCase().includes("error subprocess") ||
        String(props.isException || "").toLowerCase() === "true" ||
        String(props.triggeredByEvent || "").toLowerCase() === "true";

      if (id) {
        if (name && name !== id) {
          steps[id] = name;
          steps[id.toLowerCase()] = name;
        }
        if (isException) {
          exceptionShapes[id] = true;
          exceptionShapes[id.toLowerCase()] = true;
        }
      }

      if (props.activityType === "ProcessDirect" || props.adapterType === "ProcessDirect" || obj.adapterType === "ProcessDirect" || (props.address && String(props.address).startsWith("/"))) {
        const addr = props.address || props.senderAddress || props.receiverAddress || "";
        if (addr) {
          const rawDir = String(obj.direction || props.direction || "").toUpperCase();
          const isSender = rawDir.includes("SENDER") || rawDir.includes("INBOUND") || Boolean(props.senderAddress) || String(props.name || "").toLowerCase().includes("start");
          const chan = { id: id || `shape_${Math.random()}`, name: name || id, componentType: "ProcessDirect", address: addr };
          if (isSender) {
            if (!inbound.some((i) => i.address === chan.address)) inbound.push(chan);
          } else {
            if (!outbound.some((o) => o.address === chan.address)) outbound.push(chan);
          }
        }
      } else if (props.senderAddress) {
        const chan = { id: id || `in_${Math.random()}`, name: name || id, componentType: "ProcessDirect", address: props.senderAddress };
        if (!inbound.some((i) => i.address === chan.address)) inbound.push(chan);
      }

      const childItems = Array.isArray(obj)
        ? obj
        : (obj.childShapes || obj.shapes || obj.children || (typeof obj === "object" ? Object.values(obj) : []));
      if (Array.isArray(childItems)) {
        childItems.forEach((child) => extractShapes(child, isException));
      }
    }
    extractShapes(modelJson.bpmnModel?.shapes || modelJson.shapes || modelJson);

    // 2. Recursively collect ProcessDirect channel connections
    function collectChannels(obj, collected = []) {
      if (!obj || typeof obj !== "object") return collected;
      if (obj.ITYPE === "DEFAULT_CHANNEL" || (obj.adapterType && (obj.allAttributes || obj.address || obj.direction)) || obj.type === "Connection") {
        collected.push(obj);
      }
      if (Array.isArray(obj)) {
        for (const item of obj) collectChannels(item, collected);
      } else {
        for (const k of Object.keys(obj)) {
          collectChannels(obj[k], collected);
        }
      }
      return collected;
    }

    const rawChannels = collectChannels(modelJson);
    const channelMap = new Map();

    rawChannels.forEach((c) => {
      const chanId = String(c.id || c.channelId || "");
      const rawAdapter = typeof c.adapterType === "object" ? c.adapterType?.value : c.adapterType;
      const adapterType = String(rawAdapter || c.attributes?.name || (typeof c.name === "object" ? c.name?.value : c.name) || "").toLowerCase();
      const chanName = String((typeof c.name === "object" ? c.name?.value : c.name) || c.attributes?.name || chanId || "");
      const rawDir = typeof c.direction === "object" ? c.direction?.value : c.direction;
      let direction = String(rawDir || "").toUpperCase();
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
          channelMap.set(chanId, { id: chanId, name: chanName, componentType: "ProcessDirect", address, isSender });
        } else if (address) {
          const chan = { id: chanId || `pd_${Math.random()}`, name: chanName, componentType: "ProcessDirect", address };
          if (isSender) {
            if (!inbound.some((i) => i.address === address)) inbound.push(chan);
          } else {
            if (!outbound.some((o) => o.address === address)) outbound.push(chan);
          }
        }
      }
    });

    channelMap.forEach((chan) => {
      if (chan.isSender) {
        if (!inbound.some((i) => i.address === chan.address)) inbound.push(chan);
      } else {
        if (!outbound.some((o) => o.address === chan.address)) outbound.push(chan);
      }
    });

    const flowName = modelJson.name || modelJson.attributes?.name || iflowId;
    const flowDescription = modelJson.description || modelJson.attributes?.description || "";

    return {
      iflowId,
      flowName,
      flowDescription,
      outbound,
      inbound,
      steps,
      paramMap,
      exceptionShapes: exceptionShapes || {},
    };
  },

  /**
   * Parses in-memory ZIP buffer containing BPMN XML (.iflw) and parameters.prop.
   */
  async parseZipBuffer(iflowId, arrayBuffer) {
    if (!arrayBuffer || typeof JSZip === "undefined") return null;

    const zip = await JSZip.loadAsync(arrayBuffer);
    const paramMap = {};
    let flowName = "";
    let flowDescription = "";

    // 1. Parse parameters.prop using CmdUtils.unescapeJavaProperty
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
              if (typeof CmdUtils !== "undefined") v = CmdUtils.unescapeJavaProperty(v);
              paramMap[k] = v;
            }
          }
        });
      } catch (eProp) {}
    }

    // 2. Parse parameters.propdef defaults
    const propDefFile = Object.keys(zip.files).find((fn) => fn.endsWith("parameters.propdef"));
    if (propDefFile && typeof DOMParser !== "undefined") {
      try {
        const defText = await zip.files[propDefFile].async("string");
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(defText, "text/xml");
        const paramEls = [...xmlDoc.getElementsByTagName("parameter"), ...xmlDoc.getElementsByTagName("param")];
        for (let i = 0; i < paramEls.length; i++) {
          const p = paramEls[i];
          const nameEl = p.getElementsByTagName("name")[0] || p.querySelector("name");
          const valEl = p.getElementsByTagName("value")[0] || p.getElementsByTagName("defaultValue")[0] || p.querySelector("value") || p.querySelector("defaultValue");
          const id = nameEl ? nameEl.textContent.trim() : (p.getAttribute("id") || p.getAttribute("name") || "").trim();
          const defVal = valEl ? valEl.textContent.trim() : (p.getAttribute("defaultValue") || p.getAttribute("value") || p.getAttribute("default") || "").trim();
          if (id && defVal && !paramMap[id]) {
            paramMap[id] = defVal;
          }
        }
      } catch (eDef) {}
    }

    // 3. Extract metainfo.prop
    const metaFile = Object.keys(zip.files).find((fn) => fn.endsWith("metainfo.prop"));
    if (metaFile) {
      try {
        const metaText = await zip.files[metaFile].async("string");
        metaText.split(/\r?\n/).forEach((line) => {
          const trimmed = line.trim();
          if (trimmed.startsWith("name=")) flowName = trimmed.substring(5).trim();
          if (trimmed.startsWith("description=")) flowDescription = trimmed.substring(12).trim();
        });
      } catch (eMeta) {}
    }

    // 4. Parse BPMN scenario flow XML
    const iflwFile = Object.keys(zip.files).find((fn) => fn.endsWith(".iflw") || fn.endsWith(".bpmn") || fn.includes("scenarioflows"));
    if (!iflwFile) {
      return { iflowId, flowName: flowName || iflowId, flowDescription, outbound: [], inbound: [], steps: {}, paramMap };
    }

    const xmlContent = await zip.files[iflwFile].async("string");
    return this.parseBpmnXml(iflowId, xmlContent, paramMap, flowName, flowDescription);
  },

  /**
   * Parses BPMN 2.0 XML string.
   */
  parseBpmnXml(iflowId, xmlString, paramMap = {}, initialName = "", initialDesc = "") {
    if (!xmlString || typeof DOMParser === "undefined") {
      return { iflowId, flowName: initialName || iflowId, flowDescription: initialDesc, outbound: [], inbound: [], steps: {}, paramMap };
    }

    const outbound = [];
    const inbound = [];
    const steps = {};
    let flowName = initialName;
    let flowDescription = initialDesc;

    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlString, "text/xml");

      if (!flowName) {
        const collabs = xmlDoc.getElementsByTagNameNS("*", "collaboration");
        for (let c = 0; c < collabs.length; c++) {
          const cn = collabs[c].getAttribute("name");
          if (cn && cn.trim() && cn !== collabs[c].getAttribute("id") && cn !== "Default Collaboration") {
            flowName = cn.trim();
            break;
          }
        }
      }

      if (!flowDescription) {
        const docs = xmlDoc.getElementsByTagNameNS("*", "documentation");
        if (docs.length > 0) {
          const dt = docs[0].textContent.trim();
          if (dt) flowDescription = dt;
        }
      }

      // Step names
      const allEls = xmlDoc.getElementsByTagName("*");
      for (let i = 0; i < allEls.length; i++) {
        const el = allEls[i];
        const id = el.getAttribute("id");
        const name = el.getAttribute("name");
        if (id && name && name.trim() && name !== id) {
          steps[id] = name.trim();
          steps[id.toLowerCase()] = name.trim();
        }
      }

      // MessageFlows
      const messageFlows = xmlDoc.getElementsByTagNameNS("*", "messageFlow");
      for (let i = 0; i < messageFlows.length; i++) {
        const mf = messageFlows[i];
        const mfId = mf.getAttribute("id") || "";
        const mfName = mf.getAttribute("name") || mfId;
        if (mfId && mfName && mfName !== mfId) {
          steps[mfId] = mfName.trim();
          steps[mfId.toLowerCase()] = mfName.trim();
        }

        const props = mf.getElementsByTagNameNS("*", "property");
        const sourceRef = (mf.getAttribute("sourceRef") || "").toLowerCase();
        const targetRef = (mf.getAttribute("targetRef") || "").toLowerCase();
        let componentType = "";
        let address = "";
        let direction = "";
        let cmdVariantUri = "";

        for (let pIdx = 0; pIdx < props.length; pIdx++) {
          const p = props[pIdx];
          const keyEl = p.getElementsByTagNameNS("*", "key")[0] || p.querySelector("key");
          const valEl = p.getElementsByTagNameNS("*", "value")[0] || p.querySelector("value");
          const k = keyEl ? keyEl.textContent.trim() : (p.getAttribute("key") || p.getAttribute("name") || "").trim();
          const v = valEl ? valEl.textContent.trim() : (p.getAttribute("value") || "").trim();
          if (k.toLowerCase() === "componenttype" || k.toLowerCase() === "adaptertype") componentType = v;
          if (k.toLowerCase() === "address" || k.toLowerCase() === "url") address = v;
          if (k.toLowerCase() === "direction") direction = v.toUpperCase();
          if (k.toLowerCase() === "cmdvarianturi" || k.toLowerCase() === "cmdvariant") cmdVariantUri = v.toLowerCase();
        }

        const rawAddress = address;
        const paramMatch = address.match(/^\{\{\s*([a-zA-Z0-9_.\-]+)\s*\}\}$/);
        if (paramMatch && paramMap[paramMatch[1]]) {
          address = paramMap[paramMatch[1]];
        }

        const isProcessDirect =
          componentType.toLowerCase() === "processdirect" ||
          mfName.toLowerCase().includes("processdirect") ||
          cmdVariantUri.toLowerCase().includes("processdirect");

        let isSender = false;
        if (direction.includes("SENDER") || direction.includes("INBOUND") || cmdVariantUri.includes("/sender/") || cmdVariantUri.includes("::sender")) {
          isSender = true;
        } else if (targetRef.includes("startevent") || (sourceRef.includes("participant") && !targetRef.includes("participant"))) {
          isSender = true;
        }

        if (isProcessDirect && address) {
          const chan = {
            id: mfId,
            name: mfName,
            componentType: "ProcessDirect",
            address,
            rawAddress,
            sourceRef: mf.getAttribute("sourceRef") || "",
            targetRef: mf.getAttribute("targetRef") || "",
          };

          if (isSender) inbound.push(chan);
          else outbound.push(chan);
        }
      }

      // Exception Subprocesses & Error Start Events
      const subProcesses = xmlDoc.getElementsByTagNameNS("*", "subProcess");
      const exceptionShapes = {};

      for (let sIdx = 0; sIdx < subProcesses.length; sIdx++) {
        const sp = subProcesses[sIdx];
        const isEventSub = sp.getAttribute("triggeredByEvent") === "true";
        const hasErrorStart = sp.getElementsByTagNameNS("*", "errorStartEvent").length > 0 ||
                              sp.getElementsByTagNameNS("*", "errorEventDefinition").length > 0;
        const spName = (sp.getAttribute("name") || "").toLowerCase();
        if (isEventSub || hasErrorStart || spName.includes("exception") || spName.includes("error")) {
          const spId = sp.getAttribute("id");
          if (spId) {
            exceptionShapes[spId] = true;
            exceptionShapes[spId.toLowerCase()] = true;
          }
          const innerEls = sp.getElementsByTagName("*");
          for (let eIdx = 0; eIdx < innerEls.length; eIdx++) {
            const eid = innerEls[eIdx].getAttribute("id");
            if (eid) {
              exceptionShapes[eid] = true;
              exceptionShapes[eid.toLowerCase()] = true;
            }
          }
        }
      }

      // Also check individual error start events
      const errStarts = xmlDoc.getElementsByTagNameNS("*", "errorStartEvent");
      for (let esIdx = 0; esIdx < errStarts.length; esIdx++) {
        const esId = errStarts[esIdx].getAttribute("id");
        if (esId) {
          exceptionShapes[esId] = true;
          exceptionShapes[esId.toLowerCase()] = true;
        }
      }
    } catch (eXml) {
      console.warn(`[CmdBpmnParserService] Error parsing BPMN XML for ${iflowId}:`, eXml);
    }

    return {
      iflowId,
      flowName: flowName || iflowId,
      flowDescription: flowDescription || "",
      outbound,
      inbound,
      steps,
      paramMap,
      exceptionShapes: typeof exceptionShapes !== "undefined" ? exceptionShapes : {},
    };
  },
};

// Expose globally
if (typeof window !== "undefined") {
  window.CmdBpmnParserService = CmdBpmnParserService;
}
if (typeof global !== "undefined") {
  global.CmdBpmnParserService = CmdBpmnParserService;
}
