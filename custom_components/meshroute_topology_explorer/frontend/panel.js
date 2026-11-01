// SPDX-License-Identifier: MIT
// Entry module of the Meshroute Topology Explorer panel: the quality view of a ZHA network (spec 6-11). Home
// Assistant loads it as a custom panel and sets `hass`, `narrow` and `panel` on the element (spec 10).
// Layout (spec 9.1; design by Fabian Schwamborn, 2026-11-01, "one place per thing"): no header bar; the map fills the
// panel. On the map only: top left "Devices" with the findings count and below it the slide switch "Details on click"
// (with the sidebar button on narrow screens), top right "View" and below it "Legend", the zoom group bottom right,
// the status line. Two panels: left (Devices, Findings, Details) and right (View, Legend), side panels on wide
// screens and bottom sheets on narrow ones (one sheet at a time).
// There is no view switch yet: the quality view is the only view of v1; the switch comes with the route view (v1.1).
// Data: ui/controller.js (load, errors, reconnect); settings: ui/settings.js; observations ("observed unchanged
// since", spec 6): ui/observations-client.js; the scan in debug mode: ui/scan.js; map: graph/graph-view.js.
// Only the websocket commands of spec 3.4 are used: read-only ones, the user-started scan and the user-started reading
// of a cluster's attributes (ui/cluster-dialog.js). Entity states and area names come from the hass object Home
// Assistant hands every panel (hass.states, hass.areas). Names are always set as text, never as HTML.
// Try it without Home Assistant: dev/panel.html.
import { GraphView } from "./graph/graph-view.js";
import { DENSITY } from "./graph/layout.js";
import { resolveTheme } from "./graph/palette.js";
import { normalizeIeee } from "./model/parse.js";
import { KINDS } from "./graph/symbols.js";
import { PanelController, readNetwork } from "./ui/controller.js";
import { ADAPTERS, adapterFor } from "./adapters/index.js";
import { engineFor } from "./engines/index.js";
import { confirmDialog } from "./ui/dialog.js";
import { SettingsClient, pinsForView, presentPins } from "./ui/settings.js";
import { afterSelect, detailsRequest, tabRequest, openOnSelect } from "./ui/drawer-rule.js";
import { languageOf, formatLocaleOf, translator, localize } from "./ui/i18n.js";
import { combinedInsets, drawerGeometry, floatingLayout, isWide } from "./ui/geometry.js";
import { MapButtons } from "./ui/map-buttons.js";
import { Drawer, LEFT_TABS, RIGHT_TABS } from "./ui/drawer.js";
import { DevicesTab } from "./ui/devices-tab.js";
import { renderFindings, markFindings } from "./ui/findings-tab.js";
import { renderLegend } from "./ui/legend-tab.js";
import { renderView } from "./ui/view-tab.js";
import { badgeCount } from "./ui/findings.js";
import { ageParts } from "./ui/status.js";
import { activeNetwork, DEFAULT_NETWORK, loadNetworkChoice, networkChoices, saveNetworkChoice, sourcePart }
  from "./ui/network-switch.js";
import { receptionText, roleText } from "./ui/format.js";
import { readTheme, themeKey } from "./ui/theme.js";
import { h, iconButton } from "./ui/dom.js";
import { STYLES } from "./ui/styles.js";
import { versionMismatch } from "./ui/version.js";

// Must equal the version in manifest.json and const.py (tests/test_integration_files.py).
export const VERSION = "0.1.0";
const ELEMENT = "meshroute-topology-explorer";

class MeshrouteTopologyExplorer extends HTMLElement {
  constructor() {
    super();
    this._root = this.attachShadow({ mode: "open" });
    this._hass = null;
    this._narrow = false;
    this._panel = null;
    this._t = translator("en");
    this._themeKey = null;
    this._ui = null;
    this._view = null;
    this._settings = null;
    this._networkKey = null; // the network the user chose (an adapter's key; ui/network-switch.js), null: default
    this._networkMenu = false; // the status line's network menu is open
    this._choice = "unread"; // the stored choice: "unread", "reading", "read"
    this._source = null; // the model's network as loaded
    this._network = null; // the same, labels translated: what every view shows
    this._raw = new Map();
    this._token = 0;
    this._selected = null;
    this._debug = false; // never stored (spec 9.1)
    this._wide = true;
    this._leftAuto = false; // the left panel was opened by "Details on click", not by the user
    this._info = { density: false, reload: false, heard: false, colors: false, assumed: false }; // which info notes the View tab shows
    this._detailsSub = "communication"; // the Details tab's sub-tab (spec 9.2), kept while the selection changes
    this._dialog = null; // the dialog an engine's Details opened (Zigbee: a cluster's details), if any
    this._dirty = new Set();
    this._connection = "ok";
    this._controller = new PanelController();
    this._controller.addEventListener("change", () => this._onState());
    this._controller.addEventListener("reconnected", () => {
      // The network is read again (controller); the settings too, with what changed here meanwhile merged in: another
      // panel may have saved, and a first read that met the lost connection gets its second chance.
      this._settingsStale = true;
      this._observationsStale = true;
      this._announce(this._t("live.reloaded"));
    });
    this._settingsStale = false;
    this._onMedia = () => this._applyTheme();
    // Pending settings go out when the page is hidden or left, not only when the panel element is removed.
    this._onPageHide = (e) => {
      if (this._settings && (e.type === "pagehide" || document.visibilityState === "hidden")) this._settings.flush();
    };
  }

  // Home Assistant assigns a new hass object on every state change in the house: only language, theme and the
  // connection are looked at here; the data is read once (spec 10).
  set hass(value) {
    this._hass = value;
    const lang = languageOf(value);
    const formatLocale = formatLocaleOf(value);
    if (lang !== this._t.lang || formatLocale !== this._t.formatLocale) {
      this._t = translator(lang, formatLocale);
      if (this._ui) this._retranslate();
    }
    const key = themeKey(value);
    if (key !== this._themeKey) {
      this._themeKey = key;
      // Home Assistant sets the theme's variables around the same time it hands out the new hass: read them a frame later.
      if (this._ui) requestAnimationFrame(() => this._applyTheme());
    }
    this._controller.setHass(value);
    // An open dialog (a cluster's details) shows entity states as current values: they follow the house.
    if (this._dialog) this._dialog.refresh();
  }
  get hass() { return this._hass; }

  set narrow(value) {
    this._narrow = Boolean(value);
    if (this._ui) this._renderButtons();
  }
  get narrow() { return this._narrow; }

  set panel(value) {
    this._panel = value;
    if (this._ui) this._onState();
  }
  get panel() { return this._panel; }

  connectedCallback() {
    if (!this._ui) this._build();
    this._resize.observe(this._ui.map);
    // Their sizes bound the band for banners (floatingLayout).
    this._resize.observe(this._buttons.left);
    this._resize.observe(this._buttons.right);
    this._media = globalThis.matchMedia ? matchMedia("(prefers-color-scheme: dark)") : null;
    if (this._media) this._media.addEventListener("change", this._onMedia);
    document.addEventListener("visibilitychange", this._onPageHide);
    window.addEventListener("pagehide", this._onPageHide);
    this._controller.attach();
    if (this._view) this._view.resize();
    this._layout();
    this._onState();
  }

  // Leaving the panel (another sidebar entry): stop listening and drawing (spec 10), save what is pending.
  disconnectedCallback() {
    this._controller.detach();
    this._resize.disconnect();
    if (this._media) this._media.removeEventListener("change", this._onMedia);
    document.removeEventListener("visibilitychange", this._onPageHide);
    window.removeEventListener("pagehide", this._onPageHide);
    if (this._settings) this._settings.flush();
    if (this._observations) this._observations.flush();
    // A hidden panel does not keep reading zha/devices: following the scan ends here (the scan itself goes on).
    if (this._scan) this._scan.stop();
    if (this._view) this._view.resize(); // a detached canvas counts as hidden: no more frames
  }

  // ---- skeleton, built once ------------------------------------------------------------------------------------

  _build() {
    const ui = {};
    this._ui = ui;
    // The controls on the map: Devices (with the findings count) and the switch top left, View and Legend top right.
    this._buttons = new MapButtons({
      // Custom panels bring their own sidebar button on narrow screens. Home Assistant's menu button fires the
      // bubbling, composed event "hass-toggle-menu", which the main shell handles (home-assistant/frontend,
      // ha-menu-button).
      onSidebar: () => this.dispatchEvent(new Event("hass-toggle-menu", { bubbles: true, composed: true })),
      onDevices: (button) => this._request("left", "devices", button),
      onSwitch: (on) => this._setOpenOnSelect(on),
      onView: (button) => this._request("right", "view", button),
      onLegend: (button) => this._request("right", "legend", button),
    });

    ui.canvas = h("canvas", { "aria-describedby": "mte-status" });
    ui.incomplete = h("div", { class: "banner incomplete float" }, h("strong"), h("span"));
    ui.lost = h("div", { class: "banner lost float", role: "alert" });
    ui.loading = h("div", { class: "banner loading float", role: "status" });
    ui.top = h("div", { class: "top" }, ui.incomplete, ui.lost, ui.loading);
    ui.zoomIn = iconButton("plus", "", () => this._view && this._view.zoomIn());
    ui.zoomOut = iconButton("minus", "", () => this._view && this._view.zoomOut());
    ui.zoomFit = iconButton("fit", "", () => this._view && this._view.fit());
    ui.zoom = h("div", { class: "zoom float" }, ui.zoomIn, ui.zoomOut, ui.zoomFit);
    ui.message = h("div", { class: "message" });

    this._left = new Drawer({ tabs: LEFT_TABS, side: "left", onChange: () => this._onDrawer() });
    this._right = new Drawer({ tabs: RIGHT_TABS, side: "right", onChange: () => this._onDrawer() });
    for (const d of [this._left, this._right]) d.fallback = ui.canvas;
    this._devicesTab = new DevicesTab({ onSelect: (id) => this._select(id, "devices") });
    this._left.panel("devices").append(this._devicesTab.el);

    // Reading and tab order: the controls top left and top right, the map, the zoom group, then the panels.
    ui.map = h("div", { class: "map" }, this._buttons.left, this._buttons.right, ui.canvas, ui.top, ui.zoom,
      this._left.el, this._right.el, ui.message);
    ui.status = h("section", { class: "status", id: "mte-status" });
    ui.live = h("div", { class: "sr-only", "aria-live": "polite" });
    ui.probe = h("span", { class: "sr-only", "aria-hidden": "true" });
    ui.app = h("div", { class: "app" }, ui.map, ui.status, ui.live);
    this._root.append(h("style", { text: STYLES }), ui.app, ui.probe);
    this._resize = new ResizeObserver(() => this._layout());
    this._retranslate();
  }

  /** Texts that do not depend on data; called on build and when the language changes. */
  _retranslate() {
    const t = this._t;
    const ui = this._ui;
    ui.canvas.setAttribute("aria-label", t("map.label"));
    ui.lost.textContent = t("map.connection_lost");
    ui.loading.textContent = t("map.loading");
    ui.status.setAttribute("aria-label", t("status.label"));
    for (const [button, key] of [[ui.zoomIn, "zoom.in"], [ui.zoomOut, "zoom.out"], [ui.zoomFit, "zoom.fit"]]) {
      button.setAttribute("aria-label", t(key));
      button.title = t(key);
    }
    this._left.setTexts(t, t("panel.left_label"));
    this._right.setTexts(t, t("panel.right_label"));
    if (this._source) {
      // The coordinator's label is translated, so the map gets the new network (same layout seed, same picture).
      this._network = localize(this._source, t, this._areas());
      if (this._view) this._view.setTexts(this._graphTexts());
      if (this._view) this._view.setNetwork(this._network, { pinned: pinsForView(this._settings.settings.pins) });
      this._devicesTab.setNetwork(this._network, t);
      this._devicesTab.setSelected(this._selected);
      this._dirty = new Set(["details", "findings", "legend", "view"]);
    }
    this._onState();
  }

  // ---- state ---------------------------------------------------------------------------------------------------

  _versionMismatch() {
    return versionMismatch(this._panel, VERSION);
  }

  _onState() {
    if (!this._ui) return;
    const st = this._controller.state;
    if (st.connection !== this._connection) {
      if (st.connection === "lost") this._announce(this._t("live.lost"));
      this._connection = st.connection;
    }
    if (!this._versionMismatch() && st.phase === "ready" && networkChoices(st).length > 1 && this._choice === "unread"
      && this._hass) {
      // Two networks: the stored choice decides which one shows first (board Variant A: first load Zigbee).
      this._choice = "reading";
      loadNetworkChoice((msg) => this._hass.callWS(msg)).then((key) => {
        if (key && !this._networkKey) this._networkKey = key;
        this._choice = "read";
        this._onState();
      });
    }
    const net = this._chosen(st);
    if (!this._versionMismatch() && st.phase === "ready" && this._choice !== "reading" && net && net !== this._source) {
      // The raw answer belongs to the first network read (the controller's `network`).
      this._useNetwork(net, net === st.network ? st.raw : []);
      return; // _useNetwork renders when the settings are in
    }
    this._render();
  }

  /** The network to show from the controller's state: the chosen one, if it can be shown, else the first adapter's
   *  (ZHA), else the next (Thread). */
  _chosen(st) {
    if (!st.networks) return st.network;
    const key = activeNetwork(networkChoices(st), this._networkKey || DEFAULT_NETWORK);
    return (key && st.networks[key]) || st.network;
  }

  /** Switch the network (board Variant A): clears the selection, keeps the panels on their tab, stores the choice. */
  _chooseNetwork(key) {
    this._networkMenu = false;
    if (key === this._networkKey && this._source && adapterFor(this._source).key === key) { this._render(); return; }
    this._networkKey = key;
    if (this._hass) saveNetworkChoice((msg) => this._hass.callWS(msg), key);
    this._select(null, "devices");
    this._onState();
    this._announce(this._t("status.source", { source: this._t(`source.${key}`) }));
  }

  /** A new network from the controller: load its settings first (density, fill and pins shape the first picture),
   *  then show it. */
  async _useNetwork(network, raw) {
    const token = ++this._token;
    this._source = network;
    this._raw = new Map((raw || []).map((d) => [normalizeIeee(d && d.ieee), d]));
    if (!this._settings || this._settings.network !== network.id) {
      if (this._settings) this._settings.dispose();
      // The network engine sanitizes its own keys; the shell keeps everything else verbatim.
      const client = new SettingsClient({ callWS: (msg) => this._hass.callWS(msg), network: network.id,
        engineSettings: engineFor(network).settings });
      client.addEventListener("change", () => this._onSettings());
      this._settings = client;
      this._settingsStale = false;
      await client.load();
      if (token !== this._token) return;
    } else if (this._settingsStale || this._settings.retryable) {
      this._settingsStale = false;
      await this._settings.load();
      if (token !== this._token) return;
    }
    // Observations ("unchanged since", spec 6) are for a source without a measurement time (ZHA's tables); a Thread
    // snapshot carries its own time.
    if (network.capabilities.observations) await this._observe(network);
    if (token !== this._token) return;
    this._network = localize(network, this._t, this._areas());
    if (this._selected && !this._network.devices.some((d) => d.id === this._selected)) this._selected = null;
    this._ensureView();
    // The new network's engine reads its own keys of the new settings (another engine's stay unread).
    this._view.setEngineView(this._engineView());
    this._view.setNetwork(this._network, { pinned: pinsForView(this._settings.settings.pins) });
    this._devicesTab.setNetwork(this._network, this._t);
    this._devicesTab.setSelected(this._selected);
    this._dirty = new Set(["details", "findings", "legend", "view"]);
    this._render();
  }

  /** Record the tables of a freshly read network (spec 6). The stored observations are read for a new network, after
   *  a reconnect and after a read that met the lost connection. */
  async _observe(network) {
    let client = this._observations;
    if (!client || client.network !== network.id) {
      if (client) client.dispose();
      client = new (adapterFor(network).Observations)({ callWS: (msg) => this._hass.callWS(msg), network: network.id });
      client.addEventListener("change", () => { this._dirty.add("details").add("view"); });
      this._observations = client;
      this._observationsStale = false;
      await client.load();
    } else if (this._observationsStale || client.retryable) {
      this._observationsStale = false;
      await client.load();
    }
    client.observe(network);
  }

  _ensureView() {
    if (this._view) return;
    const s = this._settings.settings;
    const view = new GraphView(this._ui.canvas, { theme: this._readTheme(), density: DENSITY[s.density], fill: s.fill,
      debug: this._debug, engineView: this._engineView(), receptionColors: s.pathColors.mode === "coloured",
      receptionStops: stopsOf(s.pathColors), labels: s.labels, texts: this._graphTexts() });
    view.addEventListener("select", (e) => this._select(e.detail.id, "map"));
    view.addEventListener("details-request", (e) => this._openDetails(e.detail.id, e.detail.via));
    view.addEventListener("pin-change", (e) => {
      const d = e.detail;
      if (d.pinned) this._settings.setPin(d.id, d.x, d.y); else this._settings.removePin(d.id);
      this._dirty.add("details");
      this._render();
    });
    this._view = view;
    this._layout();
  }

  _onSettings() {
    const s = this._settings.settings;
    if (this._view) {
      this._view.setDensity(DENSITY[s.density]);
      this._view.setFill(s.fill);
      if (this._network) this._view.setEngineView(this._engineView());
      this._view.setReceptionColors(s.pathColors.mode === "coloured");
      this._view.setReceptionStops(stopsOf(s.pathColors));
      this._view.setLabels(s.labels);
    }
    // The details carry the selection's paths as text, in the stage of "Communication paths".
    this._dirty.add("view").add("legend").add("details");
    this._render();
  }

  // ---- rendering -----------------------------------------------------------------------------------------------

  _render() {
    const ui = this._ui;
    const t = this._t;
    const st = this._controller.state;
    const mismatch = this._versionMismatch();
    const ready = !mismatch && st.phase === "ready" && Boolean(this._network) && this._source === this._chosen(st);
    for (const el of [ui.canvas, ui.top, ui.zoom, ui.status, this._buttons.left, this._buttons.right]) el.hidden = !ready;
    if (!ready) {
      this._left.close();
      this._right.close();
      this._renderMessage(mismatch ? "version" : st.phase === "ready" ? "loading" : st.phase, st.message);
      if (this._view) this._view.resize();
      return;
    }
    ui.message.hidden = true;
    if (this._view) this._view.resize();
    const net = this._network;
    this._renderButtons();

    // Status line (spec 6, board M1): source, tables, completeness, "observed unchanged since" and a followed scan.
    const { incomplete } = this._renderStatus();
    ui.incomplete.hidden = !incomplete;
    if (incomplete) {
      ui.incomplete.firstChild.textContent = t("map.incomplete");
      ui.incomplete.lastChild.textContent = t("map.incomplete_detail", incomplete);
    }
    ui.lost.hidden = st.connection !== "lost";
    ui.loading.hidden = !st.loading || st.connection === "lost";
    this._renderTabs();
  }

  /** Status line (spec 6, board M1): the network engine's parts (source, tables or links, "unchanged since" with its
   *  caveat as the part's description, a followed scan with its stop button) and its part on the right (the
   *  source-route stage). Below the wide breakpoint it is compact: short forms in at most two lines; the long forms
   *  are the parts' descriptions. Returns the engine's status ({ parts, right, incomplete }). */
  _renderStatus() {
    const t = this._t;
    const net = this._network;
    const caps = net.capabilities;
    const newest = this._observations && caps.observations ? this._observations.newest(net) : null;
    const scan = this._scan && caps.scan && this._scan.state.status !== "idle" ? this._scan.state : null;
    const compact = !this._wide;
    const collected = net.collectedAt ? (() => {
      const [ageKey, ageParams] = ageParts(net.collectedAt);
      return { time: t.when(net.collectedAt), age: t(ageKey, ageParams) };
    })() : null;
    const status = engineFor(net).status(net, { unchangedSince: newest ? t.when(newest) : null, scan, compact, collected,
      settings: this._settings ? this._settings.settings : null });
    const parts = status.parts;
    this._ui.status.classList.toggle("compact", compact);
    // The engine's part on the right (board M1: the source-route stage) sits apart.
    const sr = status.right;
    // The source part is the network switch when there is more than one network (ui/network-switch.js).
    const choices = networkChoices(this._controller.state);
    const source = sourcePart({ t, choices, active: adapterFor(net).key, open: this._networkMenu, compact,
      onToggle: (open) => {
        this._networkMenu = open;
        this._renderStatus();
        if (open) {
          const first = this._ui.status.querySelector('.network-item[aria-checked="true"]');
          if (first) first.focus();
        }
      },
      onChoose: (key) => this._chooseNetwork(key) });
    const spans = parts.filter(([key]) => key !== "status.source").map(([key, params, long], i, all) => {
      const span = h("span", { class: i < all.length - 1 ? "part sep" : "part", text: t(key, params) });
      if (long) span.title = t(long, params);
      if (key === "status.unchanged" || key === "status.short_unchanged") {
        span.title = long ? `${t(long, params)}. ${t("status.unchanged_note")}` : t("status.unchanged_note");
      }
      if (key === "status.scan_running" || key === "status.short_scan_running") {
        span.append(" ", h("button", { type: "button", class: "link status-stop", text: t("status.scan_stop"),
          "aria-label": t("status.scan_stop_label"), on: { click: () => this._scan.stop() } }));
      }
      return span;
    });
    if (sr) {
      const span = h("span", { class: "part right", text: t(sr[0], sr[1]) });
      if (sr[2]) span.title = t(sr[2], sr[1]);
      spans.push(span);
    }
    const showSource = !compact || choices.length > 1;
    this._ui.status.replaceChildren(...(showSource ? [source] : []), ...spans);
    return status;
  }

  /** The controls on the map (spec 9.1). On wide screens a side panel covers its corner, so that corner's group is
   *  hidden while its panel is open; the switch shows only while the left panel is closed. */
  _renderButtons() {
    if (!this._ui || !this._network) return;
    const ready = !this._ui.canvas.hidden; // no controls over a message (loading, errors, stale version)
    const side = this._left.mode === "side";
    this._buttons.update({ t: this._t, count: badgeCount(this._network.findings), openOnSelect: this._openOnSelect(),
      narrow: this._narrow, hideLeft: !ready || (side && this._left.isOpen), hideRight: !ready || (side && this._right.isOpen),
      leftOpen: this._left.isOpen });
  }

  /** The network engine's own settings, for the map (GraphView.setEngineView): the keys it owns, as stored. */
  _engineView() {
    const s = this._settings.settings;
    return Object.fromEntries(engineFor(this._network).settings.keys.map((key) => [key, s[key]]));
  }

  /** "Details on click": as stored, else by width (spec 9.2). */
  _openOnSelect() {
    return openOnSelect(this._settings ? this._settings.settings.openDetailsOnSelect : null, this._wide);
  }

  _setOpenOnSelect(on) {
    if (this._settings) this._settings.update({ openDetailsOnSelect: Boolean(on) });
  }

  /** Words the map draws itself: LQI 0, the values of implied lanes, "RX:" above a value, an unknown path's end, and
   *  the device types above the symbols. */
  _graphTexts() {
    const t = this._t;
    const kinds = Object.fromEntries(KINDS.filter((k) => k !== "unknown").map((k) => [k, t(`kind_short.${k}`)]));
    return { uncertain: t("lqi.uncertain"), parent: t("lane.parent"), route: t("lane.route"), rx: t("lane.rx"),
      pathUnknown: t("lane.path_unknown"), kinds };
  }

  _renderMessage(phase, detail) {
    const ui = this._ui;
    const t = this._t;
    // A source the panel cannot read yet (its adapter's blocking phase, e.g. its integration not loaded) is a warning
    // with a retry, like no devices.
    const blocked = ADAPTERS.some((a) => a.blocking === phase);
    const kind = blocked ? "warn"
      : { not_admin: "warn", no_devices: "", disconnected: "warn", error: "error", version: "warn" }[phase] || "";
    const retry = blocked || ["no_devices", "error"].includes(phase);
    const reload = phase === "version";
    ui.message.hidden = false;
    ui.message.className = `message ${kind}`.trim();
    ui.message.replaceChildren(h("p", { role: kind === "error" ? "alert" : "status", text: t(`message.${phase}`, { message: detail || "?" }) }));
    if (retry) ui.message.append(h("button", { type: "button", class: "button", text: t("message.retry"), on: { click: () => this._controller.reload() } }));
    // A stale panel file in the browser cache: only a page reload fetches the new one (spec 10).
    if (reload) ui.message.append(h("button", { type: "button", class: "button", text: t("message.reload"), on: { click: () => location.reload() } }));
  }

  /** Render the tabs that can be seen, if their content is out of date; others wait until they are shown. */
  _renderTabs() {
    const t = this._t;
    const findings = badgeCount(this._network.findings);
    this._left.setTabCount("findings", findings);
    this._devicesTab.setHint(this._openOnSelect());
    for (const d of [this._left, this._right]) {
      d.setSummary(this._summary(d));
      if (d.isOpen && d.tab === "devices") this._devicesTab.showActive();
      if (!d.isOpen || !this._dirty.has(d.tab)) continue;
      const panel = d.panel(d.tab);
      this._dirty.delete(d.tab);
      if (d.tab === "details") {
        // The content is the network engine's (Zigbee: three sub-tabs; Thread: one stack of cards).
        const engine = engineFor(this._network);
        const seen = this._selected && this._observations && this._network.capabilities.observations
          ? this._observations.firstSeen(this._selected) : null;
        keepFocus(this._root, panel, () => engine.details(panel, { network: this._network, t, id: this._selected,
          debug: this._debug, raw: this._raw, settings: this._settings.settings, sub: this._detailsSub,
          idPrefix: "mte-details",
          observedSince: seen ? t.when(seen) : null,
          pinned: Boolean(this._selected && this._settings.settings.pins[this._selected]),
          onSub: (sub, { focus = false } = {}) => this._setDetailsSub(sub, focus),
          devicePage: adapterFor(this._network).devicePage,
          openDialog: (open) => this._openDialog(open),
          onFindings: (opener) => this._left.open("findings", { focus: true, opener }),
          onSelect: (id) => this._select(id, "details"), onRelease: (id) => this._release([id]) }));
      } else if (d.tab === "findings") {
        renderFindings(panel, { network: this._network, t, selected: this._selected, onSelect: (id) => this._select(id, "findings") });
      } else if (d.tab === "legend") {
        renderLegend(panel, { t, theme: this._mapTheme(), fill: this._settings.settings.fill, roles: this._roles(),
          devices: this._network.devices, links: this._view ? this._view.legend() : [], debug: this._debug });
      } else if (d.tab === "view") {
        // The network engine's groups (hidden, not greyed, where the network type has none) and the scan where the
        // source has one.
        keepFocus(this._root, panel, () => renderView(panel, { t, settings: this._settings.settings,
          groups: engineFor(this._network).options(this._network, this._settings.settings),
          canScan: Boolean(this._network.capabilities.scan),
          openOnSelect: this._openOnSelect(), dark: this._mapTheme().dark, debug: this._debug,
          pinCount: presentPins(this._settings.settings.pins, this._network).length, client: this._settings,
          scan: this._scan ? { running: this._scan.running } : null, idPrefix: "mte-view",
          observations: this._debug ? this._observations : null, info: this._info,
          onChange: (patch) => this._settings.update(patch), onOpenDetails: (on) => this._setOpenOnSelect(on),
          onDebug: (on) => this._setDebug(on), onReload: () => this._controller.reload(),
          onReleaseAll: () => this._release(null), onScan: (button) => this._startScan(button),
          onScanStop: () => this._scan && this._scan.stop(),
          onInfo: (key, open) => {
            this._info = { ...this._info, [key]: open };
            this._dirty.add("view");
            this._render();
          } }));
      }
    }
  }

  /** One line for a collapsed sheet. */
  _summary(d) {
    const t = this._t;
    if (d.tab === "details") {
      const device = this._device(this._selected);
      return device ? `${device.label} · ${device.available ? receptionText(device.rating, t) : t("devices.unavailable")}` : t("tab.details");
    }
    if (d.tab === "findings" && this._network) return t("header.findings_label", { count: badgeCount(this._network.findings) });
    if (d.tab === "devices" && this._network) return t("devices.count", { shown: this._network.devices.length, total: this._network.devices.length });
    if (d.tab === "legend" && this._settings) return t(`legend.fill_${this._settings.settings.fill}`);
    return t(`tab.${d.tab}`);
  }

  // ---- selection and panels ------------------------------------------------------------------------------------

  /** Select a device (null clears). source: "map" (the view already selected it and keeps it clear of the panels),
   *  "devices" (the Devices list), "findings" or "details" (a device named there): select and zoom to it (spec 9.3).
   *  What the panels do follows ui/drawer-rule.js. */
  _select(id, source) {
    const t = this._t;
    this._selected = id;
    if (source !== "map" && this._view) {
      this._view.select(id);
      if (id) this._view.reveal(id, this._view.insets, { zoom: true });
    }
    this._devicesTab.setSelected(id);
    markFindings(this._left.panel("findings"), id);
    this._dirty.add("details");
    const focusInLeft = this._left.el.contains(this._root.activeElement);
    this._apply(afterSelect({ id, source, openOnSelect: this._openOnSelect(), state: this._panelState() }),
      null, { focusInLeft });
    const device = this._device(id);
    this._announce(device ? t("live.selected", { name: device.label, role: roleText(device.role, t),
      reception: device.available ? receptionText(device.rating, t) : t("devices.unavailable") }) : t("live.cleared"));
    this._render();
  }

  /** Details asked for explicitly (right-click, long press, menu key). */
  _openDetails(id, via) {
    if (id && id !== this._selected) this._select(id, "map");
    this._apply(detailsRequest(via, this._panelState()), this._root.activeElement);
  }

  /** A button on the map asks for a tab of a panel; pressed again while that tab is in view, it closes the panel. */
  _request(panel, tab, opener) {
    this._apply(tabRequest({ panel, tab, state: this._panelState() }), opener);
  }

  _panelState() {
    const of = (d) => ({ isOpen: d.isOpen, tab: d.tab, mode: d.mode, expanded: d.expanded });
    return { wide: this._wide, left: { ...of(this._left), auto: this._leftAuto }, right: of(this._right) };
  }

  /** Carry out the steps of drawer-rule.js. focusInLeft: focus was inside the left panel when a list selection
   *  switched it to Details, so it follows into the Details. */
  _apply(steps, opener = null, { focusInLeft = false } = {}) {
    for (const step of steps) {
      const d = step.panel === "left" ? this._left : this._right;
      if (step.action === "close") {
        d.close();
        continue;
      }
      if (step.panel === "left") this._leftAuto = step.auto;
      d.open(step.tab, { expanded: step.expanded, focus: step.focus === "tab", opener });
      if (step.focus === "panel" && focusInLeft) d.focusPanel();
    }
  }

  _onDrawer() {
    if (!this._left.isOpen) this._leftAuto = false;
    this._layout();
    this._render();
  }

  /** Sizes: wide or narrow, the panels' mode and size, and the insets that keep the selection clear of them. */
  _layout() {
    if (!this._ui || !this._ui.map.isConnected) return;
    const rect = this._ui.map.getBoundingClientRect();
    if (!rect.width) return;
    const wide = isWide(rect.width);
    if (wide !== this._wide) {
      this._wide = wide;
      this._dirty.add("view");
      // Two sheets would cover each other: on a narrow screen the right one gives way.
      if (!wide && this._left.isOpen && this._right.isOpen) this._right.close();
      if (this._network && !this._ui.status.hidden) this._render(); // status forms, "Details on click" by width
    }
    const size = (d) => drawerGeometry({ width: rect.width, height: rect.height, open: d.isOpen, expanded: d.expanded, side: d.side });
    const gl = size(this._left);
    const gr = size(this._right);
    this._left.setMode(gl.mode, gl.size);
    this._right.setMode(gr.mode, gr.size);
    const insets = combinedInsets(gl.insets, gr.insets);
    this._renderButtons();
    const box = (el) => {
      if (el.hidden) return { width: 0, height: 0 };
      const r = el.getBoundingClientRect();
      return { width: r.width, height: r.height };
    };
    const f = floatingLayout({ width: rect.width, height: rect.height, insets, left: box(this._buttons.left),
      right: box(this._buttons.right) });
    this.style.setProperty("--inset-left", `${insets.left}px`);
    this.style.setProperty("--inset-right", `${insets.right}px`);
    this.style.setProperty("--inset-bottom", `${insets.bottom}px`);
    this.style.setProperty("--band-top", `${f.band.top}px`);
    this.style.setProperty("--band-left", `${f.band.left}px`);
    this.style.setProperty("--band-right", `${f.band.right}px`);
    if (this._view) this._view.setInsets(insets);
  }

  /** Switch the Details tab's sub-tab (Communication, Entity, Cluster); focus: move focus to its tab (arrow keys). */
  _setDetailsSub(sub, focus) {
    this._detailsSub = sub;
    this._dirty.add("details");
    this._render();
    if (focus) {
      const tab = this._left.panel("details").querySelector(`[id="mte-details-tab-${sub}"]`);
      if (tab) tab.focus();
    }
  }

  /** A modal dialog an engine's Details open (Zigbee: one cluster's details, spec 9.2, board M10): open(host) builds it
   *  in the panel's root with Home Assistant's states and websocket and returns { close, refresh }. One at a time. */
  _openDialog(open) {
    if (!this._hass) return;
    if (this._dialog) this._dialog.close();
    this._dialog = open({ root: this._ui.app, states: () => this._hass && this._hass.states,
      callWS: (msg) => this._hass.callWS(msg), onClose: () => { this._dialog = null; } });
  }

  /** Area names from the hass object (hass.areas: id -> { name }), where Home Assistant provides it. */
  _areas() {
    return this._hass && this._hass.areas && typeof this._hass.areas === "object" ? this._hass.areas : null;
  }

  /** Release pins: the given ids, or all pins of devices in the network (null). */
  _release(ids) {
    const list = ids === null ? presentPins(this._settings.settings.pins, this._network) : ids;
    for (const id of list) if (this._view) this._view.unpin(id);
    this._settings.releasePins(list);
    this._dirty.add("details");
    this._render();
  }

  /** Ask, then start a scan and follow it (spec 6). */
  async _startScan(opener = null) {
    const t = this._t;
    const ok = await confirmDialog(this._ui.app, { title: t("scan.title"),
      paragraphs: [t("scan.body_radio"), t("scan.body_auto"), t("scan.body_follow")],
      confirm: t("scan.confirm"), cancel: t("scan.cancel"), opener });
    if (!ok || !this._source) return;
    if (!this._scan) {
      // The scan is the source's own (capabilities.scan; adapters/index.js scan: send, follow, compare tables).
      const adapter = adapterFor(this._source);
      const raws = new WeakMap();
      this._scan = new adapter.scan.Follower({
        send: () => adapter.scan.send(this._hass),
        read: async () => {
          // The scan follows its own source only: no other source is read every 15 seconds.
          const result = await readNetwork(this._hass, { keys: [adapter.key] });
          if (result.phase !== "ready") return null;
          raws.set(result.network, result.raw);
          return result.network;
        },
      });
      this._scan.addEventListener("read", (e) => {
        // Only a re-read whose tables differ reaches the map: no new layout every 15 seconds for nothing.
        const network = e.detail.network;
        if (adapter.scan.differ(this._source, network)) this._controller.adopt(network, raws.get(network));
      });
      this._scan.addEventListener("change", () => {
        const status = this._scan.state.status;
        if (status !== this._scanStatus) {
          if (status === "running") this._announce(t("live.scan_started"));
          else if (this._scanStatus === "running") this._announce(this._t("live.scan_over"));
          this._scanStatus = status;
        }
        if (this._network) this._renderStatus();
        this._dirty.add("view"); // the scan buttons follow its state
        if (this._network) this._renderTabs();
      });
    }
    this._scan.start(this._source);
  }

  /** Debug mode (spec 9.1): every pair as lanes with reporters, raw tables in Details, the scan. Never stored. */
  _setDebug(on) {
    this._debug = Boolean(on);
    if (this._view) this._view.setDebug(this._debug);
    // Leaving debug mode clears what a finished scan left in the status line; a running one stays (spec 9.4).
    if (!this._debug && this._scan && !this._scan.running) this._scan.clear();
    this._dirty.add("details").add("legend").add("view");
    this._render();
  }

  // ---- helpers -------------------------------------------------------------------------------------------------

  _device(id) {
    return (id && this._network && this._network.devices.find((d) => d.id === id)) || null;
  }

  _roles() {
    return new Set((this._network ? this._network.devices : []).map((d) => d.role));
  }

  _readTheme() {
    return readTheme(this._ui.probe, this);
  }

  /** The map's resolved theme (as the canvas uses it), for the legends. */
  _mapTheme() {
    return this._view ? this._view.theme : resolveTheme(this._readTheme());
  }

  _applyTheme() {
    if (!this._ui || !this._view) return;
    this._view.setTheme(this._readTheme());
    this._dirty.add("legend").add("view"); // the colour pickers show the theme's own colours
    this._render();
  }

  _announce(text) {
    // Cleared first, so the same sentence twice is announced twice.
    this._ui.live.textContent = "";
    requestAnimationFrame(() => { this._ui.live.textContent = text; });
  }
}

/** The user's reception colours as GraphView takes them: [bad, medium, good], null for the theme's own. */
function stopsOf(pathColors) {
  return [pathColors.bad, pathColors.medium, pathColors.good];
}

/** Re-render a container without losing the focused control: it is found again by id or by name and value. */
function keepFocus(root, container, render) {
  const active = root.activeElement;
  const inside = active && container.contains(active);
  const key = inside ? { id: active.id, name: active.name, value: active.value } : null;
  render();
  if (!key) return;
  const again = (key.id && container.querySelector(`[id="${key.id}"]`))
    || (key.name && [...container.querySelectorAll("input")].find((el) => el.name === key.name && el.value === key.value));
  if (again) again.focus();
}

// Defined only if free: a second load of the module (or another add-on) must not throw.
if (!customElements.get(ELEMENT)) customElements.define(ELEMENT, MeshrouteTopologyExplorer);
