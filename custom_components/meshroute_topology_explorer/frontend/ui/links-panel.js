// SPDX-License-Identifier: MIT
// The "Links" popover of the options group (decision by Fabian Schwamborn, 2026-11-01; spec 9.1): one checkbox per
// link class (up path, other routes, heard only) and, right below, the density as a single choice. Real checkboxes
// and radios inside labels, so state is announced and every target is at least 44 px. Unlike a menu it stays open
// while the user switches several classes; Esc and a press outside close it. Runs in the browser.
import { h } from "./dom.js";
import { LINK_CLASSES } from "./links-rows.js";

export class LinksPanel {
  /** button: the group's Links row; handlers: links() -> { up, route, heard }, onLink(cls, on); densityItems() ->
   *  [{ id, label, checked }], onDensity(id). Texts arrive with update(). */
  constructor(button, handlers) {
    this.button = button;
    this.handlers = handlers;
    this.el = h("div", { class: "menu-pop links-pop", role: "group", hidden: true, id: "mte-links-pop",
      on: { keydown: (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); this.close(true); } } } });
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-controls", "mte-links-pop");
    button.addEventListener("click", () => (this.isOpen ? this.close(true) : this.open()));
    this._outside = (e) => { if (!e.composedPath().includes(this.el) && !e.composedPath().includes(this.button)) this.close(false); };
    this._t = (k) => k;
  }

  get isOpen() { return !this.el.hidden; }

  open() {
    this.el.hidden = false;
    this.button.setAttribute("aria-expanded", "true");
    this.render();
    const first = this.el.querySelector("input");
    if (first) first.focus();
    window.addEventListener("pointerdown", this._outside, true);
  }

  close(returnFocus) {
    if (!this.isOpen) return;
    this.el.hidden = true;
    this.button.setAttribute("aria-expanded", "false");
    window.removeEventListener("pointerdown", this._outside, true);
    if (returnFocus) this.button.focus();
  }

  /** Keep the translation function; redraw if open so the state follows the settings. */
  update(t) {
    this._t = t;
    this.el.setAttribute("aria-label", t("links.title"));
    if (this.isOpen) this.render();
  }

  /** Rebuilt on every change; the focused input is found again by its name so the keyboard stays where it was. */
  render() {
    const t = this._t;
    const root = this.el.getRootNode();
    const focused = root.activeElement && this.el.contains(root.activeElement) ? root.activeElement.dataset.key : null;
    const links = this.handlers.links();
    const row = (type, name, key, label, checked, onChange) => h("label", { class: "check-row" },
      h("input", { type, name, checked, "data-key": key, on: { change: onChange } }), h("span", { text: label }));
    this.el.replaceChildren(
      h("div", { class: "pop-head", text: t("links.title") }),
      ...LINK_CLASSES.map((c) => row("checkbox", "link", `link-${c}`, t(`links.${c}`), Boolean(links[c]),
        (e) => this.handlers.onLink(c, e.target.checked))),
      h("div", { class: "sep", role: "separator" }),
      h("div", { class: "pop-head", text: t("links.density") }),
      ...this.handlers.densityItems().map((d) => row("radio", "density", `density-${d.id}`, d.label, d.checked,
        () => this.handlers.onDensity(d.id))));
    if (focused) {
      const again = this.el.querySelector(`[data-key="${focused}"]`);
      if (again) again.focus();
    }
  }
}
