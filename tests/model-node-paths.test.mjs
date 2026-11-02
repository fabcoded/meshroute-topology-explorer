// SPDX-License-Identifier: MIT
// Tests of the node view's paths (spec 5.1, 7.1): up and down path per
// device with the reception at every hop, the numbers of spec 12, unknown ends, and "all paths" (out along the
// device's own routes, in along other devices' routes towards it) with loops guarded and missing tables shown as
// unknown. node --test "tests/**/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { sampleNetwork } from "./panel-fixture.mjs";
import { buildNetwork } from "../custom_components/meshroute_topology_explorer/frontend/engines/zigbee/model.js";
import { upPath, downPath } from "../custom_components/meshroute_topology_explorer/frontend/engines/zigbee/paths.js";
import { nodePaths, pathHops, unknownEnd, NODE_VIEWS } from "../custom_components/meshroute_topology_explorer/frontend/engines/zigbee/node-paths.js";

const sample = sampleNetwork();
const coordinator = sample.devices.find((d) => d.role === "coordinator");
const others = sample.devices.filter((d) => d !== coordinator);
const byLabel = (label) => sample.devices.find((d) => d.label === label).id;
const labelOf = new Map(sample.devices.map((d) => [d.id, d.label]));
/** A hop as text: "LQI", "parent", "route" or "?". */
const hopText = (h) => (h.state === "measured" ? String(h.lqi) : h.state === "implied" ? h.source : "?");

test("path to coordinator: up and down path per device, the numbers of spec 12", () => {
  assert.deepEqual(NODE_VIEWS, ["coordinator", "table", "all"]);
  let up = 0;
  let down = 0;
  let differ = 0;
  const ends = { up: 0, down: 0 };
  for (const d of others) {
    const paths = nodePaths(sample, d.id);
    assert.deepEqual(paths.map((p) => p.kind), ["up", "down"]);
    const [u, w] = paths;
    // The same walks as the model's paths, with from and to named.
    assert.deepEqual({ ids: u.ids, complete: u.complete }, upPath(sample, d.id));
    assert.deepEqual({ ids: w.ids, complete: w.complete }, downPath(sample, d.id));
    assert.equal(u.from, d.id);
    assert.equal(u.to, coordinator.id);
    assert.equal(w.from, coordinator.id);
    assert.equal(w.to, d.id);
    up += u.complete;
    down += w.complete;
    if (w.complete && JSON.stringify([...u.ids].reverse()) !== JSON.stringify(w.ids)) differ++;
    if (unknownEnd(u)) ends.up++;
    if (unknownEnd(w)) ends.down++;
    // One hop per step, in the direction of travel.
    for (const p of paths) {
      assert.equal(p.hops.length, Math.max(0, p.ids.length - 1));
      p.hops.forEach((h, i) => { assert.equal(h.sender, p.ids[i]); assert.equal(h.hearer, p.ids[i + 1]); });
    }
  }
  assert.deepEqual([others.length, up, down, differ], [44, 41, 33, 23]);
  // Every incomplete path on the sample stops short of its goal, so it has a visible unknown end.
  assert.deepEqual(ends, { up: 3, down: 11 });
  // The coordinator stands for Home Assistant: in stage 1 its paths are the routes it holds and the routes towards it;
  // stage 2 gives it the theoretical trees like any device.
  const own = nodePaths(sample, coordinator.id);
  assert.ok(own.length && own.every((p) => (p.kind === "out" || p.kind === "in") && !p.hops.some((h) => h.how)));
  const trees = nodePaths(sample, coordinator.id, "all");
  assert.deepEqual([trees.filter((p) => p.kind === "out").length, trees.filter((p) => p.kind === "in").length], [41, 41]);
  assert.ok(trees.every((p) => p.complete && p.hops.every((h) => h.how)));
  assert.deepEqual(nodePaths(sample, "no:such:device"), []);
});

test("reception at every hop: the hearer's LQI of the sender, or what implies the hop", () => {
  const [u, w] = nodePaths(sample, byLabel("End device 06"));
  assert.deepEqual(u.ids.map((id) => labelOf.get(id)), ["End device 06", "Router 17", "Router 13", "Coordinator"]);
  assert.deepEqual(u.hops.map(hopText), ["103", "111", "51"]);
  // The coordinator's own entry for the end device leads to its parent Router 17, which delivers to its child.
  assert.deepEqual(w.ids.map((id) => labelOf.get(id)), ["Coordinator", "Router 13", "Router 17", "End device 06"]);
  // The end device has no table: that it hears its parent is implied by the parent link.
  assert.deepEqual(w.hops.map(hopText), ["104", "124", "parent"]);
  // Router 16: up and down differ (one hop up, four down).
  const [u16, w16] = nodePaths(sample, byLabel("Router 16"));
  assert.deepEqual(u16.hops.map(hopText), ["46"]);
  assert.deepEqual(w16.hops.map(hopText), ["192", "140", "123", "188"]);
  // Every hop of a complete path on the sample has a reading or a route or parent behind it, except a theoretical
  // direct hop to a neighbour that the sender lists and the hearer does not (spec 5.7): its reception stays unknown,
  // with the hearer's reason.
  for (const d of others) for (const p of nodePaths(sample, d.id, "all")) {
    if (!p.complete) continue;
    for (const h of p.hops) if (h.state === "unknown") assert.ok(h.how === "neighbour" && h.reason, labelOf.get(d.id));
  }
});

test("an incomplete path ends where its walk stopped, short of its goal", () => {
  const id = byLabel("Router 01");
  const [u, w] = nodePaths(sample, id);
  assert.equal(u.complete, true);
  // The coordinator holds no entry for Router 01 (it reaches it by source route): unknown from the coordinator on.
  assert.deepEqual(w.ids, [coordinator.id]);
  assert.deepEqual(unknownEnd(w), { at: coordinator.id, toward: id });
  // An unavailable router has no usable path at all: it stands alone, its way up unknown.
  const off = sample.devices.find((d) => !d.available);
  const [uo] = nodePaths(sample, off.id);
  assert.deepEqual(uo.ids, [off.id]);
  assert.deepEqual(unknownEnd(uo), { at: off.id, toward: coordinator.id });
  assert.equal(unknownEnd(u), null, "complete paths have no unknown end");
});

test("all paths on the sample: out to and in from every other available device, per kind complete or unknown", () => {
  const tally = {};
  for (const d of sample.devices) {
    for (const p of nodePaths(sample, d.id, "all")) {
      const t = (tally[p.kind] ??= { total: 0, complete: 0, unknown: 0, offline: 0 });
      t.total++;
      if (p.complete) t.complete++; else if (unknownEnd(p)) t.unknown++; else t.offline++;
      if (p.kind === "out") assert.equal(p.from, d.id);
      if (p.kind === "in") assert.equal(p.to, d.id);
      if (p.complete) assert.equal(p.ids.at(-1), p.to);
      assert.equal(p.ids[0], p.from);
    }
  }
  assert.deepEqual(tally, {
    up: { total: 44, complete: 41, unknown: 3, offline: 0 },
    down: { total: 44, complete: 33, unknown: 11, offline: 0 },
    // 41 available devices besides the coordinator, 40 goals each (spec 5.7); the coordinator adds its trees to and
    // from all 41.
    out: { total: 41 * 40 + 41, complete: 1681, unknown: 0, offline: 0 },
    in: { total: 41 * 40 + 41, complete: 1681, unknown: 0, offline: 0 },
  });
  // "All paths" includes the path to the coordinator first, and never repeats it.
  const r11 = byLabel("Router 11");
  const all = nodePaths(sample, r11, "all");
  assert.deepEqual(all.slice(0, 2), nodePaths(sample, r11));
  assert.ok(!all.some((p) => p.kind === "out" && p.to === coordinator.id));
  assert.ok(!all.some((p) => p.kind === "in" && p.from === coordinator.id));
  // Router 11 reaches Router 30 through Router 27 by its table; Router 01 reaches Router 11 by its table, directly.
  const to30 = all.find((p) => p.kind === "out" && labelOf.get(p.to) === "Router 30");
  assert.deepEqual(to30.ids.map((id) => labelOf.get(id)), ["Router 11", "Router 27", "Router 30"]);
  assert.deepEqual(to30.hops.map(hopText), ["134", "108"]);
  assert.deepEqual(to30.hops.map((h) => h.how), ["table", "table"]);
  const from01 = all.find((p) => p.kind === "in" && labelOf.get(p.from) === "Router 01");
  assert.deepEqual(from01.ids.map((id) => labelOf.get(id)), ["Router 01", "Router 11"]);
  assert.deepEqual(from01.hops.map((h) => h.how), ["table"]);
  // A walk by entries that reaches the parent of an end-device goal ends with the parent's delivery to its child:
  // Router 13 keeps "End device 06 via Router 17", and Router 17, the parent, keeps no entry for its own child. The
  // walk used to stop there and was then replaced by the walk towards the parent, which Router 13 has no entry for.
  const r13 = byLabel("Router 13");
  const toE06 = nodePaths(sample, r13, "all").find((p) => p.kind === "out" && labelOf.get(p.to) === "End device 06");
  assert.deepEqual(toE06.ids.map((id) => labelOf.get(id)), ["Router 13", "Router 17", "End device 06"]);
  assert.equal(toE06.complete, true);
  assert.deepEqual(toE06.hops.map(hopText), ["124", "parent"]);
  assert.deepEqual(toE06.hops.map((h) => h.how), ["table", "child"]);
  // Unknown modes count as the default.
  assert.deepEqual(nodePaths(sample, r11, "bogus"), nodePaths(sample, r11));
});

// --- Synthetic networks -------------------------------------------------------------------------------------------
const ieee = (n) => `aa:bb:cc:dd:00:00:00:${String(n).padStart(2, "0")}`;
const nwkText = (n) => `0x${(0x1000 + n).toString(16).toUpperCase()}`;
function synth(specs) {
  const typeOf = new Map(specs.map(([n, type]) => [n, type]));
  return buildNetwork(specs.map(([n, type, o = {}]) => ({
    ieee: ieee(n), nwk: 0x1000 + n, device_type: type, available: o.avail !== false, manufacturer: "V", model: "M",
    name: `dev${n}`, user_given_name: null, power_source: type === "EndDevice" ? "Battery or Unknown" : "Mains",
    last_seen: "2026-01-01T00:00:00", area_id: null, device_reg_id: null,
    neighbors: (o.nb || []).map(([m, lqi, rel = "Sibling"]) => ({ ieee: ieee(m), nwk: nwkText(m), lqi: String(lqi),
      relationship: rel, device_type: typeOf.get(m) })),
    routes: (o.rt || []).map(([d, h]) => ({ dest_nwk: nwkText(d), next_hop: nwkText(h), route_status: "Active" })),
  })));
}
const C = "Coordinator", R = "Router", E = "EndDevice";

test("all paths: a theoretical way to every available device and back, each hop with how it is taken", () => {
  const n = synth([
    [0, C, { nb: [[1, 200], [2, 180]], rt: [[3, 1], [5, 2]] }],
    [1, R, { nb: [[0, 190], [3, 120], [2, 90]], rt: [[0, 0], [3, 3], [5, 2], [6, 2]] }],
    [2, R, { nb: [[0, 170], [1, 80]], rt: [[0, 0], [5, 1], [6, 4]] }],       // 2 and 1 point at each other for 5
    [3, R, { nb: [[1, 110]], rt: [[0, 1], [6, 1]] }],
    [4, R],                                                                  // no table
    [5, R],
    [6, R, { avail: false }],
  ]);
  const paths = nodePaths(n, ieee(1), "all");
  assert.deepEqual(paths.map((p) => `${p.kind} ${p.kind === "in" ? p.from.slice(-2) : p.to.slice(-2)}`),
    ["up 00", "down 01", "out 02", "out 03", "out 04", "out 05", "in 02", "in 03", "in 04", "in 05"],
    "every available device but the coordinator and itself; not the unavailable 6");
  const out = Object.fromEntries(paths.filter((p) => p.kind === "out").map((p) => [p.to, p]));
  assert.deepEqual(out[ieee(3)].ids, [ieee(1), ieee(3)]);
  assert.deepEqual(out[ieee(3)].hops.map((h) => [hopText(h), h.how]), [["110", "table"]]);
  // Loop for destination 5: 1 -> 2 -> 1 is stopped at 2; the path ends there with 5 unknown.
  assert.deepEqual(out[ieee(5)].ids, [ieee(1), ieee(2)]);
  assert.deepEqual(unknownEnd(out[ieee(5)]), { at: ieee(2), toward: ieee(5) });
  assert.equal(out[ieee(5)].reason, "loop");
  // Router 4 has no table: nothing leads there (no entry, no reading, no link), and nothing leads on from there.
  assert.deepEqual([out[ieee(4)].ids, out[ieee(4)].reason], [[ieee(1)], "no link"]);
  const in4 = paths.find((p) => p.kind === "in" && p.from === ieee(4));
  assert.deepEqual([in4.ids, in4.reason], [[ieee(4)], "table not read"]);
  // 2 hears 1 (and 1 hears 2): the way back from 2 is a direct neighbour hop; 3 routes to the coordinator only.
  const in2 = paths.find((p) => p.kind === "in" && p.from === ieee(2));
  assert.deepEqual(in2.hops.map((h) => [hopText(h), h.how]), [["90", "neighbour"]]);
  const in3 = paths.find((p) => p.kind === "in" && p.from === ieee(3));
  assert.deepEqual(in3.hops.map((h) => [hopText(h), h.how]), [["120", "neighbour"]]);
  // The coordinator's own route to 3 is router 3's down path, not an "in" path.
  const [, down3] = nodePaths(n, ieee(3), "all");
  assert.deepEqual(down3.ids, [ieee(0), ieee(1), ieee(3)]);
});

test("pathHops: a hop without a pair (unavailable hearer) is unknown, never weak", () => {
  const n = synth([[0, C, { nb: [[1, 150]] }], [1, R, { avail: false, nb: [[0, 140]] }]]);
  const [hop] = pathHops(n, [ieee(0), ieee(1)]);
  assert.equal(hop.state, "unknown");
  assert.equal(hop.lqi, null);
  assert.equal(pathHops(n, [ieee(0)]).length, 0);
});

test("end device: its way up and down, and to every other device through its parent", () => {
  const n = synth([[0, C, { nb: [[1, 200]], rt: [[1, 1]] }], [1, R, { nb: [[0, 190], [2, 100, "Child"]], rt: [[0, 0]] }], [2, E]]);
  const all = nodePaths(n, ieee(2), "all");
  assert.deepEqual(all.map((p) => p.kind), ["up", "down", "out", "in"]);
  assert.deepEqual(all[2].hops.map((h) => h.how), ["parent"]);
  assert.deepEqual(all[3].hops.map((h) => h.how), ["child"]);
  assert.deepEqual(all[0].hops.map(hopText), ["100", "200"]);   // router 1 hears it at 100, the coordinator router 1 at 200
  assert.deepEqual(all[1].hops.map(hopText), ["190", "parent"]);
});
