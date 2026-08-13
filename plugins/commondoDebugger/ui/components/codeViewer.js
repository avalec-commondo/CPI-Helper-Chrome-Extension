// ===========================================================================
// COMMNDO IS DEBUGGER - CODE & PAYLOAD VIEWER (CmdCodeViewer)
// ===========================================================================
// Reusable component for formatting, syntax highlighting, and inspecting
// XML, JSON, Groovy, JavaScript, and raw text payloads with copy-to-clipboard.

const CmdCodeViewer = {
  /**
   * Formats JSON or XML string into readable indented format.
   */
  formatPayload(rawContent) {
    if (!rawContent) return "";
    if (typeof rawContent === "object") {
      try {
        return JSON.stringify(rawContent, null, 2);
      } catch (e) {
        return String(rawContent);
      }
    }

    const trimmed = String(rawContent).trim();

    // Check if JSON
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      try {
        const parsed = JSON.parse(trimmed);
        return JSON.stringify(parsed, null, 2);
      } catch (e) {
        return trimmed;
      }
    }

    // Check if XML
    if (trimmed.startsWith("<") && trimmed.endsWith(">")) {
      return this.formatXml(trimmed);
    }

    return trimmed;
  },

  /**
   * Simple XML string indenter.
   */
  formatXml(xml) {
    let formatted = "";
    let indent = "";
    const tab = "  ";
    xml.split(/>\s*</).forEach((node) => {
      if (node.match(/^\/\w/)) indent = indent.substring(tab.length);
      formatted += indent + "<" + node + ">\r\n";
      if (node.match(/^<?\w[^>]*[^\/]$/)) indent += tab;
    });
    return formatted.substring(1, formatted.length - 3);
  },

  /**
   * Renders the payload viewer container with action toolbar (Copy, Wrap, Clear).
   */
  renderViewer(container, content, title = "Payload", options = {}) {
    if (!container) return;
    const formatted = this.formatPayload(content);
    const utils = typeof CmdUtils !== "undefined" ? CmdUtils : {};
    const escapeHtml = utils.escapeHtml || ((s) => s || "");

    container.innerHTML = `
      <div class="cmd-code-viewer" style="display: flex; flex-direction: column; background: #0f172a; border-radius: 6px; overflow: hidden; border: 1px solid #334155; font-family: monospace; font-size: 0.78rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; background: #1e293b; padding: 6px 12px; border-bottom: 1px solid #334155;">
          <span style="color: #94a3b8; font-weight: 600; font-size: 0.75rem;">${escapeHtml(title)}</span>
          <div style="display: flex; gap: 6px;">
            <button class="ui mini button cmd-code-copy-btn" style="padding: 3px 8px; font-size: 0.72rem; margin: 0; background: #334155; color: #f8fafc;">Copy</button>
            <button class="ui mini button cmd-code-wrap-btn" style="padding: 3px 8px; font-size: 0.72rem; margin: 0; background: #334155; color: #f8fafc;">Wrap</button>
          </div>
        </div>
        <pre class="cmd-code-pre" style="margin: 0; padding: 10px; color: #f8fafc; overflow: auto; max-height: ${options.maxHeight || "260px"}; white-space: pre; line-height: 1.45; font-size: 0.78rem;"><code>${escapeHtml(formatted)}</code></pre>
      </div>
    `;

    const copyBtn = container.querySelector(".cmd-code-copy-btn");
    const wrapBtn = container.querySelector(".cmd-code-wrap-btn");
    const pre = container.querySelector(".cmd-code-pre");

    if (copyBtn) {
      copyBtn.onclick = () => {
        if (navigator.clipboard) {
          navigator.clipboard.writeText(formatted);
          copyBtn.innerText = "Copied!";
          setTimeout(() => (copyBtn.innerText = "Copy"), 1500);
        }
      };
    }

    if (wrapBtn && pre) {
      let isWrapped = false;
      wrapBtn.onclick = () => {
        isWrapped = !isWrapped;
        pre.style.whiteSpace = isWrapped ? "pre-wrap" : "pre";
        wrapBtn.innerText = isWrapped ? "No-Wrap" : "Wrap";
      };
    }
  },

  /**
   * Renders a key-value table for Exchange Properties or Headers.
   */
  renderPropertyTable(container, items = [], title = "Properties") {
    if (!container) return;
    const utils = typeof CmdUtils !== "undefined" ? CmdUtils : {};
    const escapeHtml = utils.escapeHtml || ((s) => s || "");

    if (!items || items.length === 0) {
      container.innerHTML = `<div style="color: #94a3b8; font-size: 0.8rem; font-style: italic; padding: 6px;">No ${escapeHtml(title).toLowerCase()} recorded for this step.</div>`;
      return;
    }

    const rows = items
      .map(
        (item) => `
        <tr style="border-bottom: 1px solid #334155;">
          <td style="padding: 6px 10px; font-weight: 600; color: #38bdf8; font-family: monospace; font-size: 0.76rem; word-break: break-all;">${escapeHtml(item.Name || item.name || "")}</td>
          <td style="padding: 6px 10px; color: #e2e8f0; font-family: monospace; font-size: 0.76rem; word-break: break-all; max-width: 320px;">${escapeHtml(item.Value || item.value || "")}</td>
        </tr>
      `
      )
      .join("");

    container.innerHTML = `
      <div style="background: #0f172a; border-radius: 6px; overflow: hidden; border: 1px solid #334155;">
        <table style="width: 100%; border-collapse: collapse; text-align: left;">
          <thead>
            <tr style="background: #1e293b; border-bottom: 1px solid #334155;">
              <th style="padding: 6px 10px; font-size: 0.72rem; color: #94a3b8; width: 40%;">Name</th>
              <th style="padding: 6px 10px; font-size: 0.72rem; color: #94a3b8; width: 60%;">Value</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    `;
  },
};

// Expose globally
if (typeof window !== "undefined") {
  window.CmdCodeViewer = CmdCodeViewer;
}
if (typeof global !== "undefined") {
  global.CmdCodeViewer = CmdCodeViewer;
}
