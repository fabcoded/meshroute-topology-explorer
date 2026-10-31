// SPDX-License-Identifier: MIT
// Evidence per direction for every pair of available devices (spec 4.3). "A hears B" is a reading in A's table. A
// missing reading is not a missing link: a table lists only part of what its device hears (it is limited by the
// device's memory, full tables of one model all stop at the same size), end devices have no table at all, and an
// active route or a parent link proves a link that was two-way when it was set up (Zigbee r22, 3.6.3.5.2 and
// 3.6.3.3). Pure functions over a Network.
import { isActive } from "./normalize.js";

const NEARLY_FULL = 2; // "nearly full" = capacity minus this or more

/** Why direction A->B has no reading: the most specific honest reason, never a verdict about the radio link. */
function unknownReason(a, reading) {
  if (reading) return "lqi 0";                      // listed, but the table says 0: unmeasured or very weak
  if (a.role === "end device") return "end device (no table)";
  if (!a.hasTable) return "table missing or stale";
  if (a.tableCapacity === null) return "capacity unknown";   // no other device of the model or the manufacturer has a table
  const size = `${a.tableSize}/${a.tableCapacity}${a.tableCapacitySource === "vendor" ? ", vendor estimate" : ""}`;
  if (a.tableFull) return `table full (${size})`;
  if (a.tableSize >= a.tableCapacity - NEARLY_FULL) return `table nearly full (${size}), link probably weak`;
  return "table has space, link probably weak or aged out";
}

/** All pairs with evidence in at least one direction: [{ a, b, ab, ba }], a < b by id, ab = "a hears b".
 *  Direction = { state: "measured" | "implied" | "unknown", lqi, rating, source: "table" | "route" | "parent" | null,
 *  reason }. Pairs whose only evidence is LQI 0 are not pairs. */
export function computePairs({ devices, readings, routes }) {
  const byId = new Map(devices.map((d) => [d.id, d]));
  const key = (x, y) => (x < y ? `${x}|${y}` : `${y}|${x}`);
  const reading = new Map(readings.map((r) => [`${r.reporter}|${r.subject}`, r]));
  const implied = new Map(); // pair key -> "route" | "parent"
  for (const r of routes) {
    if (r.stale || !isActive(r.status) || r.owner === r.nextHop) continue;
    if (byId.get(r.owner).available && byId.get(r.nextHop).available) implied.set(key(r.owner, r.nextHop), "route");
  }
  for (const d of devices) {
    if (d.role !== "end device" || !d.parent || !d.available || !byId.get(d.parent).available) continue;
    if (!implied.has(key(d.id, d.parent))) implied.set(key(d.id, d.parent), "parent");
  }

  const pairs = new Map();
  const consider = (x, y) => { if (x !== y) pairs.set(key(x, y), key(x, y).split("|")); };
  for (const r of readings) if (r.measured && byId.get(r.subject).available) consider(r.reporter, r.subject);
  for (const k of implied.keys()) pairs.set(k, k.split("|"));

  const direction = (from, to, pairSource) => {
    const r = reading.get(`${from}|${to}`);
    if (r && r.measured) return { state: "measured", lqi: r.lqi, rating: r.rating, source: "table", reason: null };
    if (pairSource) return { state: "implied", lqi: null, rating: null, source: pairSource, reason: null };
    return { state: "unknown", lqi: r ? r.lqi : null, rating: null, source: null, reason: unknownReason(byId.get(from), r) };
  };
  return [...pairs.entries()].sort(([x], [y]) => (x < y ? -1 : 1)).map(([k, [a, b]]) => ({
    a, b, ab: direction(a, b, implied.get(k) || null), ba: direction(b, a, implied.get(k) || null),
  }));
}

/** The pairs of a network, from the network itself when it carries them (buildNetwork does), else computed. */
export function pairEvidence(network) {
  return network.pairs || computePairs(network);
}
