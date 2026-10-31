// SPDX-License-Identifier: MIT
// Entry module of the Meshroute Topology Explorer panel: the quality view of a ZHA network (spec 6-11). Home
// Assistant loads it as a custom panel and sets `hass`, `narrow` and `panel` on the element (spec 10).
// Layout (spec 9.1; decision by Fabian Schwamborn, 2026-10-31): no header bar; the map fills the panel with floating
// groups at its edges: title pill (with the sidebar button on narrow screens) top left, options group top right,
// zoom group bottom right, legend pill bottom left; one drawer (Details, Devices, Findings, Legend, Settings) and the
// status line.
// There is no view switch yet: the quality view is the only view of v1; the switch comes with the route view (v1.1).
// Data: ui/controller.js (load, errors, reconnect); settings: ui/settings.js; observations ("observed unchanged
// since", spec 6): ui/observations-client.js; the scan in debug mode: ui/scan.js; map: graph/graph-view.js.
// Only read-only websocket commands from spec 3.4 are used. Names are always set as text, never as HTML.
// Try it without Home Assistant: dev/panel.html.
import { GraphView } from "./graph/graph-view.js";
import { DENSITY } from "./graph/layout.js";
import { resolveTheme } from "./graph/palette.js";
import { normalizeIeee } from "./model/index.js";
import { PanelController, readNetwork } from "./ui/controller.js";
import { ObservationsClient } from "./ui/observations-client.js";
import { ScanFollower, tablesDiffer } from "./ui/scan.js";
import { confirmDialog } from "./ui/dialog.js";
import { SettingsClient, pinsForView, presentPins, DENSITY_NAMES } from "./ui/settings.js";
import { FILLS } from "./graph/palette.js";
import { afterSelect, detailsRequest, tabRequest, openOnSelect } from "./ui/drawer-rule.js";
import { languageOf, translator, localize } from "./ui/i18n.js";
import { drawerGeometry, floatingLayout, isWide } from "./ui/geometry.js";
import { OptionsGroup } from "./ui/options-group.js";
import { Drawer } from "./ui/drawer.js";
import { DevicesTab } from "./ui/devices-tab.js";
import { renderDetails } from "./ui/details-tab.js";
import { renderFindings, markFindings } from "./ui/findings-tab.js";
import { renderLegend, renderLegendPill } from "./ui/legend-tab.js";
import { renderSettings } from "./ui/settings-tab.js";
import { badgeCount } from "./ui/findings.js";
import { statusParts, isIncomplete } from "./ui/status.js";
import { receptionText, roleText } from "./ui/format.js";
import { readTheme, themeKey } from "./ui/theme.js";
import { h, icon, iconButton } from "./ui/dom.js";
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
    this._source = null; // the model's network as loaded
    this._network = null; // the same, labels translated: what every view shows
    this._raw = new Map();
    this._token = 0;
    this._selected = null;
    this._debug = false; // never stored (spec 9.1)
    this._wide = true;
    this._drawerAuto = false; // the drawer was opened by "open details on select", not by the user
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
    if (lang !== this._t.lang) {
      this._t = translator(lang);
      if (this._ui) this._retranslate();
    }
    const key = themeKey(value);
    if (key !== this._themeKey) {
      this._themeKey = key;
      // Home Assistant sets the theme's variables around the same time it hands out the new hass: read them a frame later.
      if (this._ui) requestAnimationFrame(() => this._applyTheme());
    }
    this._controller.setHass(value);
  }
  get hass() { return this._hass; }

  set narrow(value) {
    this._narrow = Boolean(value);
    if (this._ui) this._renderHeader();
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
    this._resize.observe(this._options.el); // its width bounds the band for banners (floatingLayout)
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
    this._options.closeMenus();
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
    ui.sidebar = iconButton("menu", "", () => {
      // Custom panels bring their own sidebar button on narrow screens. Home Assistant's menu button fires the
      // bubbling, composed event "hass-toggle-menu", which the main shell handles (home-assistant/frontend,
      // ha-menu-button).
      this.dispatchEvent(new Event("hass-toggle-menu", { bubbles: true, composed: true }));
    });
    ui.title = h("h1", { class: "title" });
    // Top left: the title as a small floating pill; on narrow screens the sidebar button joins it.
    ui.titlePill = h("div", { class: "title-pill float" }, ui.sidebar, ui.title);
    // Top right: the options group (labelled rows; icons on narrow screens).
    this._options = new OptionsGroup({
      menuItems: () => this._menuItems(), onMenu: (id) => this._onMenu(id),
      onFindings: (button) => this._toggleTab("findings", button),
      densityItems: () => DENSITY_NAMES.map((name) => ({ id: name, type: "radio", label: this._t(`density.${name}`),
        checked: this._settings && this._settings.settings.density === name })),
      onDensity: (name) => this._settings && this._settings.update({ density: name }),
      fillItems: () => FILLS.map((name) => ({ id: name, type: "radio", label: this._t(`fill.${name}`),
        checked: this._settings && this._settings.settings.fill === name })),
      onFill: (name) => this._settings && this._settings.update({ fill: name }),
      onFit: () => this._view && this._view.fit(),
    });
    this._menu = this._options.menu;
    ui.menuButton = this._options.menuButton;

    ui.canvas = h("canvas", { "aria-describedby": "mte-status" });
    ui.incomplete = h("div", { class: "banner incomplete float" }, h("strong"), h("span"));
    ui.lost = h("div", { class: "banner lost float", role: "alert" });
    ui.loading = h("div", { class: "banner loading float", role: "status" });
    ui.chipName = h("span", { class: "chip-name" });
    ui.chipDetails = h("button", { type: "button", class: "chip-details", on: { click: () => this._openDetails(this._selected, "button") } },
      icon("info", 18), h("span"));
    ui.chipClear = iconButton("close", "", () => this._select(null, "chip"));
    ui.chip = h("div", { class: "chip float" }, ui.chipName, ui.chipDetails, ui.chipClear);
    ui.top = h("div", { class: "top" }, ui.incomplete, ui.lost, ui.loading, ui.chip);
    ui.zoomIn = iconButton("plus", "", () => this._view && this._view.zoomIn());
    ui.zoomOut = iconButton("minus", "", () => this._view && this._view.zoomOut());
    ui.zoomFit = iconButton("fit", "", () => this._view && this._view.fit());
    ui.zoom = h("div", { class: "zoom float" }, ui.zoomIn, ui.zoomOut, ui.zoomFit);
    // Bottom left: the legend pill, collapsed or expanded as stored (settings.legendOpen).
    ui.mini = h("div", { class: "legend-box float" });
    ui.message = h("div", { class: "message" });

    this._drawer = new Drawer({ onChange: () => this._onDrawer() });
    this._drawer.fallback = ui.canvas;
    this._devicesTab = new DevicesTab({ onSelect: (id) => this._select(id, "list") });
    this._drawer.panel("devices").append(this._devicesTab.el);

    ui.map = h("div", { class: "map" }, ui.canvas, ui.top, ui.zoom, ui.mini, ui.titlePill, this._options.el,
      this._drawer.el, ui.message);
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
    ui.title.textContent = t("app.short_title");
    ui.title.title = t("app.title");
    ui.canvas.setAttribute("aria-label", t("map.label"));
    ui.lost.textContent = t("map.connection_lost");
    ui.loading.textContent = t("map.loading");
    ui.chipDetails.lastChild.textContent = t("selection.details");
    ui.status.setAttribute("aria-label", t("status.label"));
    for (const [button, key] of [[ui.sidebar, "header.sidebar"], [ui.zoomIn, "zoom.in"],
      [ui.zoomOut, "zoom.out"], [ui.zoomFit, "zoom.fit"], [ui.chipClear, "selection.clear"]]) {
      button.setAttribute("aria-label", t(key));
      button.title = t(key);
    }
    this._drawer.setTexts(t);
    if (this._source) {
      // The coordinator's label is translated, so the map gets the new network (same layout seed, same picture).
      this._network = localize(this._source, t);
      if (this._view) this._view.setTexts(this._graphTexts());
      if (this._view) this._view.setNetwork(this._network, { pinned: pinsForView(this._settings.settings.pins) });
      this._devicesTab.setNetwork(this._network, t);
      this._devicesTab.setSelected(this._selected);
      this._dirty = new Set(["details", "findings", "legend", "settings"]);
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
    if (!this._versionMismatch() && st.phase === "ready" && st.network && st.network !== this._source) {
      this._useNetwork(st.network, st.raw);
      return; // _useNetwork renders when the settings are in
    }
    this._render();
  }

  /** A new network from the controller: load its settings first (density, fill and pins shape the first picture),
   *  then show it. */
  async _useNetwork(network, raw) {
    const token = ++this._token;
    this._source = network;
    this._raw = new Map((raw || []).map((d) => [normalizeIeee(d && d.ieee), d]));
    if (!this._settings || this._settings.network !== network.id) {
      if (this._settings) this._settings.dispose();
      const client = new SettingsClient({ callWS: (msg) => this._hass.callWS(msg), network: network.id });
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
    await this._observe(network);
    if (token !== this._token) return;
    this._network = localize(network, this._t);
    if (this._selected && !this._network.devices.some((d) => d.id === this._selected)) this._selected = null;
    this._ensureView();
    this._view.setNetwork(this._network, { pinned: pinsForView(this._settings.settings.pins) });
    this._devicesTab.setNetwork(this._network, this._t);
    this._devicesTab.setSelected(this._selected);
    this._dirty = new Set(["details", "findings", "legend", "settings"]);
    this._render();
  }

  /** Record the tables of a freshly read network (spec 6). The stored observations are read for a new network, after
   *  a reconnect and after a read that met the lost connection. */
  async _observe(network) {
    let client = this._observations;
    if (!client || client.network !== network.id) {
      if (client) client.dispose();
      client = new ObservationsClient({ callWS: (msg) => this._hass.callWS(msg), network: network.id });
      client.addEventListener("change", () => { this._dirty.add("details").add("settings"); });
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
      debug: this._debug, texts: this._graphTexts() });
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
    }
    this._dirty.add("settings").add("legend");
    this._render();
  }

  // ---- rendering -----------------------------------------------------------------------------------------------

  _render() {
    const ui = this._ui;
    const t = this._t;
    const st = this._controller.state;
    const mismatch = this._versionMismatch();
    const ready = !mismatch && st.phase === "ready" && Boolean(this._network) && this._source === st.network;
    this._renderHeader(ready);

    for (const el of [ui.canvas, ui.top, ui.zoom, ui.mini, ui.status, this._options.el]) el.hidden = !ready;
    if (!ready) {
      ui.chip.hidden = true; // on narrow screens it sits on the map itself, outside ui.top
      this._drawer.close();
      this._renderMessage(mismatch ? "version" : st.phase === "ready" ? "loading" : st.phase, st.message);
      if (this._view) this._view.resize();
      return;
    }
    ui.message.hidden = true;
    if (this._view) this._view.resize();
    const net = this._network;

    // Status line (spec 6): source, tables, devices in a table, completeness, the 4-hour hint. "Observed unchanged
    // since" and the scan come with the next slice (observations through the integration); statusParts has the seam.
    this._renderStatus();
    const incomplete = isIncomplete(net.status);
    ui.incomplete.hidden = !incomplete;
    if (incomplete) {
      ui.incomplete.firstChild.textContent = t("map.incomplete");
      ui.incomplete.lastChild.textContent = t("map.incomplete_detail", { x: net.status.routersWithTable, y: net.status.routersAvailable });
    }
    ui.lost.hidden = st.connection !== "lost";
    ui.loading.hidden = !st.loading || st.connection === "lost";
    this._renderChip();
    // Above an expanded sheet the map keeps little room: the legend steps aside (the Legend tab is one tap away).
    // On narrow screens the selection chip takes its place at the bottom.
    ui.mini.hidden = (this._drawer.mode === "sheet" && this._drawer.isOpen && this._drawer.expanded)
      || (!this._wide && Boolean(this._selected) && !ui.chip.hidden);
    renderLegendPill(ui.mini, { t, theme: this._mapTheme(), fill: this._settings.settings.fill, roles: this._roles(),
      links: this._view ? this._view.legend() : [], open: this._legendOpen(),
      onToggle: () => this._settings.update({ legendOpen: !this._legendOpen() }),
      onMore: () => this._toggleTab("legend", ui.mini, false) });
    this._renderTabs();
  }

  /** Status line (spec 6): source, tables, devices in a table, completeness, "observed unchanged since" (with its
   *  caveat as the part's description), a followed scan with its stop button, the 4-hour hint. Below the wide
   *  breakpoint it is compact: short forms in at most two lines; the long forms are the parts' descriptions, and the
   *  hint and caveats stay in Details and on wide screens. */
  _renderStatus() {
    const t = this._t;
    const net = this._network;
    const newest = this._observations ? this._observations.newest(net) : null;
    const scan = this._scan && this._scan.state.status !== "idle" ? this._scan.state : null;
    const compact = !this._wide;
    const parts = statusParts(net, { unchangedSince: newest ? t.when(newest) : null, scan, compact });
    this._ui.status.classList.toggle("compact", compact);
    this._ui.status.replaceChildren(...parts.map(([key, params, long]) => {
      const span = h("span", { class: "part", text: t(key, params) });
      if (long) span.title = t(long, params);
      if (key === "status.unchanged" || key === "status.short_unchanged") {
        span.title = long ? `${t(long, params)}. ${t("status.unchanged_note")}` : t("status.unchanged_note");
      }
      if (key === "status.scan_running" || key === "status.short_scan_running") {
        span.append(" ", h("button", { type: "button", class: "link status-stop", text: t("status.scan_stop"),
          "aria-label": t("status.scan_stop_label"), on: { click: () => this._scan.stop() } }));
      }
      return span;
    }));
  }

  /** The title pill and the options group (the panel has no header bar, spec 9.1). */
  _renderHeader(ready = this._ui && !this._ui.canvas.hidden) {
    const ui = this._ui;
    const t = this._t;
    ui.sidebar.hidden = !this._narrow;
    this._options.el.hidden = !ready;
    if (!ready || !this._settings || !this._network) return;
    const s = this._settings.settings;
    this._options.update({ t, count: badgeCount(this._network.findings), density: t(`density.${s.density}`),
      fill: t(`fill.${s.fill}`) });
  }

  /** Whether the legend pill is expanded: as stored, else by width (expanded on wide panels, spec 11). */
  _legendOpen() {
    const stored = this._settings ? this._settings.settings.legendOpen : null;
    return stored === null || stored === undefined ? this._wide : stored;
  }

  /** Words the map draws itself: LQI 0 and the values of implied lanes. */
  _graphTexts() {
    const t = this._t;
    return { uncertain: t("lqi.uncertain"), parent: t("lane.parent"), route: t("lane.route") };
  }

  _renderMessage(phase, detail) {
    const ui = this._ui;
    const t = this._t;
    const kind = { not_admin: "warn", zha_not_loaded: "warn", no_devices: "", disconnected: "warn", error: "error", version: "warn" }[phase] || "";
    const retry = ["zha_not_loaded", "no_devices", "error"].includes(phase);
    const reload = phase === "version";
    ui.message.hidden = false;
    ui.message.className = `message ${kind}`.trim();
    ui.message.replaceChildren(h("p", { role: kind === "error" ? "alert" : "status", text: t(`message.${phase}`, { message: detail || "?" }) }));
    if (retry) ui.message.append(h("button", { type: "button", class: "button", text: t("message.retry"), on: { click: () => this._controller.reload() } }));
    // A stale panel file in the browser cache: only a page reload fetches the new one (spec 10).
    if (reload) ui.message.append(h("button", { type: "button", class: "button", text: t("message.reload"), on: { click: () => location.reload() } }));
  }

  /** The selection chip: name, a Details button (the info button of spec 9.2) and clear. Hidden while the drawer is
   *  on Details, where the collapsed sheet's one line already names the selection. */
  _renderChip() {
    const ui = this._ui;
    const device = this._device(this._selected);
    ui.chip.hidden = !device || (this._drawer.isOpen && this._drawer.tab === "details");
    if (!device) return;
    ui.chipName.textContent = device.label;
    ui.chipDetails.setAttribute("aria-label", this._t("selection.details_label", { name: device.label }));
  }

  /** Render the tab that can be seen, if its content is out of date; others wait until they are shown. */
  _renderTabs() {
    const d = this._drawer;
    const t = this._t;
    this._drawer.setSummary(this._summary());
    if (d.isOpen && d.tab === "devices") this._devicesTab.showActive();
    if (!d.isOpen || !this._dirty.has(d.tab)) return;
    const panel = d.panel(d.tab);
    this._dirty.delete(d.tab);
    if (d.tab === "details") {
      const seen = this._selected && this._observations ? this._observations.firstSeen(this._selected) : null;
      renderDetails(panel, { network: this._network, t, id: this._selected, debug: this._debug, raw: this._raw,
        observedSince: seen ? t.when(seen) : null,
        pinned: Boolean(this._selected && this._settings.settings.pins[this._selected]),
        onSelect: (id) => this._select(id, "list"), onRelease: (id) => this._release([id]) });
    } else if (d.tab === "findings") {
      renderFindings(panel, { network: this._network, t, selected: this._selected, onSelect: (id) => this._select(id, "list") });
    } else if (d.tab === "legend") {
      renderLegend(panel, { t, theme: this._mapTheme(), fill: this._settings.settings.fill, roles: this._roles(),
        devices: this._network ? this._network.devices : [], links: this._view ? this._view.legend() : [], debug: this._debug });
    } else if (d.tab === "settings") {
      keepFocus(this._root, panel, () => renderSettings(panel, { t, settings: this._settings.settings, wide: this._wide,
        pinCount: presentPins(this._settings.settings.pins, this._network).length, client: this._settings, idPrefix: "mte-settings",
        observations: this._debug ? this._observations : null,
        onChange: (patch) => this._settings.update(patch), onReleaseAll: () => this._release(null) }));
    }
  }

  /** One line for the collapsed sheet. */
  _summary() {
    const t = this._t;
    const d = this._drawer;
    if (d.tab === "details") {
      const device = this._device(this._selected);
      return device ? `${device.label} · ${device.available ? receptionText(device.rating, t) : t("devices.unavailable")}` : t("tab.details");
    }
    if (d.tab === "findings" && this._network) return t("header.findings_label", { count: badgeCount(this._network.findings) });
    if (d.tab === "devices" && this._network) return t("devices.count", { shown: this._network.devices.length, total: this._network.devices.length });
    if (d.tab === "legend" && this._settings) return t(`legend.fill_${this._settings.settings.fill}`);
    return t(`tab.${d.tab}`);
  }

  // ---- selection and drawer ------------------------------------------------------------------------------------

  /** Select a device (null clears). source: "map" (the view already selected it and keeps it clear of the drawer),
   *  "list" (Devices, Findings, a device named in Details: select and zoom to it, spec 9.3) or "chip". What the drawer
   *  does follows ui/drawer-rule.js. */
  _select(id, source) {
    const t = this._t;
    this._selected = id;
    if (source !== "map" && this._view) {
      this._view.select(id);
      if (id) this._view.reveal(id, this._view.insets, { zoom: true });
    }
    this._devicesTab.setSelected(id);
    markFindings(this._drawer.panel("findings"), id);
    this._dirty.add("details");
    const stored = this._settings ? this._settings.settings.openDetailsOnSelect : null;
    this._applyDrawer(afterSelect({ id, source, openOnSelect: openOnSelect(stored, this._wide), drawer: this._drawerState() }));
    const device = this._device(id);
    this._announce(device ? t("live.selected", { name: device.label, role: roleText(device.role, t),
      reception: device.available ? receptionText(device.rating, t) : t("devices.unavailable") }) : t("live.cleared"));
    this._render();
  }

  /** Details asked for explicitly (right-click, long press, menu key, the info button). */
  _openDetails(id, via) {
    if (id && id !== this._selected) this._select(id, via === "button" ? "chip" : "map");
    this._applyDrawer(detailsRequest(via), via === "button" ? this._ui.canvas : this._root.activeElement);
  }

  /** Header (badge, small legend; toggle) and menu (always opens): a tab of the drawer. */
  _toggleTab(tab, opener, toggle = true) {
    this._applyDrawer(tabRequest({ tab, drawer: this._drawerState(), toggle }), opener);
  }

  _drawerState() {
    const d = this._drawer;
    return { isOpen: d.isOpen, tab: d.tab, mode: d.mode, expanded: d.expanded, auto: this._drawerAuto };
  }

  /** Carry out an answer of drawer-rule.js. */
  _applyDrawer(answer, opener = null) {
    if (answer.action === "close") {
      this._drawer.close();
    } else if (answer.action === "open") {
      this._drawerAuto = answer.auto;
      this._drawer.open(answer.tab, { expanded: answer.expanded, focus: answer.focus, opener });
    }
  }

  _onDrawer() {
    if (!this._drawer.isOpen) this._drawerAuto = false;
    this._layout();
    this._render();
  }

  /** Sizes: wide or narrow, the drawer's mode and size, and the insets that keep the selection clear of it. */
  _layout() {
    if (!this._ui || !this._ui.map.isConnected) return;
    const rect = this._ui.map.getBoundingClientRect();
    if (!rect.width) return;
    const wide = isWide(rect.width);
    if (wide !== this._wide) {
      this._wide = wide;
      this._dirty.add("settings");
      this._renderHeader();
      if (this._network && !this._ui.status.hidden) this._render(); // status forms, legend default by width
    }
    const g = drawerGeometry({ width: rect.width, height: rect.height, open: this._drawer.isOpen, expanded: this._drawer.expanded });
    this._drawer.setMode(g.mode, g.size);
    // Floating groups: out of the drawer's way by the same insets that keep the selection clear of it.
    this._options.setMode(wide ? "rows" : "icons");
    const optionsBox = this._options.el.getBoundingClientRect();
    const f = floatingLayout({ width: rect.width, height: rect.height, insets: g.insets,
      options: { width: optionsBox.width, height: optionsBox.height } });
    this.style.setProperty("--inset-right", `${g.insets.right}px`);
    this.style.setProperty("--inset-bottom", `${g.insets.bottom}px`);
    this.style.setProperty("--band-right", `${f.band.right}px`);
    this.style.setProperty("--band-top", `${f.band.top}px`);
    this.style.setProperty("--legend-max-width", `${f.legend.maxWidth}px`);
    this.style.setProperty("--legend-max-height", `${f.legend.maxHeight}px`);
    // The selection chip: in the band below the title on wide screens, near the bottom (thumb reach) on narrow ones.
    const chipHome = f.chip.place === "band" ? this._ui.top : this._ui.map;
    if (this._ui.chip.parentNode !== chipHome) {
      if (chipHome === this._ui.top) this._ui.top.append(this._ui.chip); else this._ui.map.insertBefore(this._ui.chip, this._ui.zoom);
      this._ui.chip.classList.toggle("chip-bottom", chipHome !== this._ui.top);
    }
    if (this._view) this._view.setInsets(g.insets);
  }

  /** Release pins: the given ids, or all pins of devices in the network (null). */
  _release(ids) {
    const list = ids === null ? presentPins(this._settings.settings.pins, this._network) : ids;
    for (const id of list) if (this._view) this._view.unpin(id);
    this._settings.releasePins(list);
    this._dirty.add("details");
    this._render();
  }

  _menuItems() {
    const t = this._t;
    const pins = this._settings ? presentPins(this._settings.settings.pins, this._network).length : 0;
    return [
      { id: "devices", label: t("menu.devices") }, { id: "legend", label: t("menu.legend") },
      { id: "settings", label: t("menu.settings") }, { type: "separator" },
      { id: "debug", type: "checkbox", checked: this._debug, label: t("menu.debug") },
      { id: "fit", label: t("menu.fit") },
      { id: "release", label: t("menu.release_pins", { count: pins }), disabled: !pins },
      { id: "reload", label: t("menu.reload") },
      // The scan exists in debug mode only (spec 6, 9.1): it causes radio traffic.
      ...(this._debug ? [{ type: "separator" },
        this._scan && this._scan.running ? { id: "scan-stop", label: t("menu.scan_stop") } : null,
        { id: "scan", label: t(this._scan && this._scan.running ? "menu.scan_running" : "menu.scan"),
          disabled: Boolean(this._scan && this._scan.running) }].filter(Boolean) : []),
    ];
  }

  /** Ask, then start a scan and follow it (spec 6). */
  async _startScan() {
    const t = this._t;
    const ok = await confirmDialog(this._ui.app, { title: t("scan.title"),
      paragraphs: [t("scan.body_radio"), t("scan.body_auto"), t("scan.body_follow")],
      confirm: t("scan.confirm"), cancel: t("scan.cancel"), opener: this._ui.menuButton });
    if (!ok || !this._source) return;
    if (!this._scan) {
      const raws = new WeakMap();
      this._scan = new ScanFollower({
        send: () => sendScan(this._hass),
        read: async () => {
          const result = await readNetwork(this._hass);
          if (result.phase !== "ready") return null;
          raws.set(result.network, result.raw);
          return result.network;
        },
      });
      this._scan.addEventListener("read", (e) => {
        // Only a re-read whose tables differ reaches the map: no new layout every 15 seconds for nothing.
        const network = e.detail.network;
        if (tablesDiffer(this._source, network)) this._controller.adopt(network, raws.get(network));
      });
      this._scan.addEventListener("change", () => {
        const status = this._scan.state.status;
        if (status !== this._scanStatus) {
          if (status === "running") this._announce(t("live.scan_started"));
          else if (this._scanStatus === "running") this._announce(this._t("live.scan_over"));
          this._scanStatus = status;
        }
        if (this._network) this._renderStatus();
      });
    }
    this._scan.start(this._source);
  }

  _onMenu(id) {
    if (id === "devices" || id === "legend" || id === "settings") {
      this._toggleTab(id, this._ui.menuButton, false);
    } else if (id === "debug") {
      // Debug mode (spec 9.1): every pair as lanes with reporters, raw tables in Details. Never stored.
      this._debug = !this._debug;
      if (this._view) this._view.setDebug(this._debug);
      // Leaving debug mode clears what a finished scan left in the status line; a running one stays (spec 9.4).
      if (!this._debug && this._scan && !this._scan.running) this._scan.clear();
      this._dirty.add("details").add("legend").add("settings");
      this._render();
    } else if (id === "fit") {
      if (this._view) this._view.fit();
    } else if (id === "release") {
      this._release(null);
    } else if (id === "reload") {
      this._controller.reload();
    } else if (id === "scan") {
      this._startScan();
    } else if (id === "scan-stop") {
      if (this._scan) this._scan.stop();
    }
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
    this._dirty.add("legend");
    this._render();
  }

  _announce(text) {
    // Cleared first, so the same sentence twice is announced twice.
    this._ui.live.textContent = "";
    requestAnimationFrame(() => { this._ui.live.textContent = text; });
  }
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

/** Send zha/topology/update without waiting: ZHA never answers it (spec 3.1). The connection's sendMessage
 *  (home-assistant-js-websocket) sends without registering an answer, so nothing waits forever; it throws without a
 *  connection, which the scan reports. Without it, callWS is called and its promise left alone. */
function sendScan(hass) {
  const conn = hass && hass.connection;
  if (conn && typeof conn.sendMessage === "function") {
    conn.sendMessage({ type: "zha/topology/update" });
  } else {
    hass.callWS({ type: "zha/topology/update" }).catch(() => {});
  }
}

// Defined only if free: a second load of the module (or another add-on) must not throw.
if (!customElements.get(ELEMENT)) customElements.define(ELEMENT, MeshrouteTopologyExplorer);
