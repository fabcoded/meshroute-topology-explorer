// SPDX-License-Identifier: MIT
// Return paths without a table entry (spec 5.1 source route; decision by Fabian Schwamborn, 2026-11-01): which devices
// get an assumed down path (the up path reversed), that it is marked as assumed on the path and every hop, the stages
// off and assume, the numbers of spec 12, and that the assumption never covers a gap of another kind.
// node --test "tests/**/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { sampleNetwork } from "./panel-fixture.mjs";
import { buildNetwork, downPath, upPath, nodePaths } from "../custom_components/meshroute_topology_explorer/frontend/model/index.js";
import { assumedDownPaths, downPathWith, sourceRouteMode, sourceRouteSummary, SOURCE_ROUTE_MODES, DEFAULT_SOURCE_ROUTE }
  from "../custom_components/meshroute_topology_explorer/frontend/model/source-routes.js";
import { sanitizeSettings } from "../custom_components/meshroute_topology_explorer/frontend/ui/settings.js";
import { sourceRoutePart } from "../custom_components/meshroute_topology_explorer/frontend/engines/zigbee/status.js";
import { translator } from "../custom_components/meshroute_topology_explorer/frontend/ui/i18n.js";

const sample = sampleNetwork();
const label = (id) => sample.devices.find((d) => d.id === id).label;
const byLabel = (l) => sample.devices.find((d) => d.label === l).id;

test("on the sample: 8 devices get an assumed return path, each its up path reversed", () => {
  const assumed = assumedDownPaths(sample);
  assert.deepEqual([...assumed.keys()].map(label).sort(),
    ["RODRET Dimmer", "Router 01", "Router 02", "Router 04", "Router 05", "Router 06", "Router 10", "Router 32"]);
  const coordinator = sample.devices.find((d) => d.role === "coordinator");
  for (const [id, p] of assumed) {
    assert.deepEqual(p.ids, [...upPath(sample, id).ids].reverse(), label(id));
    assert.equal(p.ids[0], coordinator.id);
    assert.equal(p.complete, true);
    assert.equal(p.assumed, true);
    assert.equal(downPath(sample, id).complete, false, "only where the measured down path is unknown");
    assert.ok(!sample.routes.some((r) => r.owner === coordinator.id && r.destination === id && r.status === "Active"),
      "only where the coordinator keeps no entry");
  }
  // Direct neighbours of the coordinator get a one-hop return path.
  assert.deepEqual(assumed.get(byLabel("Router 01")).ids.map(label), ["Coordinator", "Router 01"]);
  assert.equal(assumed.get(byLabel("Router 02")).ids.length, 3);
});

test("spec 12: measured down paths stay 33 of 44, the assumption adds 8 (41 of 44)", () => {
  const others = sample.devices.filter((d) => d.role !== "coordinator");
  const measured = others.filter((d) => downPath(sample, d.id).complete).length;
  const withAssumed = others.filter((d) => downPathWith(sample, d.id, "assume").complete).length;
  const off = others.filter((d) => downPathWith(sample, d.id, "off").complete).length;
  assert.deepEqual([others.length, measured, off, withAssumed], [44, 33, 33, 41]);
  assert.deepEqual(sourceRouteSummary(sample, "assume"), { mode: "assume", count: 8, recorded: 0, zigpy: null });
  assert.deepEqual(sourceRouteSummary(sample, "off"), { mode: "off", count: 8, recorded: 0, zigpy: null });
});

test("an end device the coordinator has an entry for is reached through its parent, never assumed", () => {
  const assumed = assumedDownPaths(sample);
  // The coordinator's entries for these end devices lead to their parents, which deliver to their children. A4i read
  // the stop at the parent as a gap that only the assumption could hide; it was the walk (A4k).
  for (const l of ["TRADFRI on/off switch", "RWL022", "End device 08", "End device 10"]) {
    const down = downPath(sample, byLabel(l));
    assert.equal(down.complete, true, l);
    assert.equal(down.ids.at(-2), sample.devices.find((d) => d.id === byLabel(l)).parent, l);
    assert.ok(!assumed.has(byLabel(l)), l);
  }
  for (const d of sample.devices.filter((x) => !x.available)) assert.ok(!assumed.has(d.id), "unavailable");
  // Without the coordinator's table a missing entry says nothing.
  assert.equal(assumedDownPaths(sampleNetwork("without-coordinator")).size, 0);
  assert.equal(assumedDownPaths(sampleNetwork("coordinator-only")).size, 0, "no router tables: no complete way up");
});

test("node view: off keeps the measured down path, assume replaces it and marks path and hops as assumed", () => {
  const id = byLabel("Router 02");
  const [, off] = nodePaths(sample, id, "coordinator");
  assert.equal(off.complete, false);
  assert.equal(off.assumed, false);
  assert.deepEqual(nodePaths(sample, id, "coordinator", { sourceRoute: "off" })[1], off, "off is the default");
  const [up, down] = nodePaths(sample, id, "coordinator", { sourceRoute: "assume" });
  assert.equal(up.assumed, false);
  assert.equal(down.kind, "down");
  assert.equal(down.assumed, true);
  assert.deepEqual(down.ids, [...up.ids].reverse());
  assert.ok(down.hops.length && down.hops.every((h) => h.assumed === true), "every hop of it is assumed");
  assert.ok(up.hops.every((h) => h.assumed === undefined), "the measured way up is not");
  // A device with a measured down path is not touched.
  const r3 = byLabel("Router 03");
  assert.deepEqual(nodePaths(sample, r3, "coordinator", { sourceRoute: "assume" }), nodePaths(sample, r3, "coordinator"));
});

test("a small network: the rule step by step", () => {
  const ieee = (n) => `00:11:22:33:44:55:66:${n.toString(16).padStart(2, "0")}`;
  const dev = (n, type, extra = {}) => ({ ieee: ieee(n), nwk: n, device_type: type, available: true, model: `M${n}`,
    neighbors: [], routes: [], ...extra });
  const nb = (n, type, rel = "Sibling") => ({ ieee: ieee(n), nwk: `0x${n.toString(16).padStart(4, "0")}`, lqi: "200",
    device_type: type, relationship: rel });
  const route = (dest, next) => ({ dest_nwk: `0x${dest.toString(16).padStart(4, "0")}`, next_hop: `0x${next.toString(16).padStart(4, "0")}`,
    route_status: "Active" });
  // 0 coordinator; 1 router next to it (no entry at 0); 2 router behind 1 (no entry at 0); 3 router with an entry at 0
  // that leads nowhere; 4 end device of 1.
  const raw = [
    dev(0, "Coordinator", { neighbors: [nb(1, "Router"), nb(3, "Router")], routes: [route(3, 1)] }),
    dev(1, "Router", { neighbors: [nb(0, "Coordinator"), nb(2, "Router"), nb(4, "EndDevice", "Child")], routes: [route(0, 0)] }),
    dev(2, "Router", { neighbors: [nb(1, "Router")], routes: [route(0, 1)] }),
    dev(3, "Router", { neighbors: [nb(0, "Coordinator")], routes: [route(0, 0)] }),
    dev(4, "EndDevice"),
  ];
  const n = buildNetwork(raw);
  const a = assumedDownPaths(n);
  assert.deepEqual(a.get(ieee(1)).ids, [ieee(0), ieee(1)], "direct neighbour: one hop");
  assert.deepEqual(a.get(ieee(2)).ids, [ieee(0), ieee(1), ieee(2)]);
  assert.deepEqual(a.get(ieee(4)).ids, [ieee(0), ieee(1), ieee(4)], "an end device through its parent");
  assert.ok(!a.has(ieee(3)), "the coordinator has an entry: a gap elsewhere stays unknown");
  assert.ok(!a.has(ieee(0)));
});

test("the setting: off, assume and zigpy (brief a4w), anything else counts as assume", () => {
  assert.deepEqual(SOURCE_ROUTE_MODES, ["off", "assume", "zigpy"]);
  assert.equal(DEFAULT_SOURCE_ROUTE, "assume");
  for (const [input, out] of [["off", "off"], ["assume", "assume"], ["zigpy", "zigpy"], ["Zigpy", "assume"], [null, "assume"],
    [7, "assume"]]) {
    assert.equal(sourceRouteMode(input), out);
    assert.equal(sanitizeSettings({ sourceRoute: input }).sourceRoute, out);
  }
  assert.equal(sanitizeSettings(null).sourceRoute, "assume");
});

test("the status line names the stage on the right, in both languages, and says nothing when no device is concerned", () => {
  const en = translator("en");
  const de = translator("de");
  const on = sourceRoutePart({ mode: "assume", count: 7 });
  const off = sourceRoutePart({ mode: "off", count: 7 });
  assert.equal(en(on[0], on[1]), "Return paths assumed for 7 devices (source route)");
  assert.equal(de(on[0], on[1]), "Rückwege für 7 Geräte angenommen (Source Route)");
  assert.equal(en(off[0], off[1]), "Source route off · 7 return paths unknown");
  assert.equal(de(off[0], off[1]), "Source Route aus · 7 Rückwege unbekannt");
  const short = sourceRoutePart({ mode: "assume", count: 7 }, true);
  assert.equal(en(short[0], short[1]), "7 return paths assumed");
  assert.equal(short[2], "status.sr_assumed", "the long form is the short part's description");
  assert.equal(sourceRoutePart({ mode: "assume", count: 0 }), null);
});
