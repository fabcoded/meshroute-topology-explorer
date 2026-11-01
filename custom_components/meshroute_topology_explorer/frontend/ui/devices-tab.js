// SPDX-License-Identifier: MIT
// The Devices tab of the left panel: a search field, a line on what a click does, and a single-select listbox of every
// device, the keyboard path to each of them (spec 9.3). Arrows move the active row, Enter (or a click) selects the
// device and zooms to it; with "Details on click" on, the panel then shows its Details. Focus stays on the listbox;
// the active row is announced through aria-activedescendant (WAI-ARIA listbox pattern). Runs in the browser; the
// keyboard model is ListModel in device-list.js.
import { h } from "./dom.js";
import { ListModel, deviceRows } from "./device-list.js";
import { receptionText, roleText } from "./format.js";

let uid = 0;

export class DevicesTab {
  /** onSelect(id): select and reveal with zoom. */
  constructor({ onSelect }) {
    this.onSelect = onSelect;
    this.model = new ListModel();
    this.t = null;
    this.selected = null;
    this._countText = null;
    this.prefix = `mte-dev-${++uid}-`;
    this.filter = h("input", { type: "search", class: "filter", autocomplete: "off", spellcheck: false,
      on: { input: () => this._onFilter(), keydown: (e) => this._onFilterKey(e) } });
    this.count = h("p", { class: "muted small", "aria-live": "polite" });
    this.searchText = h("span", { class: "filter-title" });
    this.hint = h("p", { class: "muted small devices-hint" });
    this.list = h("ul", { role: "listbox", class: "devices", tabIndex: 0, on: { keydown: (e) => this._onKey(e) } });
    this.el = h("div", { class: "devices-tab" }, h("label", { class: "filter-label" }, this.searchText, this.filter),
      this.hint, this.count, this.list);
  }

  setNetwork(network, t) {
    this.t = t;
    this.model.setRows(deviceRows(network));
    this.searchText.textContent = t("devices.search");
    this.filter.placeholder = t("devices.filter");
    this.list.setAttribute("aria-label", t("devices.list"));
    this._render();
  }

  /** The line under the search field: what a click on a device does, by "Details on click". */
  setHint(openOnSelect) {
    if (this.t) this.hint.textContent = this.t(openOnSelect ? "devices.hint_on" : "devices.hint_off");
  }

  /** The selected device changed elsewhere (map, findings): mark it and make it the active row. */
  setSelected(id) {
    this.selected = id;
    if (id) this.model.activate(id);
    this._render();
  }

  /** Scroll the active row into view (the tab was hidden while the selection changed). */
  showActive() {
    const node = this.model.activeId && this.list.querySelector(`[id="${this.prefix + this.model.activeId.replace(/:/g, "")}"]`);
    if (node && node.scrollIntoView) node.scrollIntoView({ block: "nearest" });
  }

  _onFilter() {
    this.model.setFilter(this.filter.value);
    this._render();
  }

  _onFilterKey(e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (this.model.activeIndex < 0) this.model.key("Home");
      this._render();
      this.list.focus();
    } else if (e.key === "Enter" && this.model.visible.length === 1) {
      e.preventDefault();
      this.onSelect(this.model.visible[0].id);
    }
  }

  _onKey(e) {
    const result = this.model.key(e.key);
    if (!result) return;
    e.preventDefault();
    this._render();
    if (result.action === "select") this.onSelect(result.id);
  }

  _render() {
    const t = this.t;
    if (!t) return;
    const rows = this.model.visible;
    // The count is a live region: written only when it changes, so arrow keys do not repeat it.
    const countText = rows.length ? t("devices.count", { shown: rows.length, total: this.model.rows.length }) : t("devices.none");
    if (countText !== this._countText) {
      this.count.textContent = countText;
      this._countText = countText;
    }
    this.list.replaceChildren(...rows.map((r) => {
      const kind = r.kind && r.kind !== "unknown" ? t(`kind_short.${r.kind}`) : null;
      const meta = [kind, roleText(r.role, t), r.area, r.available ? receptionText(r.rating, t) : t("devices.unavailable")]
        .filter(Boolean).join(" · ");
      return h("li", { role: "option", id: this.prefix + r.id.replace(/:/g, ""), class: "device-row",
        "aria-selected": r.id === this.selected ? "true" : "false",
        "data-active": r.id === this.model.activeId ? "true" : null,
        on: { click: () => { this.model.activate(r.id); this._render(); this.onSelect(r.id); },
          // Keep focus on the listbox when a row is pressed, so the keyboard path continues from there.
          mousedown: (e) => { e.preventDefault(); this.list.focus(); } } },
      h("span", { class: "row-label", text: r.label }), h("span", { class: "row-meta", text: meta }));
    }));
    const active = this.model.activeId ? this.prefix + this.model.activeId.replace(/:/g, "") : null;
    if (active) this.list.setAttribute("aria-activedescendant", active); else this.list.removeAttribute("aria-activedescendant");
    this.showActive();
  }
}
