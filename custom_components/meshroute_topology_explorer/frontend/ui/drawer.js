// SPDX-License-Identifier: MIT
// One of the panel's two panels (spec 9.1; design by Fabian Schwamborn, 2026-11-01): the left one with the tabs
// Devices, Findings and Details, the right one with View and Legend. A side panel on its side on wide screens, a
// bottom sheet on narrow ones (collapsed to one line, or expanded); WAI-ARIA tabs pattern: arrows move between tabs and
// activate them, Home/End jump. It is not modal: the map stays usable beside it. Closing returns focus to where it was
// opened (spec 9.3). Sizes come from geometry.js. Runs in the browser.
import { h, icon } from "./dom.js";

export const LEFT_TABS = Object.freeze(["devices", "findings", "details"]);
export const RIGHT_TABS = Object.freeze(["view", "legend"]);
let uid = 0;

export class Drawer {
  /** tabs: the tab names in order; side: "left" or "right" (its place on wide screens); onChange(): open state, tab,
   *  mode or expansion changed (the panel updates insets and content). */
  constructor({ tabs, side = "right", onChange }) {
    this.onChange = onChange;
    this.tabNames = tabs;
    this.side = side;
    this.isOpen = false;
    this.tab = tabs[0];
    this.mode = "side";
    this.expanded = false;
    this.opener = null;
    this.fallback = null; // where focus goes on close when the opener is gone (the map)
    this.t = (key) => key;
    const id = `mte-drawer-${++uid}`;
    this.tabs = new Map();
    this.panels = new Map();
    this.tablist = h("div", { role: "tablist", class: "tabs", on: { keydown: (e) => this._onTabKey(e), scroll: () => this._overflow() } });
    for (const name of tabs) {
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
    this.el = h("aside", { class: "drawer", "data-side": side, hidden: true, on: { keydown: (e) => this._onKey(e) } },
      this.head, this.body);
    if (globalThis.ResizeObserver) new ResizeObserver(() => this._overflow()).observe(this.tablist);
    this._sync();
  }

  /** Texts; label: the panel's accessible name. A tab's text may carry a count (setTabCount). */
  setTexts(t, label) {
    this.t = t;
    this.el.setAttribute("aria-label", label);
    for (const [name, tab] of this.tabs) {
      tab.replaceChildren(h("span", { text: t(`tab.${name}`) }));
      if (this._counts && this._counts.has(name)) this.setTabCount(name, this._counts.get(name));
    }
    for (const [button, key] of [[this.collapseButton, "drawer.collapse"], [this.closeButton, "drawer.close"]]) {
      button.setAttribute("aria-label", t(key));
      button.title = t(key);
    }
    this.expandButton.setAttribute("aria-label", `${t(`tab.${this.tab}`)}: ${this.summary.textContent}. ${t("drawer.expand")}`);
    this._overflow();
  }

  /** A number after a tab's name (Findings 5), or null for none. */
  setTabCount(name, count) {
    if (!this._counts) this._counts = new Map();
    this._counts.set(name, count);
    const tab = this.tabs.get(name);
    if (!tab) return;
    let badge = tab.querySelector(".tab-count");
    if (count === null || count === undefined) { if (badge) badge.remove(); return; }
    if (!badge) { badge = h("span", { class: "tab-count" }); tab.append(" ", badge); }
    badge.textContent = this.t.number ? this.t.number(count) : String(count);
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
    this.tab = this.tabNames.includes(tab) ? tab : this.tab;
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
    // Where the tabs scroll sideways: keep the active one in sight.
    const active = this.tabs.get(this.tab);
    if (this.isOpen && !collapsed && active.scrollIntoView) active.scrollIntoView({ block: "nearest", inline: "nearest" });
    this._overflow();
  }

  /** Mark the edges of the tab row that hide tabs, for the fade that says "more this way". */
  _overflow() {
    const list = this.tablist;
    const more = list.scrollWidth - list.clientWidth > 1;
    list.toggleAttribute("data-more-start", more && list.scrollLeft > 1);
    list.toggleAttribute("data-more-end", more && list.scrollLeft + list.clientWidth < list.scrollWidth - 1);
  }

  _onTabKey(e) {
    const names = this.tabNames;
    const i = names.indexOf(this.tab);
    let next = null;
    if (e.key === "ArrowRight") next = (i + 1) % names.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + names.length) % names.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = names.length - 1;
    if (next === null) return;
    e.preventDefault();
    this.show(names[next]);
    this.tabs.get(names[next]).focus();
  }

  /** Move focus into the shown tab's content (a list selection switched to Details while focus was in the panel). */
  focusPanel() {
    const panel = this.panels.get(this.tab);
    if (panel && !panel.hidden) panel.focus();
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
