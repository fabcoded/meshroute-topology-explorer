// SPDX-License-Identifier: MIT
// The tables panel beside the Details (spec 9.1, 9.2; #25, board M42 V4): the shell only (open, close, focus,
// placement, the collapsible "About these values"); what it shows is the network engine's. The engine offers it on
// every render of the Details (begin, offer, end), so it follows the selection: another device or no offer closes it.
// Not modal: no backdrop, the map stays usable; nothing reacts to hover. Placed by geometry.js slideoutGeometry from
// what panel.js measures on every layout pass and the width the offer's content needs. Esc is panel.js's, by the
// rule takesEscape. Runs in the browser; tested with a fake DOM (npm test).
import { h, icon } from "./dom.js";
import { slideoutGeometry } from "./geometry.js";

let uid = 0;

/** Whether Esc goes to the tables panel (topmost first, owner 2026-11-15): it is open, no modal dialog is (path history
 *  window, cluster details, scan confirmation: they make the rest inert), and the key does not come from inside one of
 *  the open `layers` (the status pill's menu, a Direct link card; null where closed): their event `path`
 *  (composedPath) holds them. Those keep their own Esc; a menu or card merely left open elsewhere does not, as neither
 *  closes when focus leaves it. Without an open tables panel every Esc is as before. */
export const takesEscape = ({ open, dialog, path = [], layers = [] }) =>
  Boolean(open && !dialog && !layers.some((layer) => layer && path.includes(layer)));

export class Slideout {
  /** onLostFocus(): where focus goes when the panel closes with focus inside and neither its opener nor the current
   *  "Tables" button can take it (panel.js: the Details, else the map). */
  constructor({ onLostFocus = () => {} } = {}) {
    const id = `mte-slideout-${++uid}`;
    this.onLostFocus = onLostFocus;
    this.offered = null; // the latest offer (see offer)
    this.openKey = null;
    this.opener = null; // which of the offer's openers opened it: "tables" or the name of an "i"
    this.infoOpen = false;
    this.seen = false;
    this.summary = null;
    this.measured = null; // what the last layout pass measured (place)
    this.title = h("h2", { id: `${id}-title`, class: "slideout-title" });
    this.closeButton = h("button", { type: "button", class: "icon-button", on: { click: () => this.close() } }, icon("close"));
    this.body = h("div", { class: "slideout-body" });
    this.el = h("div", { class: "slideout", role: "dialog", "aria-labelledby": `${id}-title`, hidden: true },
      h("div", { class: "slideout-head" }, this.title, this.closeButton), this.body);
  }

  get isOpen() { return this.openKey !== null; }

  /** A render of the Details starts: whatever is not offered again before end() goes away. */
  begin() { this.seen = false; }

  /** The engine's content for device `key`: { key, title, closeLabel, infoLabel, info (texts of "About these values"),
   *  sections (nodes), minWidth (the width its widest table needs without scrolling sideways), openers: { tables (the
   *  "Tables" button), and each "i" button by name } }. Refreshed in place while open for the same key; another key
   *  closes it (focus that was inside goes to this offer's buttons). */
  offer(spec) {
    this.seen = true;
    const other = this.openKey !== null && this.openKey !== spec.key;
    this.offered = spec;
    if (other) this.close();
    this._expanded();
    this._place();
    if (this.openKey === spec.key) this._fill();
  }

  /** The render is over: an open panel nobody offered again closes (another device, another network or engine). */
  end() {
    if (this.seen) return;
    this.close();
    this.offered = null;
  }

  /** "Tables": open with "About these values" collapsed and focus on the close button, or close when open. */
  toggle(key) {
    if (this.openKey === key) this.close();
    else this._open(key, "tables", false);
  }

  /** An "i" (opener name `name`): open, or stay open, with "About these values" expanded and focused. */
  showInfo(key, name) {
    this._open(key, name, true);
  }

  _open(key, name, info) {
    if (!this.offered || this.offered.key !== key) return;
    if (info || this.openKey !== key) this.infoOpen = info;
    this.openKey = key;
    this.opener = name;
    this._fill();
    this.el.hidden = false;
    this._expanded();
    (info && this.summary ? this.summary : this.closeButton).focus();
  }

  /** Close. Focus that was inside goes to the button that opened it, else to the current "Tables" button (the Details
   *  may have been redrawn or show another device), else to onLostFocus; never onto the hidden panel. Focus elsewhere
   *  (the drawer, the map) stays where it is. */
  close() {
    if (this.openKey === null) return;
    const inside = this.el.contains(this.el.getRootNode().activeElement);
    this.openKey = null;
    this.el.hidden = true;
    this._expanded();
    if (!inside) return;
    const openers = this.offered ? this.offered.openers : {};
    const shown = (b) => Boolean(b) && b.isConnected && b.offsetParent !== null;
    const back = [openers[this.opener], openers.tables].find(shown);
    if (back) back.focus();
    else this.onLostFocus();
  }

  /** What a layout pass measured (panel.js: the map's size, the left panel's mode, width and tab head, the right
   *  panel's width, the bottom sheet's height); placed with the offer's minWidth, while hidden too, so it opens in
   *  place. */
  place(measured) {
    this.measured = measured;
    this._place();
  }

  _place() {
    if (!this.measured || !this.offered) return;
    const g = slideoutGeometry({ ...this.measured, need: this.offered.minWidth });
    this.el.dataset.mode = g.mode;
    Object.assign(this.el.style, { left: `${g.left}px`, width: `${g.width}px`, top: `${g.top}px`, maxHeight: `${g.maxHeight}px` });
  }

  /** aria-expanded: on "Tables" while open, on each "i" while open with "About these values" expanded. */
  _expanded() {
    if (!this.offered) return;
    const open = this.openKey !== null && this.openKey === this.offered.key;
    for (const [name, button] of Object.entries(this.offered.openers)) {
      if (button) button.setAttribute("aria-expanded", String(name === "tables" ? open : open && this.infoOpen));
    }
  }

  /** Fill from the offer; "About these values" keeps its state, a focused control is found again by its place. */
  _fill() {
    const s = this.offered;
    this.title.textContent = s.title;
    this.closeButton.setAttribute("aria-label", s.closeLabel);
    this.closeButton.title = s.closeLabel;
    const focusable = () => [...this.body.querySelectorAll("summary, [tabindex]")];
    const at = focusable().indexOf(this.el.getRootNode().activeElement);
    this.summary = s.info.length ? h("summary", { text: s.infoLabel }) : null;
    const info = this.summary ? h("details", { class: "slideout-info", open: this.infoOpen,
      on: { toggle: (e) => { this.infoOpen = e.currentTarget.open; this._expanded(); } } },
    this.summary, ...s.info.map((text) => h("p", { class: "small", text }))) : null;
    this.body.replaceChildren(...[info, ...s.sections].filter(Boolean));
    if (at >= 0 && focusable()[at]) focusable()[at].focus();
  }
}
