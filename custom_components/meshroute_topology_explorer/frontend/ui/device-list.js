// SPDX-License-Identifier: MIT
// The device list as data: rows, a text filter and the keyboard model of a single-select listbox (WAI-ARIA Authoring
// Practices, listbox pattern). It is the keyboard path to every device (spec 9.3): arrows move, Enter selects.
// No DOM; the Devices tab renders it. Tested in Node: node --test tests/

/** Keys that move the active row, as steps; Home/End go to the ends. PageUp/PageDown step by this many. */
const PAGE = 10;

/** Rows for the list from a Network: one per device, sorted by label, then address. The search text holds what a
 *  user may type: label, ZHA name, vendor, model, area, IEEE and network address (as 0x1234 and decimal). */
export function deviceRows(network) {
  return network.devices.map((d) => ({
    id: d.id, label: d.label, role: d.role, area: d.area, available: d.available, rating: d.rating, kind: d.kind || null,
    search: [d.label, d.name, d.vendor, d.model, d.area, d.id,
      typeof d.nwk === "number" ? `0x${d.nwk.toString(16).padStart(4, "0")} ${d.nwk}` : ""]
      .filter(Boolean).join(" ").toLowerCase(),
  })).sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}

/** Rows whose search text contains every word of the filter, in any order. */
export function filterRows(rows, text) {
  const words = String(text || "").toLowerCase().split(/\s+/).filter(Boolean);
  return words.length ? rows.filter((r) => words.every((w) => r.search.includes(w))) : rows;
}

/** New index after a key, or null if the key is not a list key. count 0 gives -1. */
export function moveIndex(index, key, count) {
  if (!count) return key === "ArrowDown" || key === "ArrowUp" || key === "Home" || key === "End" ? -1 : null;
  const clamp = (i) => Math.max(0, Math.min(count - 1, i));
  switch (key) {
    case "ArrowDown": return index < 0 ? 0 : clamp(index + 1);
    case "ArrowUp": return index < 0 ? count - 1 : clamp(index - 1);
    case "Home": return 0;
    case "End": return count - 1;
    case "PageDown": return clamp((index < 0 ? 0 : index) + PAGE);
    case "PageUp": return clamp((index < 0 ? 0 : index) - PAGE);
    default: return null;
  }
}

/** Rows, filter and the active row (by id, so it survives filtering). */
export class ListModel {
  constructor(rows = []) {
    this.rows = rows;
    this.filter = "";
    this.activeId = null;
  }

  get visible() { return filterRows(this.rows, this.filter); }

  get activeIndex() { return this.visible.findIndex((r) => r.id === this.activeId); }

  setRows(rows) {
    this.rows = rows;
    if (!rows.some((r) => r.id === this.activeId)) this.activeId = null;
  }

  setFilter(text) {
    this.filter = text;
    const visible = this.visible;
    if (!visible.some((r) => r.id === this.activeId)) this.activeId = visible.length ? visible[0].id : null;
  }

  /** Make a row active (the selected device, a click). */
  activate(id) {
    if (this.rows.some((r) => r.id === id)) this.activeId = id;
  }

  /** Handle a key: { action: "move", id } when the active row changed, { action: "select", id } for Enter or Space on
   *  a row, null when the key is not ours (the caller then lets it through). */
  key(key) {
    const visible = this.visible;
    if ((key === "Enter" || key === " ") && this.activeIndex >= 0) return { action: "select", id: this.activeId };
    const next = moveIndex(this.activeIndex, key, visible.length);
    if (next === null) return null;
    this.activeId = next >= 0 ? visible[next].id : null;
    return { action: "move", id: this.activeId };
  }
}
