// SPDX-License-Identifier: MIT
// Derives the test variants of spec 12 from the sample in memory, so no copies of it live in the repository.
// A table is "removed" by emptying a router's `neighbors` and `routes`, which is what a router that never answered a
// scan looks like. The routers are chosen by a fixed rule, so the variants are reproducible and the tests stay hard:
// available routers with a table are ranked by the end devices they list as Child (most first, ties by address) and
// the top ones are taken, because those removals hide the most parents. Used by: tests/model.test.mjs

/** Available routers with a table, ranked by listed end-device children, then by address. */
export function rankRouters(devices) {
  const ends = new Set(devices.filter((d) => d.device_type === "EndDevice").map((d) => d.ieee));
  const children = (d) => d.neighbors.filter((n) => n.relationship === "Child" && ends.has(n.ieee)).length;
  return devices.filter((d) => d.device_type === "Router" && d.available && d.neighbors.length)
    .sort((a, b) => children(b) - children(a) || (a.ieee < b.ieee ? -1 : 1))
    .map((d) => d.ieee);
}

/** Addresses whose tables each variant removes: minus1, minus3, without-coordinator (only the coordinator),
 *  coordinator-only (every router, available or not). */
export function removedTables(devices) {
  const ranked = rankRouters(devices);
  return {
    minus1: ranked.slice(0, 1),
    minus3: ranked.slice(0, 3),
    "without-coordinator": devices.filter((d) => d.device_type === "Coordinator").map((d) => d.ieee),
    "coordinator-only": devices.filter((d) => d.device_type === "Router").map((d) => d.ieee).sort(),
  };
}

/** Copy of the `zha/devices` list with the tables of the given devices emptied. */
export function withoutTables(devices, removed) {
  const gone = new Set(removed);
  return devices.map((d) => (gone.has(d.ieee) ? { ...d, neighbors: [], routes: [] } : d));
}
