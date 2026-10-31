// SPDX-License-Identifier: MIT
// The options group at the top right of the map (decision by Fabian Schwamborn, 2026-10-31; spec 9.1): labelled rows
// on wide panels (icon and text: Options, Findings with its count, Density and Fill with their current value), one
// row of icons on narrow ones (options, findings count, density value, fit). Options opens the menu; Density and Fill
// open a single-choice menu each. Every target is at least 44 px. Runs in the browser.
import { h, icon } from "./dom.js";
import { Menu } from "./menu.js";

export class OptionsGroup {
  /** handlers: menuItems() and onMenu(id) for the options menu; onFindings(button); densityItems(), onDensity(id);
   *  fillItems(), onFill(id); onFit(). */
  constructor(handlers) {
    const row = (name, ...children) => h("button", { type: "button", class: `opt-row opt-${name}` }, ...children);
    this.menuButton = row("menu", icon("more"), h("span", { class: "opt-text" }));
    this.findingsButton = row("findings", icon("findings"), h("span", { class: "opt-text" }), h("span", { class: "count" }));
    this.densityButton = row("density", icon("density"), h("span", { class: "opt-text" }), h("span", { class: "opt-value" }));
    this.fillButton = row("fill", icon("fill"), h("span", { class: "opt-text" }));
    this.fitButton = row("fit", icon("fit"));
    this.menu = new Menu(this.menuButton, { items: handlers.menuItems, onPick: handlers.onMenu });
    this.densityMenu = new Menu(this.densityButton, { items: handlers.densityItems, onPick: handlers.onDensity });
    this.fillMenu = new Menu(this.fillButton, { items: handlers.fillItems, onPick: handlers.onFill });
    this.findingsButton.addEventListener("click", () => handlers.onFindings(this.findingsButton));
    this.fitButton.addEventListener("click", () => handlers.onFit());
    const wrap = (button, menu) => h("div", { class: "menu-wrap" }, button, menu ? menu.el : null);
    this.el = h("nav", { class: "options float", "data-mode": "rows" },
      wrap(this.menuButton, this.menu), wrap(this.findingsButton), wrap(this.densityButton, this.densityMenu),
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
    label(this.densityButton, t("options.density", { value: density }));
    this.densityButton.querySelector(".opt-value").textContent = density;
    label(this.fillButton, t("options.fill", { value: fill }));
    this.fitButton.setAttribute("aria-label", t("zoom.fit"));
    this.fitButton.title = t("zoom.fit");
  }

  closeMenus() {
    for (const m of [this.menu, this.densityMenu, this.fillMenu]) m.close(false);
  }
}
