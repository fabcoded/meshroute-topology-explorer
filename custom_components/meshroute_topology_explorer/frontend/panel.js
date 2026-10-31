// SPDX-License-Identifier: MIT
// Entry module of the Meshroute Topology Explorer panel (skeleton: status line and device list, no map yet).
// Home Assistant loads it as a custom panel and sets `hass`, `narrow` and `panel` on the element (spec 10).
// Only read-only websocket commands from spec 3.4 are used. Names are always set with textContent, never as HTML.
import { computeStatus, deviceRows, blockingState } from "./status.js";

// Must equal the version in manifest.json and const.py (tests/test_integration_files.py).
const VERSION = "0.1.0";
const ELEMENT = "meshroute-topology-explorer";

class MeshrouteTopologyExplorer extends HTMLElement {
  constructor() {
    super();
    this._hass = null;
    this._loadStarted = false;
    this._state = { phase: "loading" };
    this._root = this.attachShadow({ mode: "open" });
    this._panel = null;
    this.narrow = false;
  }

  // Home Assistant assigns a new hass object on every state change. Only the first one starts loading, so a busy
  // house does not make the panel refetch every table (spec 10).
  set hass(value) {
    this._hass = value;
    if (!this._loadStarted && this.isConnected) this._load();
  }
  get hass() { return this._hass; }

  set panel(value) {
    this._panel = value;
    this._render();
  }
  get panel() { return this._panel; }

  connectedCallback() {
    if (this._hass && !this._loadStarted) this._load();
    this._render();
  }

  async _load() {
    this._loadStarted = true;
    this._state = { phase: "loading" };
    this._render();
    try {
      const hass = this._hass;
      const isAdmin = Boolean(hass.user && hass.user.is_admin);
      // Check first: the zha/* commands are admin only and fail on a missing integration.
      const configEntries = isAdmin ? await hass.callWS({ type: "config_entries/get", domain: "zha" }) : [];
      const blocked = blockingState({ isAdmin, configEntries });
      if (blocked) {
        this._state = { phase: blocked };
      } else {
        const devices = await hass.callWS({ type: "zha/devices" });
        this._state = { phase: "ready", status: computeStatus(devices), rows: deviceRows(devices) };
      }
    } catch (err) {
      this._state = { phase: "error", message: String((err && err.message) || err) };
    }
    this._render();
  }

  _reload() {
    if (this._hass) this._load();
  }

  _render() {
    const root = this._root;
    root.replaceChildren();
    const style = document.createElement("style");
    // Theme variables with fallbacks, so the panel is readable even outside Home Assistant (tests, preview).
    style.textContent = `
      :host { display: block; padding: 16px; box-sizing: border-box; min-height: 100%;
        background: var(--primary-background-color, #fff); color: var(--primary-text-color, #212121);
        font-family: var(--paper-font-body1_-_font-family, sans-serif); }
      h1 { font-size: 1.4em; margin: 0 0 12px; font-weight: 400; }
      .status { margin: 0 0 16px; padding: 8px 12px; border-left: 4px solid var(--primary-color, #03a9f4);
        background: var(--secondary-background-color, #f5f5f5); }
      .warn { border-left-color: var(--warning-color, #ff9800); }
      .error { border-left-color: var(--error-color, #db4437); }
      button { font: inherit; padding: 6px 14px; cursor: pointer; color: var(--primary-text-color, #212121);
        background: var(--card-background-color, #fff); border: 1px solid var(--divider-color, #bbb); border-radius: 4px; }
      button:focus-visible, ul:focus-visible { outline: 2px solid var(--primary-color, #03a9f4); outline-offset: 2px; }
      table { border-collapse: collapse; width: 100%; max-width: 48em; }
      th, td { text-align: left; padding: 4px 12px 4px 0; border-bottom: 1px solid var(--divider-color, #ddd); }
    `;
    root.append(style);

    const h1 = document.createElement("h1");
    h1.textContent = "Meshroute Topology Explorer";
    root.append(h1);

    const mismatch = this._panel && this._panel.config && this._panel.config.version !== VERSION;
    if (mismatch) {
      root.append(this._message("The panel files in your browser are out of date: please reload the page.", "warn"));
      return;
    }

    const st = this._state;
    if (st.phase === "loading") {
      root.append(this._message("Loading ..."));
    } else if (st.phase === "not_admin") {
      root.append(this._message("This panel needs an administrator account.", "warn"));
    } else if (st.phase === "zha_not_loaded") {
      root.append(this._message("ZHA is not loaded. Set up the Zigbee Home Automation integration first.", "warn"));
    } else if (st.phase === "error") {
      root.append(this._message(`Connection problem: ${st.message}`, "error"));
      root.append(this._reloadButton());
    } else if (st.phase === "ready") {
      this._renderReady(st);
    }
  }

  _message(text, kind = "") {
    const p = document.createElement("p");
    p.className = `status ${kind}`.trim();
    p.setAttribute("role", kind === "error" ? "alert" : "status");
    p.textContent = text;
    return p;
  }

  _reloadButton() {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = "Reload";
    b.addEventListener("click", () => this._reload());
    return b;
  }

  _renderReady({ status, rows }) {
    const root = this._root;
    if (status.devices === 0) {
      root.append(this._message("No devices yet."));
      root.append(this._reloadButton());
      return;
    }
    const line = `Source: ${status.source} · tables ${status.routersWithTable} of ${status.routers} · ` +
      `devices in a table ${status.devicesInTable} of ${status.devices} · unavailable ${status.unavailable}`;
    root.append(this._message(line));
    root.append(this._reloadButton());

    const table = document.createElement("table");
    const caption = document.createElement("caption");
    caption.textContent = "Devices";
    caption.style.textAlign = "left";
    table.append(caption);
    const head = table.createTHead().insertRow();
    for (const label of ["Name", "Role", "Available"]) {
      const th = document.createElement("th");
      th.scope = "col";
      th.textContent = label;
      head.append(th);
    }
    const body = table.createTBody();
    for (const r of rows) {
      const tr = body.insertRow();
      tr.insertCell().textContent = r.name;
      tr.insertCell().textContent = r.role;
      tr.insertCell().textContent = r.available ? "yes" : "no";
    }
    root.append(table);
  }
}

// Defined only if free: a second load of the module (or another add-on) must not throw.
if (!customElements.get(ELEMENT)) customElements.define(ELEMENT, MeshrouteTopologyExplorer);
