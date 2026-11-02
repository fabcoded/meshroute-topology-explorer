// SPDX-License-Identifier: MIT
// The controls that float on the map (spec 9.1; "one place per thing"):
// top left the button "Devices" with the findings count, and below it the slide switch "Details on click" (only while
// the left panel is closed); top right "View" and below it "Legend". On narrow screens Home Assistant's sidebar button
// joins the left group (custom panels bring their own). The zoom group lives in the panel. Each button opens its
// panel; the switch is a real button with role "switch" and aria-checked. Every target is at least 44 px.
// Runs in the browser.
import { h, icon } from "./dom.js";

export class MapButtons {
  /** handlers: onSidebar(), onDevices(button), onSwitch(on), onView(button), onLegend(button). */
  constructor(handlers) {
    this.handlers = handlers;
    this.sidebar = h("button", { type: "button", class: "map-button map-sidebar", on: { click: () => handlers.onSidebar() } },
      icon("menu", 22));
    this.devices = h("button", { type: "button", class: "map-button map-devices",
      on: { click: () => handlers.onDevices(this.devices) } },
    icon("list", 22), h("span", { class: "map-text" }), h("span", { class: "badge" }));
    this.switchButton = h("button", { type: "button", role: "switch", class: "map-switch", "aria-checked": "false",
      on: { click: () => handlers.onSwitch(this.switchButton.getAttribute("aria-checked") !== "true") } },
    h("span", { class: "switch-pill" }, h("span", { class: "switch-track", "aria-hidden": "true" }, h("span", { class: "switch-knob" })),
      h("span", { class: "map-text" })));
    this.view = h("button", { type: "button", class: "map-button map-view", on: { click: () => handlers.onView(this.view) } },
      icon("sliders", 22), h("span", { class: "map-text" }));
    this.legend = h("button", { type: "button", class: "map-button map-legend", on: { click: () => handlers.onLegend(this.legend) } },
      icon("legend", 20), h("span", { class: "map-text" }));
    this.left = h("div", { class: "map-group map-left" }, h("div", { class: "map-row" }, this.sidebar, this.devices),
      this.switchButton);
    this.right = h("div", { class: "map-group map-right" }, this.view, this.legend);
  }

  /** State and texts. t: translator; count: findings badge; openOnSelect: the switch; narrow: Home Assistant's narrow
   *  flag (sidebar button); hideLeft, hideRight: a side panel covers that corner (wide screens); leftOpen: the left
   *  panel is open (the switch then lives in the View tab only). */
  update({ t, count, openOnSelect, narrow, hideLeft, hideRight, leftOpen }) {
    const set = (button, text, label) => {
      button.querySelector(".map-text").textContent = text;
      if (label) { button.setAttribute("aria-label", label); button.title = label; }
    };
    set(this.devices, t("map.devices"), t("map.devices_label", { count }));
    const badge = this.devices.querySelector(".badge");
    badge.textContent = t.number(count);
    this.devices.dataset.count = String(count);
    set(this.view, t("map.view"), t("map.view_label"));
    set(this.legend, t("map.legend"), t("map.legend_label"));
    this.switchButton.querySelector(".map-text").textContent = t("map.details_on_click");
    this.switchButton.setAttribute("aria-checked", String(Boolean(openOnSelect)));
    this.switchButton.title = t("map.details_on_click_note");
    this.sidebar.setAttribute("aria-label", t("header.sidebar"));
    this.sidebar.title = t("header.sidebar");
    this.sidebar.hidden = !narrow;
    this.left.hidden = Boolean(hideLeft);
    this.right.hidden = Boolean(hideRight);
    this.switchButton.hidden = Boolean(leftOpen);
  }
}
