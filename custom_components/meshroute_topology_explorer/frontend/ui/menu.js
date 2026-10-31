// SPDX-License-Identifier: MIT
// The header's overflow menu (WAI-ARIA menu button pattern): opens below its button, arrows move, Enter or Space
// picks, Esc closes and returns focus to the button, a press outside closes it. Runs in the browser.
import { h } from "./dom.js";

export class Menu {
  /** button: the menu button; items(): [{ id, label, type: "item" | "checkbox" | "radio" | "separator", checked,
   *  disabled }]; onPick(id). Radio items are a single choice (density, fill): the checked one is marked. */
  constructor(button, { items, onPick }) {
    this.button = button;
    this.items = items;
    this.onPick = onPick;
    this.el = h("div", { role: "menu", class: "menu-pop", hidden: true, on: { keydown: (e) => this._onKey(e) } });
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", "false");
    button.addEventListener("click", () => (this.isOpen ? this.close(true) : this.open()));
    button.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); this.open(e.key === "ArrowUp" ? -1 : 0); }
    });
    this._outside = (e) => { if (!e.composedPath().includes(this.el) && !e.composedPath().includes(this.button)) this.close(false); };
  }

  get isOpen() { return !this.el.hidden; }

  open(focusIndex = 0) {
    this.el.replaceChildren(...this.items().map((it) => {
      if (it.type === "separator") return h("div", { role: "separator", class: "sep" });
      const role = it.type === "checkbox" ? "menuitemcheckbox" : it.type === "radio" ? "menuitemradio" : "menuitem";
      const checkable = it.type === "checkbox" || it.type === "radio";
      return h("button", { type: "button", role, class: "menu-item", tabIndex: -1, disabled: Boolean(it.disabled),
        "aria-checked": checkable ? String(Boolean(it.checked)) : null,
        on: { click: () => { this.close(true); this.onPick(it.id); } } },
      checkable ? h("span", { class: "check", "aria-hidden": "true", text: it.checked ? (it.type === "radio" ? "●" : "✓") : "" }) : null,
      h("span", { text: it.label }));
    }));
    this.el.hidden = false;
    this.button.setAttribute("aria-expanded", "true");
    const entries = this._entries();
    // A single choice opens on the chosen item, as a select would.
    const checked = entries.findIndex((b) => b.getAttribute("role") === "menuitemradio" && b.getAttribute("aria-checked") === "true");
    if (entries.length) (checked >= 0 && focusIndex === 0 ? entries[checked] : entries.at(focusIndex < 0 ? -1 : 0)).focus();
    window.addEventListener("pointerdown", this._outside, true);
  }

  close(returnFocus) {
    if (!this.isOpen) return;
    this.el.hidden = true;
    this.button.setAttribute("aria-expanded", "false");
    window.removeEventListener("pointerdown", this._outside, true);
    if (returnFocus) this.button.focus();
  }

  _entries() {
    return [...this.el.querySelectorAll(".menu-item")].filter((b) => !b.disabled);
  }

  _onKey(e) {
    const entries = this._entries();
    const root = this.el.getRootNode();
    const i = entries.indexOf(root.activeElement);
    const go = (j) => { e.preventDefault(); entries[(j + entries.length) % entries.length].focus(); };
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(entries.length - 1);
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); this.close(true); }
    else if (e.key === "Tab") this.close(false);
  }
}
