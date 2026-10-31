// SPDX-License-Identifier: MIT
// Entry module of the Meshroute Topology Explorer panel: the quality view of a ZHA network (spec 6-11). Home
// Assistant loads it as a custom panel and sets `hass`, `narrow` and `panel` on the element (spec 10).
// Layout (spec 9.1): header (sidebar button on narrow screens, title, density, findings badge, menu), the map with
// zoom buttons and a small legend, one drawer (Details, Devices, Findings, Legend, Settings) and the status line.
// There is no view switch yet: the quality view is the only view of v1; the switch comes with the route view (v1.1).
// Data: ui/controller.js (load, errors, reconnect); settings: ui/settings.js; map: graph/graph-view.js.
// Only read-only websocket commands from spec 3.4 are used. Names are always set as text, never as HTML.
// Try it without Home Assistant: dev/panel.html.
import { GraphView } from "./graph/graph-view.js";
import { DENSITY } from "./graph/layout.js";
import { resolveTheme } from "./graph/palette.js";
import { normalizeIeee } from "./model/index.js";
import { PanelController } from "./ui/controller.js";
import { SettingsClient, pinsForView, DENSITY_NAMES } from "./ui/settings.js";
import { languageOf, translator, localize } from "./ui/i18n.js";
import { drawerGeometry, isWide } from "./ui/geometry.js";
import { Drawer } from "./ui/drawer.js";
import { DevicesTab } from "./ui/devices-tab.js";
import { renderDetails } from "./ui/details-tab.js";
import { renderFindings, markFindings } from "./ui/findings-tab.js";
import { renderLegend, renderMiniLegend } from "./ui/legend-tab.js";
import { renderSettings } from "./ui/settings-tab.js";
import { Menu } from "./ui/menu.js";
import { badgeCount } from "./ui/findings.js";
import { statusParts, isIncomplete } from "./ui/status.js";
import { receptionText, roleText } from "./ui/format.js";
import { readTheme, themeKey } from "./ui/theme.js";
import { h, icon, iconButton } from "./ui/dom.js";
import { STYLES } from "./ui/styles.js";

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
    this._controller = new PanelController();
    this._controller.addEventListener("change", () => this._onState());
    this._controller.addEventListener("reconnected", () => {
      this._announce(this._t("live.reloaded"));
      if (this._settings) this._settings.flush();
    });
    this._onMedia = () => this._applyTheme();
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
    this._media = globalThis.matchMedia ? matchMedia("(prefers-color-scheme: dark)") : null;
    if (this._media) this._media.addEventListener("change", this._onMedia);
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
    this._menu.close(false);
    if (this._settings) this._settings.flush();
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
    ui.densityText = h("span", { class: "density-text" });
    ui.densitySelect = h("select", { on: { change: (e) => this._settings && this._settings.update({ density: e.target.value }) } },
      DENSITY_NAMES.map((name) => h("option", { value: name })));
    ui.density = h("label", { class: "density" }, ui.densityText, ui.densitySelect);
    ui.badgeText = h("span", { class: "badge-label" });
    ui.badgeCount = h("span", { class: "count" });
    ui.badge = h("button", { type: "button", class: "badge", on: { click: () => this._toggleTab("findings", ui.badge) } },
      ui.badgeText, ui.badgeCount);
    ui.menuButton = h("button", { type: "button", class: "icon-button" }, icon("more"));
    this._menu = new Menu(ui.menuButton, { items: () => this._menuItems(), onPick: (id) => this._onMenu(id) });
    ui.toolbar = h("header", { class: "toolbar" }, ui.sidebar, ui.title, ui.density, ui.badge,
      h("div", { class: "menu-wrap" }, ui.menuButton, this._menu.el));

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
    ui.mini = h("button", { type: "button", class: "mini-legend float", on: { click: () => this._toggleTab("legend", ui.mini) } });
    ui.message = h("div", { class: "message" });

    this._drawer = new Drawer({ onChange: () => this._onDrawer() });
    this._drawer.fallback = ui.canvas;
    this._devicesTab = new DevicesTab({ onSelect: (id) => this._select(id, "list") });
    this._drawer.panel("devices").append(this._devicesTab.el);

    ui.map = h("div", { class: "map" }, ui.canvas, ui.top, ui.zoom, ui.mini, this._drawer.el, ui.message);
    ui.status = h("section", { class: "status", id: "mte-status" });
    ui.live = h("div", { class: "sr-only", "aria-live": "polite" });
    ui.probe = h("span", { class: "sr-only", "aria-hidden": "true" });
    this._root.append(h("style", { text: STYLES }), h("div", { class: "app" }, ui.toolbar, ui.map, ui.status, ui.live), ui.probe);
    this._resize = new ResizeObserver(() => this._layout());
    this._retranslate();
  }

  /** Texts that do not depend on data; called on build and when the language changes. */
  _retranslate() {
    const t = this._t;
    const ui = this._ui;
    ui.title.textContent = t("app.title");
    ui.densityText.textContent = t("header.density");
    for (const option of ui.densitySelect.options) option.textContent = t(`density.${option.value}`);
    ui.badgeText.textContent = t("header.findings");
    ui.canvas.setAttribute("aria-label", t("map.label"));
    ui.lost.textContent = t("map.connection_lost");
    ui.loading.textContent = t("map.loading");
    ui.chipDetails.lastChild.textContent = t("selection.details");
    ui.status.setAttribute("aria-label", t("status.label"));
    for (const [button, key] of [[ui.sidebar, "header.sidebar"], [ui.menuButton, "header.menu"], [ui.zoomIn, "zoom.in"],
      [ui.zoomOut, "zoom.out"], [ui.zoomFit, "zoom.fit"], [ui.chipClear, "selection.clear"]]) {
      button.setAttribute("aria-label", t(key));
      button.title = t(key);
    }
    this._drawer.setTexts(t);
    if (this._source) {
      // The coordinator's label is translated, so the map gets the new network (same layout seed, same picture).
      this._network = localize(this._source, t);
      if (this._view) this._view.setTexts({ uncertain: t("lqi.uncertain") });
      if (this._view) this._view.setNetwork(this._network, { pinned: pinsForView(this._settings.settings.pins) });
      this._devicesTab.setNetwork(this._network, t);
      this._devicesTab.setSelected(this._selected);
      this._dirty = new Set(["details", "findings", "legend", "settings"]);
    }
    this._onState();
  }

  // ---- state ---------------------------------------------------------------------------------------------------

  _versionMismatch() {
    return Boolean(this._panel && this._panel.config && this._panel.config.version !== VERSION);
  }

  _onState() {
    if (!this._ui) return;
    const st = this._controller.state;
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
      await client.load();
      if (token !== this._token) return;
    }
    this._network = localize(network, this._t);
    if (this._selected && !this._network.devices.some((d) => d.id === this._selected)) this._selected = null;
    this._ensureView();
    this._view.setNetwork(this._network, { pinned: pinsForView(this._settings.settings.pins) });
    this._devicesTab.setNetwork(this._network, this._t);
    this._devicesTab.setSelected(this._selected);
    this._dirty = new Set(["details", "findings", "legend", "settings"]);
    this._render();
  }

  _ensureView() {
    if (this._view) return;
    const s = this._settings.settings;
    const view = new GraphView(this._ui.canvas, { theme: this._readTheme(), density: DENSITY[s.density], fill: s.fill,
      debug: this._debug, texts: { uncertain: this._t("lqi.uncertain") } });
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

    for (const el of [ui.canvas, ui.top, ui.zoom, ui.mini, ui.status]) el.hidden = !ready;
    if (!ready) {
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
    ui.status.replaceChildren(...statusParts(net).map(([key, params]) => h("span", { class: "part", text: t(key, params) })));
    const incomplete = isIncomplete(net.status);
    ui.incomplete.hidden = !incomplete;
    if (incomplete) {
      ui.incomplete.firstChild.textContent = t("map.incomplete");
      ui.incomplete.lastChild.textContent = t("map.incomplete_detail", { x: net.status.routersWithTable, y: net.status.routersAvailable });
    }
    ui.lost.hidden = st.connection !== "lost";
    ui.loading.hidden = !st.loading || st.connection === "lost";
    // Above an expanded sheet the map keeps little room: the small legend steps aside (the Legend tab is one tap away).
    ui.mini.hidden = this._drawer.mode === "sheet" && this._drawer.isOpen && this._drawer.expanded;
    renderMiniLegend(ui.mini, { t, theme: this._mapTheme(), fill: this._settings.settings.fill, roles: this._roles() });
    this._renderChip();
    this._renderTabs();
  }

  _renderHeader(ready = this._ui && !this._ui.canvas.hidden) {
    const ui = this._ui;
    const t = this._t;
    ui.sidebar.hidden = !this._narrow;
    ui.toolbar.classList.toggle("narrow", this._narrow);
    ui.title.textContent = this._wide ? t("app.title") : t("app.short_title");
    ui.density.hidden = !ready;
    ui.badge.hidden = !ready;
    ui.menuButton.hidden = !ready;
    // On narrow screens the label of the density field is spoken but not shown.
    ui.densityText.className = this._wide ? "density-text" : "density-text sr-only";
    ui.badgeText.className = this._wide ? "badge-label" : "badge-label sr-only";
    if (ready && this._settings) ui.densitySelect.value = this._settings.settings.density;
    if (ready && this._network) {
      const count = badgeCount(this._network.findings);
      ui.badgeCount.textContent = t.number(count);
      ui.badge.dataset.count = String(count);
      ui.badge.setAttribute("aria-label", t("header.findings_label", { count }));
    }
  }

  _renderMessage(phase, detail) {
    const ui = this._ui;
    const t = this._t;
    const kind = { not_admin: "warn", zha_not_loaded: "warn", no_devices: "", disconnected: "warn", error: "error", version: "warn" }[phase] || "";
    const retry = ["zha_not_loaded", "no_devices", "error"].includes(phase);
    ui.message.hidden = false;
    ui.message.className = `message ${kind}`.trim();
    ui.message.replaceChildren(h("p", { role: kind === "error" ? "alert" : "status", text: t(`message.${phase}`, { message: detail || "?" }) }));
    if (retry) ui.message.append(h("button", { type: "button", class: "button", text: t("message.retry"), on: { click: () => this._controller.reload() } }));
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
      renderDetails(panel, { network: this._network, t, id: this._selected, debug: this._debug, raw: this._raw,
        pinned: Boolean(this._selected && this._settings.settings.pins[this._selected]),
        onSelect: (id) => this._select(id, "list"), onRelease: (id) => this._release([id]) });
    } else if (d.tab === "findings") {
      renderFindings(panel, { network: this._network, t, selected: this._selected, onSelect: (id) => this._select(id, "list") });
    } else if (d.tab === "legend") {
      renderLegend(panel, { t, theme: this._mapTheme(), fill: this._settings.settings.fill, roles: this._roles(), debug: this._debug });
    } else if (d.tab === "settings") {
      keepFocus(this._root, panel, () => renderSettings(panel, { t, settings: this._settings.settings, wide: this._wide,
        pinCount: Object.keys(this._settings.settings.pins).length, client: this._settings, idPrefix: "mte-settings",
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
   *  "list" (Devices, Findings, a device named in Details: select and zoom to it, spec 9.3) or "chip". */
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
    if (source === "map") {
      // "Open details on select" (spec 9.2) opens a closed drawer, or follows the selection on the Details tab; it
      // never takes another tab away from the user. On a narrow screen the sheet opens collapsed (spec 9.1).
      if (id && this._openOnSelect() && (!this._drawer.isOpen || this._drawer.tab === "details")) {
        this._drawerAuto = !this._drawer.isOpen || this._drawerAuto;
        this._drawer.open("details", { expanded: false });
      } else if (!id && this._drawerAuto && this._drawer.isOpen && this._drawer.tab === "details") {
        this._drawer.close();
      }
    }
    const device = this._device(id);
    this._announce(device ? t("live.selected", { name: device.label, role: roleText(device.role, t),
      reception: device.available ? receptionText(device.rating, t) : t("devices.unavailable") }) : t("live.cleared"));
    this._render();
  }

  _openOnSelect() {
    const stored = this._settings ? this._settings.settings.openDetailsOnSelect : null;
    return stored === null ? this._wide : stored;
  }

  /** Details asked for explicitly (right-click, long press, menu key, the info button): open expanded. */
  _openDetails(id, via) {
    if (id && id !== this._selected) this._select(id, via === "button" ? "chip" : "map");
    this._drawerAuto = false;
    const keyboard = via === "key" || via === "button";
    this._drawer.open("details", { expanded: true, focus: keyboard, opener: via === "button" ? this._ui.canvas : this._root.activeElement });
  }

  /** Header and menu: open a tab (or close it if it is already what the drawer shows). */
  _toggleTab(tab, opener) {
    if (this._drawer.visible(tab)) {
      this._drawer.close();
      return;
    }
    this._drawerAuto = false;
    this._drawer.open(tab, { expanded: true, focus: true, opener });
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
    }
    const g = drawerGeometry({ width: rect.width, height: rect.height, open: this._drawer.isOpen, expanded: this._drawer.expanded });
    this._drawer.setMode(g.mode, g.size);
    this.style.setProperty("--inset-right", `${g.insets.right}px`);
    this.style.setProperty("--inset-bottom", `${g.insets.bottom}px`);
    if (this._view) this._view.setInsets(g.insets);
  }

  /** Release pins: the given ids, or all (null). */
  _release(ids) {
    const all = ids === null;
    const list = all ? Object.keys(this._settings.settings.pins) : ids;
    for (const id of list) if (this._view) this._view.unpin(id);
    if (all) this._settings.clearPins(); else for (const id of list) this._settings.removePin(id);
    this._dirty.add("details");
    this._render();
  }

  _menuItems() {
    const t = this._t;
    const pins = this._settings ? Object.keys(this._settings.settings.pins).length : 0;
    return [
      { id: "devices", label: t("menu.devices") }, { id: "legend", label: t("menu.legend") },
      { id: "settings", label: t("menu.settings") }, { type: "separator" },
      { id: "debug", type: "checkbox", checked: this._debug, label: t("menu.debug") },
      { id: "fit", label: t("menu.fit") },
      { id: "release", label: t("menu.release_pins", { count: pins }), disabled: !pins },
      { id: "reload", label: t("menu.reload") },
    ];
  }

  _onMenu(id) {
    if (id === "devices" || id === "legend" || id === "settings") {
      this._drawerAuto = false;
      this._drawer.open(id, { expanded: true, focus: true, opener: this._ui.menuButton });
    } else if (id === "debug") {
      // Debug mode (spec 9.1): every pair as lanes with reporters, raw tables in Details. Never stored.
      this._debug = !this._debug;
      if (this._view) this._view.setDebug(this._debug);
      this._dirty.add("details").add("legend");
      this._render();
    } else if (id === "fit") {
      if (this._view) this._view.fit();
    } else if (id === "release") {
      this._release(null);
    } else if (id === "reload") {
      this._controller.reload();
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

// Defined only if free: a second load of the module (or another add-on) must not throw.
if (!customElements.get(ELEMENT)) customElements.define(ELEMENT, MeshrouteTopologyExplorer);
