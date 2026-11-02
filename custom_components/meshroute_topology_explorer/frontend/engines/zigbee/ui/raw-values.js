// SPDX-License-Identifier: MIT
// ZHA's raw value texts in the panel's language: power source, availability, neighbour relationship and device type,
// receiver on when idle, permit joining, route status and yes/no flags. Values come from zigpy's and ZHA's enum names
// ("Battery or Unknown", "NoneOfTheAbove", "Discovery_Underway"); an unknown value is shown as ZHA sent it. In debug
// mode the raw text stays next to the translation. Pure; t is the translator of i18n.js.
// Tested in Node: npm test

/** Columns of ZHA's raw tables (neighbours, routes) -> kind of raw value. Columns not listed are shown as they are. */
export const RAW_COLUMNS = Object.freeze({
  relationship: "relationship", device_type: "device_type", rx_on_when_idle: "rx_on_when_idle",
  permit_joining: "permit_joining", route_status: "route_status", memory_constrained: "flag", many_to_one: "flag",
  route_record_required: "flag",
});

/** Lookup key of a raw text: words split at case changes and non-letters, lower case, joined by "_"
 *  ("NoneOfTheAbove" -> "none_of_the_above", "Mains (single phase)" -> "mains_single_phase", true -> "true"). */
export function rawKey(value) {
  return String(value).replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

/** The value in words: the translation of raw.<kind>.<key>, else the raw text; with debug, "Netz (Mains)". */
export function rawText(kind, value, t, { debug = false } = {}) {
  if (value === null || value === undefined || value === "") return "";
  const raw = String(value);
  const key = `raw.${kind}.${rawKey(raw)}`;
  const text = t.has(key) ? t(key) : raw;
  return debug && text !== raw ? `${text} (${raw})` : text;
}
