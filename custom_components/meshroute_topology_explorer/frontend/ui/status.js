// SPDX-License-Identifier: MIT
// The status line (spec 6) and the decision which empty or error state applies before any data is shown (9.4).
// No DOM, no Home Assistant objects: the panel translates the parts. Tested in Node: node --test tests/

/** Below this completeness (share of available routers with a table) the map carries the banner "incomplete". */
export const INCOMPLETE_BELOW = 0.9;

/** Decide which empty/error state applies before any data is shown (spec 9.4). Returns a key or null. */
export function blockingState({ isAdmin, configEntries }) {
  if (!isAdmin) return "not_admin";
  const loaded = Array.isArray(configEntries) && configEntries.some((e) => e.domain === "zha" && e.state === "loaded");
  return loaded ? null : "zha_not_loaded";
}

/** Completeness as a whole percentage, rounded down so 89.7 % never reads as the 90 % at which the banner goes. */
export function completenessPercent(status) {
  return Math.floor(status.completeness * 100 + 1e-9);
}

export function isIncomplete(status) {
  return status.completeness < INCOMPLETE_BELOW;
}

/** Status keys of a followed scan (ui/scan.js states). */
const SCAN_KEYS = { running: "status.scan_running", ended: "status.scan_ended", stopped: "status.scan_stopped",
  "not-sent": "status.scan_not_sent" };

/** Parts of the status line as [key, params] for the translator, in order: source, tables x of y (available routers,
 *  coordinator not counted), devices in at least one table, completeness, "observed unchanged since" when known
 *  (formatted time, from the observations), the state of a followed scan (spec 6, 9.4), then the hint that ZHA scans
 *  by itself. */
export function statusParts(network, { unchangedSince = null, scan = null } = {}) {
  const s = network.status;
  const parts = [
    ["status.source", { source: network.source === "zha" ? "ZHA" : network.source }],
    ["status.tables", { x: s.routersWithTable, y: s.routersAvailable }],
    ["status.listed", { x: s.devicesListed, y: s.devicesTotal }],
    ["status.complete", { pct: completenessPercent(s) }],
  ];
  if (unchangedSince) parts.push(["status.unchanged", { time: unchangedSince }]);
  const scanKey = scan && SCAN_KEYS[scan.status];
  if (scanKey) parts.push([scanKey, { changed: scan.changed, total: scan.total, message: scan.message || "?" }]);
  if (network.source === "zha") parts.push(["status.scan_hint", {}]);
  return parts;
}
