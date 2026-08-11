# Commondo IS Debugger - Plugin Architecture & SAP CPI API Endpoints

This document provides a comprehensive technical reference for the **Commondo IS Debugger** plugin, including its modular architecture, directory structure, and all REST / OData endpoints utilized across both **SAP Neo** and **SAP BTP Cloud Foundry (SAP Integration Suite)** environments.

---

## 🏗️ 1. Architecture Overview

The plugin follows a modular separation of concerns designed for easy extensibility:

```text
plugins/commondoDebugger/
├── README.md                                 # Technical documentation & API references
├── commondoDebugger.js                       # Main coordinator, plugin registration & modal UI
├── helpers/                                  # Reusable core utilities & API layers
│   ├── cpiApiHelper.js                       # Universal OData/REST calls, package GUIDs, artifact fetchers
│   ├── bpmnModelHelper.js                    # ZIP download, BPMN XML parsing, parameters.prop resolver
│   ├── tracePayloadHelper.js                 # Trace messages, step properties, headers, body, log content
│   └── zipExportHelper.js                    # Full trace ZIP exporter & manifest generator
└── features/                                 # Feature modules
    ├── processDirectDiscovery.js             # BFS queue traversal engine & ASCII tree test runner
    ├── traceManager.js                       # Trace manager modal & multi-flow log level setter
    ├── topologyGraph.js                      # SVG Multi-Column Map & Pan/Zoom canvas
    └── stepInspector.js                      # Execution step list, payload viewer & Log Content table
```

---

## 🌐 2. SAP CPI Endpoint Reference (Neo vs Cloud Foundry)

### A. Environment Identification & API URL Construction

| Concept | SAP Neo | SAP BTP Cloud Foundry / Integration Suite |
| :--- | :--- | :--- |
| **Host Pattern** | `https://<tenant>-tmn.hci.<region>.hana.ondemand.com` | `https://<tenant>.integrationsuite.cfapps.<region>.hana.ondemand.com` |
| **Base WebUI Path** | `/itspaces/` | `/` or `/shell/` |
| **OData Runtime Base** | `/itspaces/api/1.0/` or `/api/1.0/` | `/api/v1/` or `/odata/api/v1/` |
| **Workspace Base** | `/itspaces/odata/1.0/workspace.svc/` | `/api/1.0/workspace/` |

---

### B. Artifact & Package Discovery Endpoints

#### 1. List Package Artifacts
* **Neo (OData v1.0 Workspace):**
  ```http
  GET /itspaces/odata/1.0/workspace.svc/ContentPackages('{packageId}')/Artifacts?$format=json
  ```
* **Cloud Foundry / Suite (OData v1):**
  ```http
  GET /api/v1/IntegrationPackages('{packageId}')/IntegrationDesigntimeArtifacts?$format=json
  ```
* **Universal Workspace REST API:**
  ```http
  GET /api/1.0/workspace/{workspaceGuid}/artifacts?$format=json
  ```

#### 2. Workspace GUID Resolution (Cloud Foundry)
* **REST API:**
  ```http
  GET /api/1.0/workspace/
  ```
  *Returns mapping of technical package names to internal workspace GUIDs.*

#### 3. List All Deployed Tenant Artifacts
* **Primary (WebUI Command):**
  ```http
  GET /itspaces/Operations/com.sap.it.op.tmn.commands.dashboard.webui.IntegrationComponentsListCommand
  ```
* **Fallback (OData Runtime):**
  ```http
  GET /api/v1/IntegrationRuntimeArtifacts?$format=json&$select=Id,Name
  ```

---

### C. BPMN Model & Configuration Downloads

#### 1. Binary Artifact ZIP Bundle (`.iflw`, `parameters.prop`, scripts)
* **Cloud Foundry / Suite (Designtime Artifacts):**
  ```http
  GET /itspaces/odata/api/v1/IntegrationDesigntimeArtifacts(Id='{iflowId}',Version='active')/$value
  GET /api/v1/IntegrationDesigntimeArtifacts(Id='{iflowId}',Version='active')/$value
  ```
* **Neo (Workspace Content Entities):**
  ```http
  GET /itspaces/odata/1.0/workspace.svc/ContentEntities.Artifacts(Name='{iflowId}',Type='IFlow')/$value
  GET /itspaces/odata/1.0/workspace.svc/ContentPackages('{pkgId}')/Artifacts('{iflowId}')/$value
  ```
* **Universal Workspace REST Download:**
  ```http
  GET /api/1.0/workspace/{workspaceGuid}/artifacts/{iflowId}/download
  ```

#### 2. Direct JSON iFlow Model (Fallback)
* **REST Workspace API:**
  ```http
  GET /api/1.0/workspace/{workspaceGuid}/artifacts/{iflowId}/entities/{iflowId}/iflows/{iflowId}?$format=json
  GET /api/1.0/workspace/artifacts/{iflowId}/iflow?$format=json
  ```

---

### D. Trace & Message Processing Endpoints

#### 1. Recent Message Processing Logs
```http
GET /api/v1/MessageProcessingLogs?$top=50&$orderby=LogStart desc&$format=json
```

#### 2. Step Executions for a Message
```http
GET /api/v1/MessageProcessingLogs('{messageGuid}')/Runs?$format=json&$expand=RunSteps
```

#### 3. Step Trace Message Payload Body
```http
GET /api/v1/TraceMessages({traceId})/$value
```

#### 4. Step Trace Exchange Properties
```http
GET /api/v1/TraceMessages({traceId})/ExchangeProperties?$format=json
GET /api/v1/TraceMessages({traceId})/Properties?$format=json
```

#### 5. Set Log Level (Activate TRACE)
```http
PUT /api/v1/IntegrationRuntimeArtifacts('{iflowId}')
Content-Type: application/json

{
  "LogLevel": "TRACE"
}
```

---

## 🧩 3. How to Add a New Feature

1. Create your feature file in `plugins/commondoDebugger/features/myNewFeature.js`.
2. Wrap in an IIFE and expose your feature on `window`:
   ```javascript
   (function (window) {
     "use strict";

     function myFeatureAction() {
       // Access shared helpers:
       // window.CmdCpiApiHelper
       // window.CmdBpmnModelHelper
       // window.CmdTracePayloadHelper
       // window.CmdZipExportHelper
     }

     window.CmdMyNewFeature = {
       myFeatureAction,
     };
   })(window);
   ```
3. Register the new script in `manifest.json`.
4. Call `window.CmdMyNewFeature.myFeatureAction()` from `commondoDebugger.js` or UI event handlers.
