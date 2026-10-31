// SPDX-License-Identifier: MIT
// Findings (spec 5.6) and the status line numbers (spec 6). A finding is the only form in which the explorer judges:
// each one names its evidence and the tables it would need but lacks. Missing data never turns into a verdict.
// No finding is raised from the table of an unavailable device (stale), from LQI 0, or from a missing neighbour
// entry alone. Pure functions over the normalized parts of a Network.
import { isActive } from "./normalize.js";

const WEAK_TENTH = 0.1;       // reception in the lowest tenth of what the reporter hears ...
const WEAK_HALF = 0.5;        // ... and below this share of the reporter's median
const VERY_LOW_MAX = 10;      // 1..10 LQI is a hint, whatever the reporter's scale
const MANY_CHILDREN = 3;

export const FINDING_KINDS = ["offline", "parent offline", "route to offline device", "data incomplete",
  "weak reception", "very low reading", "parent unknown", "isolated", "many end-device children"];

/** Counts for the status line (spec 6). The coordinator is not counted as a router. */
export function computeStatus({ devices, readings }) {
  const routers = devices.filter((d) => d.role === "router" && d.available);
  const listed = new Set(readings.map((r) => r.subject));
  return {
    routersAvailable: routers.length,
    routersWithTable: routers.filter((d) => d.hasTable).length,
    devicesListed: devices.filter((d) => listed.has(d.id)).length,
    devicesTotal: devices.length,
    unavailable: devices.filter((d) => !d.available).length,
    completeness: routers.length ? routers.filter((d) => d.hasTable).length / routers.length : 1,
  };
}

/** All findings of a network, ordered by kind (table order) and device id. */
export function computeFindings({ devices, readings, routes }) {
  const byId = new Map(devices.map((d) => [d.id, d]));
  const missingAll = devices.filter((d) => d.role === "router" && d.available && !d.hasTable).map((d) => d.id).sort();
  const out = [];
  const add = (kind, device, evidence, missing = []) => out.push({ kind, device, evidence, missing });

  // Readings per reporter and per subject (readings exist only for available reporters with a table).
  const heardBy = new Map();
  const hearing = new Map();
  for (const r of readings) {
    if (!heardBy.has(r.reporter)) heardBy.set(r.reporter, []);
    heardBy.get(r.reporter).push(r);
    if (!hearing.has(r.subject)) hearing.set(r.subject, []);
    hearing.get(r.subject).push(r);
  }

  /** Expected reporters (5.6): a router's available routers in its own table; an end device's available parent. */
  const expectedReporters = (d) => {
    if (d.role === "router" && d.hasTable) {
      return (heardBy.get(d.id) || []).map((r) => r.subject)
        .filter((s) => byId.get(s).role === "router" && byId.get(s).available);
    }
    if (d.role === "end device" && d.parent && byId.get(d.parent).available) return [d.parent];
    return [];
  };

  for (const d of devices) {
    if (!d.available) add("offline", d.id, { lastSeen: d.lastSeen });
    if (d.role === "end device" && d.parent && !byId.get(d.parent).available) {
      add("parent offline", d.id, { parent: d.parent, parentLastSeen: byId.get(d.parent).lastSeen,
        listedInStaleTable: d.parentFromStaleTable,
        // The only exception to "no finding from a stale table" (spec 5.6): the parent is offline, so its own
        // stale table is the only place that still names it. The finding says "last known parent".
        lastKnown: d.parentFromStaleTable });
    }
  }

  for (const r of routes) {
    if (r.stale || !isActive(r.status)) continue;
    const down = [r.nextHop, r.destination].filter((id) => !byId.get(id).available);
    if (down.length) add("route to offline device", r.owner, { destination: r.destination, nextHop: r.nextHop, unavailable: [...new Set(down)] });
  }

  for (const d of devices) {
    if (!d.available) continue;
    if (d.role === "router" && !d.hasTable) {
      add("data incomplete", d.id, { reason: "router without table" }, [d.id]);
      continue;
    }
    const lacking = expectedReporters(d).filter((id) => !byId.get(id).hasTable);
    if (lacking.length) add("data incomplete", d.id, { reason: "expected reporter without table" }, [...new Set(lacking)].sort());
  }

  for (const d of devices) {
    if (!d.available || d.role === "coordinator") continue;
    const expected = expectedReporters(d);
    if (d.rating === null || d.rating >= WEAK_TENTH || !expected.length || expected.some((id) => !byId.get(id).hasTable)) continue;
    const rated = (hearing.get(d.id) || []).filter((r) => r.rating === d.rating)
      .sort((a, b) => b.lqi - a.lqi)[0];
    if (rated && rated.lqi < WEAK_HALF * rated.poolMedian) {
      add("weak reception", d.id, { reception: d.rating, reporter: rated.reporter, lqi: rated.lqi, reporterMedian: rated.poolMedian,
        medianOf: rated.pool, expectedReporters: expected });
    }
  }

  for (const [subject, list] of hearing) {
    if (!byId.get(subject).available) continue;
    const low = list.filter((r) => r.lqi >= 1 && r.lqi <= VERY_LOW_MAX);
    if (low.length) add("very low reading", subject, { readings: low.map((r) => ({ reporter: r.reporter, lqi: r.lqi })) });
  }

  for (const d of devices) {
    if (d.role === "end device" && d.available && !d.parent) {
      // Only with every table present is "no parent" a statement; otherwise it is "unknown" and names what is missing.
      add("parent unknown", d.id, { verdict: missingAll.length ? "parent unknown" : "no parent" }, missingAll);
    }
  }

  if (!missingAll.length) {
    const listed = new Set(readings.map((r) => r.subject));
    for (const d of devices) {
      if (d.role === "router" && d.available && d.hasTable && !listed.has(d.id)) add("isolated", d.id, { listedBy: [] });
    }
  }

  for (const d of devices) {
    if (d.available && d.children.length >= MANY_CHILDREN) add("many end-device children", d.id, { children: d.children });
  }

  const order = (f) => FINDING_KINDS.indexOf(f.kind);
  return out.sort((a, b) => order(a) - order(b) || (a.device || "").localeCompare(b.device || ""));
}
