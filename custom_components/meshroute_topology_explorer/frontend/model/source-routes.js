// SPDX-License-Identifier: MIT
// Return paths without a table entry (spec 5.1 "source route"; decision by Fabian Schwamborn, 2026-11-01). A ZHA
// coordinator reaches many devices by source routing: it keeps no routing entry for them and sends along the relay
// list the device's own route record gave it, which is the device's way up, reversed. Home Assistant does not expose
// those route records, so the measured down path of such a device stays unknown (spec 3.1). In the stage "assume"
// (the default) the explorer draws the up path reversed instead, always marked as assumed and never as measured;
// "off" keeps the down path unknown. A third stage, reading the records from zigpy, comes later.
// Pure functions over a Network. node --test tests/
import { downPath, upPath } from "./paths.js";
import { isActive } from "./normalize.js";

/** The stages that exist today (spec 11 `sourceRoute`); anything else, the later "zigpy" included, counts as the
 *  default. */
export const SOURCE_ROUTE_MODES = Object.freeze(["off", "assume"]);
export const DEFAULT_SOURCE_ROUTE = "assume";

/** A stored or passed stage as one of SOURCE_ROUTE_MODES. */
export function sourceRouteMode(value) {
  return SOURCE_ROUTE_MODES.includes(value) ? value : DEFAULT_SOURCE_ROUTE;
}

const cache = new WeakMap(); // network -> Map id -> assumed down path

/** Assumed down paths per device id: { ids (coordinator first), complete: true, assumed: true }. A device gets one
 *  only when all of this holds, so the assumption never hides a gap of another kind (unknown beats wrong):
 *  - it is available and not the coordinator, and the coordinator's own table is there (without it, a missing entry
 *    says nothing);
 *  - the coordinator's table holds no active, current route towards it (with one, a broken walk is a gap elsewhere);
 *  - its measured down path is incomplete;
 *  - its up path is complete, so the reversal is a whole path. A direct neighbour of the coordinator thus gets a
 *    one-hop return path. */
export function assumedDownPaths(network) {
  let out = cache.get(network);
  if (out) return out;
  out = new Map();
  cache.set(network, out);
  const devices = network.devices || [];
  const coordinator = devices.find((d) => d.role === "coordinator");
  if (!coordinator || !coordinator.hasTable) return out;
  const routed = new Set((network.routes || []).filter((r) => r.owner === coordinator.id && !r.stale && isActive(r.status))
    .map((r) => r.destination));
  for (const d of devices) {
    if (d === coordinator || !d.available || routed.has(d.id)) continue;
    if (downPath(network, d.id).complete) continue;
    const up = upPath(network, d.id);
    if (!up.complete) continue;
    out.set(d.id, { ids: [...up.ids].reverse(), complete: true, assumed: true });
  }
  return out;
}

/** The down path of `id` under a stage: the assumed one where it applies and the stage is "assume", else the measured
 *  one ({ ids, complete }, paths.js). */
export function downPathWith(network, id, mode = DEFAULT_SOURCE_ROUTE) {
  if (sourceRouteMode(mode) === "assume") {
    const assumed = assumedDownPaths(network).get(id);
    if (assumed) return assumed;
  }
  return downPath(network, id);
}

/** Numbers for the status line and spec 12: { mode, count } where count is the number of devices the assumption
 *  applies to (drawn as assumed with "assume", unknown with "off"). */
export function sourceRouteSummary(network, mode = DEFAULT_SOURCE_ROUTE) {
  return { mode: sourceRouteMode(mode), count: assumedDownPaths(network).size };
}
