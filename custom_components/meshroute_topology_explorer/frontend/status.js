// SPDX-License-Identifier: MIT
// Panel-side helpers around the data model: the rows of the keyboard-reachable device list and the decision which
// empty or error state (spec 9.4) applies before any data is shown. The counting itself lives in model/ (A3).
// No DOM, no Home Assistant objects. Tested in Node: node --test tests/

/** Plain rows for the device list, from a Network (model/index.js). Sorted by label, then address. */
export function deviceRows(network) {
  return network.devices
    .map((d) => ({ name: d.label, role: d.role, available: d.available, ieee: d.id }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.ieee.localeCompare(b.ieee));
}

/** Decide which empty/error state applies before any data is shown (spec 9.4). Returns a key or null. */
export function blockingState({ isAdmin, configEntries }) {
  if (!isAdmin) return "not_admin";
  const loaded = Array.isArray(configEntries) && configEntries.some((e) => e.domain === "zha" && e.state === "loaded");
  return loaded ? null : "zha_not_loaded";
}
