// SPDX-License-Identifier: MIT
// The options group at the top right of the map (decision by Fabian Schwamborn, 2026-10-31; spec 9.1): labelled rows
// on wide panels (icon and text: Options, Findings with its count, Links, Fill with its current value), one row of
// icons on narrow ones (options, findings count, links with the density value, fit). Options opens the menu; Links
// opens the class switches with the density below them (links-panel.js); Fill opens a single-choice menu.
// Every target is at least 44 px. Runs in the browser.
import { h, icon } from "./dom.js";
import { Menu } from "./menu.js";
import { LinksPanel } from "./links-panel.js";

export class OptionsGroup {
  /** handlers: menuItems() and onMenu(id) for the options menu; onFindings(button); links(), onLink(cls, on),
   *  densityItems(), onDensity(id) for the Links popover; fillItems(), onFill(id); onFit(). */
  constructor(handlers) {
    const row = (name, ...children) => h("button", { type: "button", class: `opt-row opt-${name}` }, ...children);
    this.menuButton = row("menu", icon("more"), h("span", { class: "opt-text" }));
    this.findingsButton = row("findings", icon("findings"), h("span", { class: "opt-text" }), h("span", { class: "count" }));
    this.linksButton = row("links", icon("density"), h("span", { class: "opt-text" }));
    this.fillButton = row("fill", icon("fill"), h("span", { class: "opt-text" }));
    this.fitButton = row("fit", icon("fit"));
    this.menu = new Menu(this.menuButton, { items: handlers.menuItems, onPick: handlers.onMenu });
    this.linksPanel = new LinksPanel(this.linksButton, handlers);
    this.fillMenu = new Menu(this.fillButton, { items: handlers.fillItems, onPick: handlers.onFill });
    this.findingsButton.addEventListener("click", () => handlers.onFindings(this.findingsButton));
    this.fitButton.addEventListener("click", () => handlers.onFit());
    const wrap = (button, pop) => h("div", { class: "menu-wrap" }, button, pop ? pop.el : null);
    this.el = h("nav", { class: "options float", "data-mode": "rows" },
      wrap(this.menuButton, this.menu), wrap(this.findingsButton), wrap(this.linksButton, this.linksPanel),
      wrap(this.fillButton, this.fillMenu), wrap(this.fitButton));
  }

  /** "rows" (wide: labelled rows) or "icons" (narrow: one row; fill moves to the menu's Settings, fit joins). */
  setMode(mode) {
    this.el.dataset.mode = mode;
    this.fillButton.parentNode.hidden = mode === "icons";
    this.fitButton.parentNode.hidden = mode !== "icons";
  }

  get mode() { return this.el.dataset.mode; }

  /** Texts and values: t, count (findings badge), density and fill names (translated). */
  update({ t, count, density, fill }) {
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
    label(this.fillButton, t("options.fill", { value: fill }));
    this.fitButton.setAttribute("aria-label", t("zoom.fit"));
    this.fitButton.title = t("zoom.fit");
  }

  closeMenus() {
    for (const m of [this.menu, this.linksPanel, this.fillMenu]) m.close(false);
  }
}
