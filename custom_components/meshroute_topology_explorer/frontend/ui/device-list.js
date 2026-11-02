// SPDX-License-Identifier: MIT
// The device list as data: rows, a text filter and the keyboard model of a single-select listbox (WAI-ARIA Authoring
// Practices, listbox pattern). It is the keyboard path to every device (spec 9.3): arrows move, Enter selects.
// No DOM; the Devices tab renders it. Tested in Node: npm test
import { engineFor } from "../engines/index.js";
import { sleeps } from "../graph/symbols.js";

/** Keys that move the active row, as steps; Home/End go to the ends. PageUp/PageDown step by this many. */
const PAGE = 10;

/** Rows for the list from a Network: one per device, the device that is the network first (spec 9.1: the Zigbee
 *  coordinator; engine.connection kind "network"), then by label and address.
 *  The search text holds what a user may type: label, Home Assistant name, vendor, model, area, the device key (IEEE or
 *  extended address) and the network address as the engine writes it (engine.addresses: Zigbee 0x1234 and decimal;
 *  Thread the RLOC16 alike). */
export function deviceRows(network) {
  const engine = engineFor(network);
  return network.devices.map((d) => ({
    id: d.id, label: d.label, role: d.role, area: d.area, available: d.available, rating: d.rating, kind: d.kind || null,
    sleepy: d.sleepy === true, sleeps: sleeps(d), connection: engine.connection(network, d),
    search: [d.label, d.name, d.vendor, d.model, d.area, d.id, ...engine.addresses(d)]
      .filter(Boolean).join(" ").toLowerCase(),
  })).sort((a, b) => isNetwork(b) - isNetwork(a) || a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}

/** Whether a row's device is the network itself (its engine's connection says so: the Zigbee coordinator). */
const isNetwork = (row) => Boolean(row.connection && row.connection.kind === "network");

/** The grey line under a row's name (spec 9.1): "Light · Router · direct to the coordinator", "Button · sleeps · via
 *  Router 03", "Coordinator · Network"; then the area and, when it is down, "unavailable". The reception rank lives in
 *  Details. t: the translator. */
export function rowMeta(row, t) {
  const parts = [];
  if (isNetwork(row)) {
    parts.push(t(`role.${row.role}`), t("devices.network"));
  } else {
    if (row.kind && row.kind !== "unknown") parts.push(t(`kind_short.${row.kind}`));
    parts.push(row.sleeps ? t("devices.sleeps") : t(`role.${row.role}`));
    const c = row.connection;
    if (c && c.kind === "direct") parts.push(t("devices.direct"));
    if (c && c.kind === "via") parts.push(t("devices.via", { name: c.label }));
  }
  if (row.area) parts.push(row.area);
  if (!row.available) parts.push(t("devices.unavailable"));
  return parts.join(" \u00B7 ");
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
