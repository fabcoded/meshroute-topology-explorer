// SPDX-License-Identifier: MIT
// Tests of the theoretical paths (spec 5.7; decision by Fabian Schwamborn, 2026-11-01, brief a4k): the rules per hop
// (parent, child, table, neighbour, discovery) on small synthetic networks, the link cost, the tie-break, both
// directions apart, where a walk stops and why; then on the sample: the owner's cases, every pair complete, the
// counts per device, the table routes kept, and the CPU time of a click. node --test "tests/**/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { sampleNetwork } from "./panel-fixture.mjs";
import { buildNetwork, nodePaths, routePath }
  from "../custom_components/meshroute_topology_explorer/frontend/model/index.js";
import { HOWS, discoveryTree, linkCost, theoreticalPath }
  from "../custom_components/meshroute_topology_explorer/frontend/model/theoretical.js";

// --- Synthetic networks: [n, type, { nb: [[m, lqi, relationship]], rt: [[dest, next, status]], avail }] ----------
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
    routes: (o.rt || []).map(([d, h, status = "Active"]) => ({ dest_nwk: nwkText(d), next_hop: nwkText(h),
      route_status: status })),
  })));
}
const C = "Coordinator", R = "Router", E = "EndDevice";
/** A path as numbers and kinds: "1>2>3 table,child". */
const walk = (n, a, b) => {
  const p = theoreticalPath(n, ieee(a), ieee(b));
  const nums = p.ids.map((id) => Number(id.slice(-2))).join(">");
  return [nums, p.hops.map((h) => h.how).join(","), p.complete ? "" : `(${p.reason})`].filter(Boolean).join(" ");
};
/** Both directions of a link: [[a, lqi of b at a], [b, lqi of a at b]] as neighbour entries. */
const both = (a, b, lqi, back = lqi) => [[a, [b, lqi]], [b, [a, back]]];
/** Neighbour lists from links: { n: [[m, lqi, rel]] }. */
function nbOf(...links) {
  const nb = {};
  for (const [x, entry] of links.flat()) (nb[x] ??= []).push(entry);
  return nb;
}

test("link cost: 1 + round(6 (1 - LQI / 255)), from 1 at 255 to 7 at 0, never rising with LQI", () => {
  assert.deepEqual([255, 128, 0].map(linkCost), [1, 4, 7]);
  assert.equal(linkCost(300), 1, "clamped");
  assert.equal(linkCost(-5), 7, "clamped");
  for (let q = 1; q <= 255; q++) assert.ok(linkCost(q) <= linkCost(q - 1));
  assert.deepEqual(HOWS, ["parent", "child", "table", "neighbour", "discovery"]);
});

test("an end device sends to its parent first; a parent delivers to its child", () => {
  const nb = nbOf(both(0, 1, 200), both(1, 2, 200));
  nb[1].push([5, 120, "Child"]);
  nb[2].push([6, 110, "Child"]);
  const n = synth([[0, C, { nb: nb[0] }], [1, R, { nb: nb[1] }], [2, R, { nb: nb[2] }], [5, E], [6, E]]);
  assert.equal(walk(n, 5, 2), "5>1>2 parent,neighbour");
  assert.equal(walk(n, 5, 6), "5>1>2>6 parent,discovery,child", "the parent hears the other parent: discovery");
  assert.equal(walk(n, 1, 5), "1>5 child");
  assert.equal(walk(n, 6, 5), "6>2>1>5 parent,discovery,child");
});

test("a table entry beats a cheaper discovery; the next hop reads its own table", () => {
  // 1 -> 4: entries 1 -> 2 -> 3 -> 4 over weak links; the strong way 1 -> 5 -> 4 is never asked.
  const nb = nbOf(both(1, 2, 40), both(2, 3, 40), both(3, 4, 40), both(1, 5, 250), both(5, 4, 250), both(0, 1, 250));
  const n = synth([[0, C, { nb: nb[0] }], [1, R, { nb: nb[1], rt: [[4, 2]] }], [2, R, { nb: nb[2], rt: [[4, 3]] }],
    [3, R, { nb: nb[3], rt: [[4, 4]] }], [4, R, { nb: nb[4] }], [5, R, { nb: nb[5] }]]);
  assert.equal(walk(n, 1, 4), "1>2>3>4 table,table,table");
  // Without entries the same goal is found by discovery over the strong links.
  assert.equal(walk(n, 5, 1), "5>1 neighbour");
  assert.equal(walk(n, 2, 5), "2>1>5 discovery,discovery");
});

test("a measured neighbour beats a cheaper discovery, also when the way back is not measured", () => {
  // 1 hears 3 weakly (3 does not list 1): no link for discovery, but a neighbour entry for direct delivery.
  const nb = nbOf(both(1, 2, 250), both(2, 3, 250), both(0, 1, 250));
  nb[1].push([3, 20]);
  const n = synth([[0, C, { nb: nb[0] }], [1, R, { nb: nb[1] }], [2, R, { nb: nb[2] }], [3, R, { nb: nb[3] }]]);
  assert.equal(walk(n, 1, 3), "1>3 neighbour");
  assert.equal(walk(n, 3, 1), "3>2>1 discovery,discovery", "3 does not hear 1: the way back is discovered");
  const hop = theoreticalPath(n, ieee(1), ieee(3)).hops[0];
  assert.equal(hop.cost, undefined, "only discovery hops carry a link cost");
});

test("discovery: the lowest path cost, more hops if cheaper, then fewer hops, then the lower ids", () => {
  // 1 -> 4 without entries and without hearing 4: via 2 costs 1 + 4 = 5, via 3 costs 2 + 2 = 4, via 5, 6 costs 3.
  const nb = nbOf(both(1, 2, 255), both(2, 4, 128), both(1, 3, 200), both(3, 4, 200),
    both(1, 5, 255), both(5, 6, 255), both(6, 4, 255), both(0, 1, 255));
  const net = (extra = []) => synth([[0, C, { nb: nb[0] }], [1, R, { nb: nb[1] }], [2, R, { nb: nb[2] }],
    [3, R, { nb: nb[3] }], [4, R, { nb: nb[4] }], [5, R, { nb: nb[5] }], [6, R, { nb: nb[6] }], ...extra]);
  const n = net();
  assert.deepEqual([linkCost(255), linkCost(128), linkCost(200)], [1, 4, 2]);
  assert.equal(walk(n, 1, 4), "1>5>6>4 discovery,discovery,discovery");
  const p = theoreticalPath(n, ieee(1), ieee(4));
  assert.equal(p.cost, 3);
  assert.deepEqual(p.hops.map((h) => h.cost), [1, 1, 1]);
  const tree = discoveryTree(n, ieee(1));
  assert.deepEqual(tree.get(ieee(2)), { cost: 1, ids: [ieee(1), ieee(2)] });
  // Equal cost: fewer hops wins (1 -> 2 -> 4 costs 5, 1 -> 3 -> 7 -> 4 costs 2 + 1 + 2 = 5 too).
  const tie = synth([[0, C, { nb: [[1, 255]] }], [1, R, { nb: [[0, 255], [2, 255], [3, 200]] }],
    [2, R, { nb: [[1, 255], [4, 128]] }], [3, R, { nb: [[1, 200], [7, 255]] }], [4, R, { nb: [[2, 128], [7, 200]] }],
    [7, R, { nb: [[3, 255], [4, 200]] }]]);
  assert.equal(walk(tie, 1, 4), "1>2>4 discovery,discovery");
  // Equal cost and hops: the lower id (1 -> 2 -> 4 and 1 -> 3 -> 4, all links alike).
  const ids = synth([[0, C, { nb: [[1, 255]] }], [1, R, { nb: [[0, 255], [3, 200], [2, 200]] }],
    [2, R, { nb: [[1, 200], [4, 200]] }], [3, R, { nb: [[1, 200], [4, 200]] }], [4, R, { nb: [[2, 200], [3, 200]] }]]);
  assert.equal(walk(ids, 1, 4), "1>2>4 discovery,discovery");
  // The cost of a link is the larger of its two directions (Zigbee r22, 3.6.3.5.2): 1 hears 2 at 255, 2 hears 1 at 0+.
  const asym = synth([[0, C, { nb: [[1, 255]] }], [1, R, { nb: [[0, 255], [2, 255], [3, 200]] }],
    [2, R, { nb: [[1, 10], [4, 255]] }], [3, R, { nb: [[1, 200], [4, 200]] }], [4, R, { nb: [[2, 255], [3, 200]] }]]);
  assert.equal(walk(asym, 1, 4), "1>3>4 discovery,discovery", "1 -> 2 costs 7 for the weak way back");
});

test("both directions apart: each walk reads the tables of its own holders", () => {
  const nb = nbOf(both(0, 1, 255), both(1, 2, 255), both(2, 3, 255), both(1, 4, 120), both(4, 3, 120));
  const n = synth([[0, C, { nb: nb[0] }], [1, R, { nb: nb[1], rt: [[3, 4]] }], [2, R, { nb: nb[2] }],
    [3, R, { nb: nb[3] }], [4, R, { nb: nb[4], rt: [[3, 3]] }]]);
  assert.equal(walk(n, 1, 3), "1>4>3 table,table");
  assert.equal(walk(n, 3, 1), "3>2>1 discovery,discovery");
});

test("a walk stops at a loop, an unavailable device, without any link or parent, and says why", () => {
  const nb = nbOf(both(0, 1, 255), both(1, 2, 255), both(2, 3, 255));
  nb[9] = [[1, 200]];                                         // 9 hears 1, 1 does not list 9: no link
  const n = synth([[0, C, { nb: nb[0] }], [1, R, { nb: nb[1], rt: [[3, 2], [8, 8]] }],
    [2, R, { nb: nb[2], rt: [[3, 1]] }], [3, R, { nb: nb[3] }], [8, R, { avail: false }], [9, R, { nb: nb[9] }],
    [5, E]]);
  assert.equal(walk(n, 1, 3), "1>2 table (loop)");
  assert.equal(walk(n, 1, 8), "1>8 table (unavailable)");
  assert.equal(walk(n, 2, 9), "2 (no link)");
  assert.equal(walk(n, 5, 1), "5 (no parent)");
  assert.equal(walk(n, 1, 5), "1 (no parent)");
  assert.equal(theoreticalPath(n, ieee(1), "nobody").reason, "unknown device");
  assert.equal(walk(n, 8, 1), "8 (unavailable)");
  // A discovery that would lead back over a device the walk already passed is a loop too (main session, 2026-11-01).
  const back = synth([[0, C, { nb: [[1, 255]] }], [1, R, { nb: [[0, 255], [2, 255], [3, 255]], rt: [[4, 2]] }],
    [2, R, { nb: [[1, 255]] }], [3, R, { nb: [[1, 255], [4, 255]] }], [4, R, { nb: [[3, 255]] }]]);
  assert.equal(walk(back, 1, 4), "1>2 table (loop)", "2 has no entry; its only way to 4 runs back over 1");
});

test("an inactive entry or an unread table counts as no entry, and the hop says why", () => {
  const nb = nbOf(both(0, 1, 255), both(1, 2, 255), both(2, 3, 255));
  const n = synth([[0, C, { nb: nb[0] }], [1, R, { nb: nb[1], rt: [[3, 3, "Inactive"]] }], [2, R, { nb: nb[2] }],
    [3, R, { nb: nb[3] }], [4, R, { nb: [] }]]);
  const p = theoreticalPath(n, ieee(1), ieee(3));
  assert.equal(walk(n, 1, 3), "1>2>3 discovery,discovery");
  assert.equal(p.hops[0].reason, "entry inactive");
  assert.equal(p.hops[1].reason, undefined);
  // A router whose table was not read cannot be followed: it has no measured link of its own.
  assert.equal(walk(n, 4, 1), "4 (table not read)");
});

test("an end-device goal is reached by its own entry or by discovery to its parent, never by the parent's entry", () => {
  // 1 has an entry for 2 (the parent of 5) and hears 2, but none for 5: it discovers, and 2 delivers.
  const nb = nbOf(both(0, 1, 255), both(1, 2, 60), both(1, 3, 255), both(3, 2, 255));
  nb[2].push([5, 150, "Child"]);
  const n = synth([[0, C, { nb: nb[0] }], [1, R, { nb: nb[1], rt: [[2, 2]] }], [2, R, { nb: nb[2] }],
    [3, R, { nb: nb[3] }], [5, E]]);
  assert.equal(walk(n, 1, 5), "1>3>2>5 discovery,discovery,child", "1 -> 2 directly costs 6, via 3 costs 2");
  assert.equal(walk(n, 1, 2), "1>2 table");
  const own = synth([[0, C, { nb: nb[0] }], [1, R, { nb: nb[1], rt: [[5, 2]] }], [2, R, { nb: nb[2] }],
    [3, R, { nb: nb[3] }], [5, E]]);
  assert.equal(walk(own, 1, 5), "1>2>5 table,child");
});

// --- The sample -----------------------------------------------------------------------------------------------------
const sample = sampleNetwork();
const coordinator = sample.devices.find((d) => d.role === "coordinator");
const byLabel = (label) => sample.devices.find((d) => d.label === label).id;
const labelOf = new Map(sample.devices.map((d) => [d.id, d.label]));
const names = (p) => p.ids.map((id) => labelOf.get(id));
const kinds = (p) => p.hops.map((h) => h.how);
const others = (id) => sample.devices.filter((d) => d.id !== id && d.id !== coordinator.id && d.available);

test("sample, the owner's cases: Router 13 to End device 06 and to Router 24 by the tables", () => {
  const r13 = byLabel("Router 13");
  const e06 = theoreticalPath(sample, r13, byLabel("End device 06"));
  assert.deepEqual(names(e06), ["Router 13", "Router 17", "End device 06"]);
  assert.deepEqual(kinds(e06), ["table", "child"]);
  const r24 = theoreticalPath(sample, r13, byLabel("Router 24"));
  assert.deepEqual(names(r24), ["Router 13", "Router 17", "Router 24"]);
  assert.deepEqual(kinds(r24), ["table", "table"]);
  // An end device as source goes to its parent first.
  for (const d of others(byLabel("End device 06"))) {
    const p = theoreticalPath(sample, byLabel("End device 06"), d.id);
    assert.deepEqual([names(p)[1], kinds(p)[0]], ["Router 17", "parent"], d.label);
  }
  // A goal that no table names is reached by discovery from where the tables end.
  const named = new Set(sample.routes.map((r) => r.destination));
  const unnamed = sample.devices.filter((d) => d.role === "router" && d.available && !named.has(d.id));
  const found = unnamed.flatMap((d) => others(d.id).map((s) => theoreticalPath(sample, s.id, d.id)))
    .filter((p) => kinds(p).includes("discovery"));
  assert.ok(unnamed.length > 0 && found.length > 0, "routers no table names, reached by discovery");
  for (const p of found) {
    assert.equal(p.complete, true);
    assert.equal(p.cost, p.hops.filter((h) => h.how === "discovery").reduce((sum, h) => sum + h.cost, 0));
  }
});

test("sample: every pair of available devices has a complete way, out and in apart; the hops by kind", () => {
  const tally = Object.fromEntries(HOWS.map((h) => [h, 0]));
  const incomplete = [];
  let count = 0;
  for (const a of sample.devices) for (const b of sample.devices) {
    if (a === b || !a.available || !b.available || a === coordinator || b === coordinator) continue;
    const p = theoreticalPath(sample, a.id, b.id);
    count++;
    if (!p.complete) incomplete.push(`${a.label} -> ${b.label}: ${p.reason}`);
    else assert.equal(p.ids.at(-1), b.id);
    for (const h of p.hops) tally[h.how]++;
  }
  assert.equal(count, 41 * 40);
  assert.deepEqual(incomplete, []);
  assert.deepEqual(tally, { parent: 480, child: 480, table: 198, neighbour: 603, discovery: 1507 });
});

test("sample, stage 2 of a click: an out and an in path to every other available device, hops by kind", () => {
  const count = (label) => {
    const id = byLabel(label);
    const all = nodePaths(sample, id, "all");
    const out = all.filter((p) => p.kind === "out");
    const into = all.filter((p) => p.kind === "in");
    assert.deepEqual(all.slice(0, 2).map((p) => p.kind), ["up", "down"]);
    assert.deepEqual(out.map((p) => p.to), others(id).map((d) => d.id), `${label}: out to every other device`);
    assert.deepEqual(into.map((p) => p.from), others(id).map((d) => d.id), `${label}: in from every other device`);
    assert.ok([...out, ...into].every((p) => p.complete && p.hops.every((h) => HOWS.includes(h.how))));
    const tally = Object.fromEntries(HOWS.map((h) => [h, 0]));
    for (const p of [...out, ...into]) for (const h of p.hops) tally[h.how]++;
    return { out: out.length, in: into.length, ...tally };
  };
  assert.deepEqual(count("End device 06"), { out: 40, in: 40, parent: 51, child: 51, table: 4, neighbour: 23,
    discovery: 77 });
  assert.deepEqual(count("Router 13"), { out: 40, in: 40, parent: 12, child: 12, table: 6, neighbour: 38,
    discovery: 69 });
  assert.deepEqual(count("Router 11"), { out: 40, in: 40, parent: 12, child: 12, table: 13, neighbour: 48,
    discovery: 32 });
  // Router 11's own routes stay the walks they were (spec 5.1), wherever those reached their goal.
  const r11 = byLabel("Router 11");
  const all = nodePaths(sample, r11, "all");
  for (const r of sample.routes.filter((x) => x.owner === r11 && x.destination !== coordinator.id)) {
    const before = routePath(sample, r11, r.destination);
    const now = all.find((p) => p.kind === "out" && p.to === r.destination);
    if (!before.complete) continue;
    assert.deepEqual(now.ids, before.ids, labelOf.get(r.destination));
    assert.ok(kinds(now).every((k) => k === "table" || k === "child"), labelOf.get(r.destination));
  }
  // An unavailable device has no theoretical paths. The coordinator gets its trees in stage 2 like any device, from
  // its own table on (decision by Fabian Schwamborn, 2026-11-01); stage 1 keeps its routes.
  const off = sample.devices.find((d) => !d.available);
  assert.deepEqual(nodePaths(sample, off.id, "all").map((p) => p.kind), ["up", "down"]);
  const tally = Object.fromEntries(HOWS.map((h) => [h, 0]));
  const trees = nodePaths(sample, coordinator.id, "all");
  for (const p of trees) for (const h of p.hops) tally[h.how]++;
  assert.equal(trees.length, 82);
  assert.deepEqual(tally, { parent: 12, child: 12, table: 115, neighbour: 7, discovery: 3 });
  assert.ok(nodePaths(sample, coordinator.id).every((p) => !p.hops.some((h) => h.how)));
});

test("a click stays well under 100 ms of model time on the sample (CPU time, fresh caches)", (t) => {
  // Process CPU time also counts the engine's compiler and garbage collector threads, so two warm-up rounds over the
  // four clicks compile the code first (with one Router 11 click, End device 06's first measured clicks still paid the
  // optimising compiler's threads: 60-130 ms CPU at 15-30 ms wall, brief a4z), and each click counts its best of three
  // fresh networks (no cached lookups or discovery trees).
  const labels = ["Router 11", "Router 13", "Router 03", "End device 06"];
  for (let round = 0; round < 2; round++) {
    for (const label of labels) {
      const warm = sampleNetwork();
      nodePaths(warm, warm.devices.find((d) => d.label === label).id, "all");
    }
  }
  let worst = 0;
  for (const label of labels) {
    let best = Infinity;
    for (let i = 0; i < 3; i++) {
      const network = sampleNetwork();
      const cpu = process.cpuUsage();
      nodePaths(network, network.devices.find((d) => d.label === label).id, "all");
      const used = process.cpuUsage(cpu);
      best = Math.min(best, (used.user + used.system) / 1000);
    }
    worst = Math.max(worst, best);
  }
  // About 30 to 45 ms here alone (2026-11-01, Node 18 under WSL, brief a4z), more beside the other suites; the limit
  // is the brief's.
  t.diagnostic && t.diagnostic(`slowest click ${worst.toFixed(1)} ms CPU`);
  assert.ok(worst < 100, `${worst} ms CPU`);
});

test("on the sample the cheapest way hits the real next hop of 11 of 37 active non-direct router entries (note of brief a4o)", async () => {
  const { sampleNetwork } = await import("./panel-fixture.mjs");
  const { discoveryTree } = await import("../custom_components/meshroute_topology_explorer/frontend/model/theoretical.js");
  const n = sampleNetwork();
  const by = new Map(n.devices.map((d) => [d.id, d]));
  let hit = 0;
  let total = 0;
  for (const r of n.routes) {
    const owner = by.get(r.owner);
    const dest = by.get(r.destination);
    if (r.stale || !/^active/i.test(String(r.status)) || r.owner === r.nextHop || r.nextHop === r.destination) continue;
    if (!owner || !dest || owner.role !== "router" || !owner.available) continue;
    total++;
    const found = discoveryTree(n, owner.id).get(dest.role === "end device" ? dest.parent : dest.id);
    if (found && found.ids[1] === r.nextHop) hit++;
  }
  assert.deepEqual([hit, total], [11, 37]);
});
