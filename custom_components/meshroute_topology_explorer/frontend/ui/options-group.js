// SPDX-License-Identifier: MIT
// The options group at the top right of the map (decision by Fabian Schwamborn, 2026-10-31; spec 9.1): labelled rows
// on wide panels (icon and text: Options, Findings with its count, Links, Node view and Fill with their current
// values), one row of icons on narrow ones (options, findings count, links with the density value, fit). Options opens
// the menu; Links opens the class switches, colour by reception and the density (links-panel.js); Node view (what a
// selected device shows, request by Fabian Schwamborn, 2026-11-01) and Fill open single-choice menus. On narrow
// panels both live in the Settings tab.
// Every target is at least 44 px. Runs in the browser.
import { h, icon } from "./dom.js";
import { Menu } from "./menu.js";
import { LinksPanel } from "./links-panel.js";

export class OptionsGroup {
  /** handlers: menuItems() and onMenu(id) for the options menu; onFindings(button); links(), onLink(cls, on),
   *  colors(), onColors(on), densityItems(), onDensity(id) for the Links popover; nodeViewItems(), onNodeView(id);
   *  fillItems(), onFill(id); onFit(). */
  constructor(handlers) {
    const row = (name, ...children) => h("button", { type: "button", class: `opt-row opt-${name}` }, ...children);
    this.menuButton = row("menu", icon("more"), h("span", { class: "opt-text" }));
    this.findingsButton = row("findings", icon("findings"), h("span", { class: "opt-text" }), h("span", { class: "count" }));
    this.linksButton = row("links", icon("density"), h("span", { class: "opt-text" }));
    this.nodeViewButton = row("nodeview", icon("path"), h("span", { class: "opt-text" }));
    this.fillButton = row("fill", icon("fill"), h("span", { class: "opt-text" }));
    this.fitButton = row("fit", icon("fit"));
    this.menu = new Menu(this.menuButton, { items: handlers.menuItems, onPick: handlers.onMenu });
    this.linksPanel = new LinksPanel(this.linksButton, handlers);
    this.nodeViewMenu = new Menu(this.nodeViewButton, { items: handlers.nodeViewItems, onPick: handlers.onNodeView });
    this.fillMenu = new Menu(this.fillButton, { items: handlers.fillItems, onPick: handlers.onFill });
    this.findingsButton.addEventListener("click", () => handlers.onFindings(this.findingsButton));
    this.fitButton.addEventListener("click", () => handlers.onFit());
    const wrap = (button, pop) => h("div", { class: "menu-wrap" }, button, pop ? pop.el : null);
    this.el = h("nav", { class: "options float", "data-mode": "rows" },
      wrap(this.menuButton, this.menu), wrap(this.findingsButton), wrap(this.linksButton, this.linksPanel),
      wrap(this.nodeViewButton, this.nodeViewMenu), wrap(this.fillButton, this.fillMenu), wrap(this.fitButton));
  }

  /** "rows" (wide: labelled rows) or "icons" (narrow: one row; node view and fill move to the menu's Settings, fit
   *  joins). */
  setMode(mode) {
    this.el.dataset.mode = mode;
    this.nodeViewButton.parentNode.hidden = mode === "icons";
    this.fillButton.parentNode.hidden = mode === "icons";
    this.fitButton.parentNode.hidden = mode !== "icons";
  }

  get mode() { return this.el.dataset.mode; }

  /** Texts and values: t, count (findings badge), density, node view and fill names (translated). */
  update({ t, count, density, nodeView, fill }) {
    this.el.setAttribute("aria-label", t("options.label"));
    const label = (button, text, aria) => {
      button.querySelector(".opt-text").textContent = text;
      button.setAttribute("aria-label", aria || text);
      button.title = aria || text;
    };
    label(this.menuButton, t("options.menu"));
    label(this.findingsButton, t("options.findings"), t("header.findings_label", { count }));
    this.findingsButton.querySelector(".count").textContent = t.number(count);
    this.findingsButton.dataset.count = String(count);
    label(this.linksButton, t("links.title"), t("options.links", { value: density }));
    this.linksPanel.update(t);
    label(this.nodeViewButton, t("options.nodeview", { value: nodeView }));
    label(this.fillButton, t("options.fill", { value: fill }));
    this.fitButton.setAttribute("aria-label", t("zoom.fit"));
    this.fitButton.title = t("zoom.fit");
  }

  closeMenus() {
    for (const m of [this.menu, this.linksPanel, this.nodeViewMenu, this.fillMenu]) m.close(false);
  }
}
