// SPDX-License-Identifier: MIT
// The one drawer of the panel (spec 9.1): a side panel on wide screens, a bottom sheet on narrow ones (collapsed to
// one line, or expanded), with the tabs Details, Devices, Findings, Legend and Settings (WAI-ARIA tabs pattern:
// arrows move between tabs and activate them, Home/End jump). It is not modal: the map stays usable beside it.
// Closing returns focus to where it was opened (spec 9.3). Sizes come from geometry.js. Runs in the browser.
import { h, icon } from "./dom.js";

export const TABS = Object.freeze(["details", "devices", "findings", "legend", "settings"]);
let uid = 0;

export class Drawer {
  /** onChange(): open state, tab, mode or expansion changed (the panel updates insets and content). */
  constructor({ onChange }) {
    this.onChange = onChange;
    this.isOpen = false;
    this.tab = "details";
    this.mode = "side";
    this.expanded = false;
    this.opener = null;
    this.fallback = null; // where focus goes on close when the opener is gone (the map)
    this.t = (key) => key;
    const id = `mte-drawer-${++uid}`;
    this.tabs = new Map();
    this.panels = new Map();
    this.tablist = h("div", { role: "tablist", class: "tabs", on: { keydown: (e) => this._onTabKey(e) } });
    for (const name of TABS) {
      const tab = h("button", { type: "button", role: "tab", id: `${id}-tab-${name}`, class: "tab",
        "aria-controls": `${id}-panel-${name}`, on: { click: () => this.show(name) } });
      const panel = h("div", { role: "tabpanel", id: `${id}-panel-${name}`, class: "tabpanel", "aria-labelledby": tab.id,
        tabIndex: 0, hidden: true });
      this.tabs.set(name, tab);
      this.panels.set(name, panel);
      this.tablist.append(tab);
    }
    this.summary = h("span", { class: "summary-text" });
    this.expandButton = h("button", { type: "button", class: "sheet-line", "aria-expanded": "false",
      on: { click: () => this.setExpanded(true, true) } }, this.summary, icon("up"));
    this.collapseButton = h("button", { type: "button", class: "icon-button", on: { click: () => this.setExpanded(false) } },
      icon("down"));
    this.closeButton = h("button", { type: "button", class: "icon-button", on: { click: () => this.close() } }, icon("close"));
    this.head = h("div", { class: "drawer-head" }, this.expandButton, this.tablist, this.collapseButton, this.closeButton);
    this.body = h("div", { class: "drawer-body" }, [...this.panels.values()]);
    this.el = h("aside", { class: "drawer", hidden: true, on: { keydown: (e) => this._onKey(e) } }, this.head, this.body);
    this._sync();
  }

  setTexts(t) {
    this.t = t;
    this.el.setAttribute("aria-label", t("drawer.label"));
    for (const [name, tab] of this.tabs) tab.textContent = t(`tab.${name}`);
    for (const [button, key] of [[this.collapseButton, "drawer.collapse"], [this.closeButton, "drawer.close"]]) {
      button.setAttribute("aria-label", t(key));
      button.title = t(key);
    }
    this.expandButton.setAttribute("aria-label", `${t(`tab.${this.tab}`)}: ${this.summary.textContent}. ${t("drawer.expand")}`);
  }

  /** The one-line summary of the collapsed sheet (the selected device, or the tab's count). */
  setSummary(text) {
    this.summary.textContent = text;
    this.expandButton.setAttribute("aria-label", `${this.t(`tab.${this.tab}`)}: ${text}. ${this.t("drawer.expand")}`);
  }

  /** "side" or "sheet"; the panel decides from the width (geometry.js). */
  setMode(mode, size) {
    this.mode = mode;
    this.el.dataset.mode = mode;
    this.el.style.setProperty("--drawer-size", `${size}px`);
    this._sync();
  }

  /** Open on a tab. expanded: for the sheet; focus: move focus into the drawer (explicit requests from keyboard or
   *  header), remembering where it came from. */
  open(tab, { expanded = true, focus = false, opener = null } = {}) {
    const wasOpen = this.isOpen;
    this.isOpen = true;
    this.tab = TABS.includes(tab) ? tab : this.tab;
    this.expanded = expanded || (wasOpen && this.expanded);
    if (focus || !wasOpen) this.opener = opener || this.opener;
    this._sync();
    if (focus) this._focusTab();
    this.onChange();
  }

  show(tab) {
    this.tab = tab;
    this._sync();
    this.onChange();
  }

  setExpanded(on, focus = false) {
    this.expanded = on;
    this._sync();
    if (focus) this._focusTab();
    this.onChange();
  }

  close() {
    if (!this.isOpen) return;
    const opener = this.opener;
    const hadFocus = this.el.contains(this.el.getRootNode().activeElement);
    this.isOpen = false;
    this.opener = null;
    this._sync();
    this.onChange();
    const target = opener && opener.isConnected && opener.offsetParent !== null ? opener : this.fallback;
    if (hadFocus && target && target.focus) target.focus();
  }

  panel(name) { return this.panels.get(name); }

  /** Whether the content of a tab can be seen right now (open, that tab, not a collapsed sheet). */
  visible(name) {
    return this.isOpen && this.tab === name && (this.mode === "side" || this.expanded);
  }

  _focusTab() {
    const target = this.mode === "sheet" && !this.expanded ? this.expandButton : this.tabs.get(this.tab);
    target.focus();
  }

  _sync() {
    this.el.hidden = !this.isOpen;
    const collapsed = this.mode === "sheet" && !this.expanded;
    this.el.dataset.collapsed = collapsed ? "true" : "false";
    this.expandButton.hidden = !collapsed;
    this.tablist.hidden = collapsed;
    this.collapseButton.hidden = this.mode !== "sheet" || collapsed;
    this.expandButton.setAttribute("aria-expanded", String(!collapsed));
    this.body.hidden = collapsed;
    for (const [name, tab] of this.tabs) {
      const on = name === this.tab;
      tab.setAttribute("aria-selected", String(on));
      tab.tabIndex = on ? 0 : -1;
      this.panels.get(name).hidden = !on;
    }
  }

  _onTabKey(e) {
    const i = TABS.indexOf(this.tab);
    let next = null;
    if (e.key === "ArrowRight") next = (i + 1) % TABS.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    if (next === null) return;
    e.preventDefault();
    this.show(TABS[next]);
    this.tabs.get(TABS[next]).focus();
  }

  _onKey(e) {
    if (e.key !== "Escape") return;
    // A filter field's own Esc (clear) comes first; a second Esc closes.
    if (e.target && e.target.type === "search" && e.target.value) return;
    e.preventDefault();
    e.stopPropagation();
    this.close();
  }
}
