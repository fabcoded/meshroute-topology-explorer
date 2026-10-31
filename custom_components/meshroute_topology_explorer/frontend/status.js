// SPDX-License-Identifier: MIT
// Pure counting logic for the status line (spec 3.1, 6, 9.4). No DOM, no Home Assistant objects: the panel passes
// in the answer of `zha/devices`. Tested in Node: node --test "tests/**/*.test.mjs"

/** Parse an address or number that Home Assistant sends as hex text ("0x0D", "0X0d"), decimal text or a number.
 *  Returns a number, or null for anything else. Text must never be compared as strings ("0x0D" vs "0x000d"). */
export function parseAddress(value) {
  if (typeof value === "number") return Number.isInteger(value) && value >= 0 ? value : null;
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (/^0[xX][0-9a-fA-F]+$/.test(text)) return parseInt(text.slice(2), 16);
  if (/^[0-9]+$/.test(text)) return parseInt(text, 10);
  return null;
}

/** LQI arrives as text ("157"); accept numbers too. Null if it is not a number. */
export function parseLqi(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !/^\s*[0-9]+\s*$/.test(value)) return null;
  return parseInt(value, 10);
}

/** Role label from ZHA's device_type (spec 4.2). A battery end device is not told apart here (skeleton). */
export function roleOf(device) {
  switch (device.device_type) {
    case "Coordinator": return "coordinator";
    case "Router": return "router";
    case "EndDevice": return "end device";
    default: return "unknown";
  }
}

/** Key for matching a neighbour entry to a device: IEEE first (stable), network address as fallback. */
const ieeeKey = (v) => (typeof v === "string" && v ? v.toLowerCase() : null);

/** Counts for the status line. Coordinator is not counted as a router (spec 6). A device "appears in a table" when
 *  some device's neighbour table lists it; a table of an unavailable router still counts as an observation here
 *  (the findings of later packages are what discount stale tables). */
export function computeStatus(devices) {
  const list = Array.isArray(devices) ? devices : [];
  const routers = list.filter((d) => d.device_type === "Router" && d.available);
  const routersWithTable = routers.filter((d) => Array.isArray(d.neighbors) && d.neighbors.length > 0);
  const seenIeee = new Set();
  const seenNwk = new Set();
  for (const d of list) {
    for (const n of Array.isArray(d.neighbors) ? d.neighbors : []) {
      const key = ieeeKey(n.ieee);
      if (key) seenIeee.add(key);
      const nwk = parseAddress(n.nwk);
      if (nwk !== null) seenNwk.add(nwk);
    }
  }
  const inTable = list.filter((d) => {
    const key = ieeeKey(d.ieee);
    if (key && seenIeee.has(key)) return true;
    const nwk = parseAddress(d.nwk);
    return nwk !== null && seenNwk.has(nwk);
  });
  return {
    source: "ZHA",
    routers: routers.length,
    routersWithTable: routersWithTable.length,
    devices: list.length,
    devicesInTable: inTable.length,
    unavailable: list.filter((d) => !d.available).length,
  };
}

/** Plain rows for the keyboard-reachable device list. Display name: user-given name, else ZHA name, else IEEE. */
export function deviceRows(devices) {
  const list = Array.isArray(devices) ? devices : [];
  return list
    .map((d) => ({
      name: d.user_given_name || d.name || d.ieee || "?",
      role: roleOf(d),
      available: Boolean(d.available),
      ieee: d.ieee || "",
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.ieee.localeCompare(b.ieee));
}

/** Decide which empty/error state applies before any data is shown (spec 9.4). Returns a key or null. */
export function blockingState({ isAdmin, configEntries }) {
  if (!isAdmin) return "not_admin";
  const loaded = Array.isArray(configEntries) && configEntries.some((e) => e.domain === "zha" && e.state === "loaded");
  return loaded ? null : "zha_not_loaded";
}
