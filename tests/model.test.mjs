// SPDX-License-Identifier: MIT
// Tests for the data model on the anonymized sample, derived variants (spec 12) and small synthetic networks.
// Run: node --test "tests/**/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { removedTables, withoutTables } from "./derive.mjs";
import { buildNetwork, upPath, downPath, parseAddress, parseLqi, fingerprints, updateObservations, newestChange }
  from "../custom_components/meshroute_topology_explorer/frontend/model/index.js";

const load = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")).responses;
const networkOf = (name) => {
  const r = load(name);
  return buildNetwork(r["zha/devices"], { deviceRegistry: r["config/device_registry/list"],
    areaRegistry: r["config/area_registry/list"], configEntries: r["config_entries/get"] });
};
const sample = networkOf("zha-sample.json");
const coordinator = sample.devices.find((d) => d.role === "coordinator");
const others = sample.devices.filter((d) => d !== coordinator);

// --- Synthetic networks: id n -> ieee aa:bb:cc:dd:00:00:00:0n, nwk 0x100n -------------------------------------
const ieee = (n) => `aa:bb:cc:dd:00:00:00:${String(n).padStart(2, "0")}`;
const nwkText = (n) => `0x${(0x1000 + n).toString(16).toUpperCase()}`;
/** spec: [n, type, { avail, vendor, model, nb: [[n, lqi, rel]], rt: [[dest, next]] }] */
function synth(specs) {
  const typeOf = new Map(specs.map(([n, type]) => [n, type]));
  return specs.map(([n, type, o = {}]) => ({
    ieee: ieee(n), nwk: 0x1000 + n, device_type: type, available: o.avail !== false, manufacturer: o.vendor ?? "V",
    model: o.model ?? "M", name: `dev${n}`, user_given_name: null, power_source: type === "EndDevice" ? "Battery or Unknown" : "Mains",
    last_seen: "2026-01-01T00:00:00", area_id: null, device_reg_id: null,
    neighbors: (o.nb || []).map(([m, lqi, rel = "Sibling"]) => ({ ieee: ieee(m), nwk: nwkText(m), lqi: String(lqi), relationship: rel,
      device_type: typeOf.get(m) })),
    routes: (o.rt || []).map(([d, h]) => ({ dest_nwk: nwkText(d), next_hop: nwkText(h), route_status: "Active" })),
  }));
}
const C = "Coordinator", R = "Router", E = "EndDevice";

test("sample: path numbers of spec 12", () => {
  const up = others.map((d) => upPath(sample, d.id));
  const down = others.map((d) => downPath(sample, d.id));
  assert.equal(others.length, 44);
  assert.equal(up.filter((p) => p.complete).length, 41);  // stale tables are never followed
  assert.equal(down.filter((p) => p.complete).length, 29);
  // "differ": complete down path that is not the reverse of the up path
  const differ = others.filter((d, i) => down[i].complete &&
    JSON.stringify([...up[i].ids].reverse()) !== JSON.stringify(down[i].ids)).length;
  assert.equal(differ, 20);
  assert.equal(sample.findings.filter((f) => f.kind === "route to offline device").length, 2);
  assert.ok(up.every((p) => !p.complete || p.ids.at(-1) === coordinator.id));
  assert.ok(down.every((p) => !p.complete || p.ids[0] === coordinator.id));
});

test("sample: status, findings per kind, roles and parents", () => {
  assert.deepEqual(sample.status, { routersAvailable: 29, routersWithTable: 29, devicesListed: 43, devicesTotal: 45,
    unavailable: 3, completeness: 1 });
  const kinds = {};
  for (const f of sample.findings) kinds[f.kind] = (kinds[f.kind] || 0) + 1;
  assert.deepEqual(kinds, { offline: 3, "route to offline device": 2, "very low reading": 10 });
  assert.equal(sample.id, "entry_01");
  const ends = sample.devices.filter((d) => d.role === "end device");
  assert.equal(ends.length, 12);
  assert.ok(ends.every((d) => d.battery && d.parent));
  assert.ok(sample.devices.filter((d) => d.role !== "end device").every((d) => d.parent === null));
  const childCount = sample.devices.reduce((n, d) => n + d.children.length, 0);
  assert.equal(childCount, 12);
  assert.ok(sample.readings.every((r) => r.scale === "zigbee-lqi" && r.reporter !== r.subject));
  assert.ok(sample.devices.every((d) => d.rating === null || (d.rating >= 0 && d.rating <= 1)));
});

test("derived variants drop these routers (pins the rule in tests/derive.mjs)", () => {
  const removed = removedTables(load("zha-sample.json")["zha/devices"]);
  assert.deepEqual(removed.minus1, [ieee(7)]);
  assert.deepEqual(removed.minus3, [ieee(7), ieee(8), ieee(9)]);
  assert.equal(removed["coordinator-only"].length, 32);
  assert.deepEqual(removed["without-coordinator"], [ieee(1)]);
  const devices = load("zha-sample.json")["zha/devices"];
  const coordinatorOnly = withoutTables(devices, removed["coordinator-only"]);
  assert.ok(coordinatorOnly.filter((d) => d.device_type === "Router").every((d) => !d.neighbors.length && !d.routes.length));
  assert.ok(coordinatorOnly.find((d) => d.device_type === "Coordinator").neighbors.length > 0);
});

test("derived variants: findings are a subset of the sample's plus data incomplete (spec 12)", () => {
  const known = new Set(sample.findings.map((f) => `${f.kind}|${f.device}`));
  const devices = load("zha-sample.json")["zha/devices"];
  for (const [name, gone] of Object.entries(removedTables(devices))) {
    const net = buildNetwork(withoutTables(devices, gone));
    assert.ok(net.findings.some((f) => f.kind === "data incomplete"), name);
    for (const f of net.findings) {
      if (f.kind === "data incomplete") { assert.ok(f.missing.length, name); continue; }
      if (f.kind === "parent unknown") {
        // Missing tables may only produce the hedged variant naming them, never the verdict "no parent".
        assert.ok(f.missing.length > 0 && f.evidence.verdict === "parent unknown", `${name}: ${f.device}`);
        continue;
      }
      assert.ok(known.has(`${f.kind}|${f.device}`), `${name}: new ${f.kind} on ${f.device}`);
      assert.ok(!["isolated", "weak reception"].includes(f.kind), name);
    }
  }
});

test("parsing: 0x and 0X text, numbers, LQI as text; no string comparison", () => {
  assert.equal(parseAddress("0x0D"), 13);
  assert.equal(parseAddress("0X0d"), 13);
  assert.equal(parseAddress("0x000D"), parseAddress("0xd"));
  assert.equal(parseAddress(11138), 11138);
  assert.equal(parseAddress("11138"), 11138);
  for (const bad of ["", "0x", "0xZZ", "abc", null, undefined, -1, 1.5, {}]) assert.equal(parseAddress(bad), null);
  assert.equal(parseLqi("157"), 157);
  assert.equal(parseLqi(" 9 "), 9);
  assert.equal(parseLqi(0), 0);
  assert.ok(parseLqi("9") < parseLqi("157"));
  assert.equal(parseLqi("x"), null);
  assert.equal(parseLqi(null), null);
  assert.equal(parseLqi(-3), null);

  // The same network spelled three ways gives the same result.
  const base = synth([[0, C, { nb: [[1, 120], [2, 90, "Child"]], rt: [[1, 1]] }], [1, R, { nb: [[0, 100]], rt: [[0, 0]] }], [2, E]]);
  const spelled = JSON.parse(JSON.stringify(base));
  spelled[0].neighbors[0].nwk = "0X1001"; spelled[0].neighbors[0].lqi = 120;          // upper-case prefix, LQI as number
  spelled[0].routes[0].dest_nwk = "0x01001"; spelled[0].routes[0].next_hop = 4097;    // padded text, plain number
  spelled[1].nwk = "4097";                                                          // decimal text
  const a = buildNetwork(base), b = buildNetwork(spelled);
  assert.deepEqual(a.readings.map((r) => [r.subject, r.lqi]), b.readings.map((r) => [r.subject, r.lqi]));
  assert.deepEqual(a.routes, b.routes);
  assert.equal(downPath(b, ieee(1)).complete, true);
});

test("a neighbour without usable IEEE is resolved by network address; an unknown but usable IEEE is not", () => {
  const raw = synth([[0, C, { nb: [[1, 120]] }], [1, R]]);
  raw[0].neighbors[0].ieee = "";
  raw[0].neighbors.push({ ieee: ieee(77), nwk: nwkText(1), lqi: "50", relationship: "Sibling" }); // unknown device
  const n = buildNetwork(raw);
  assert.equal(n.readings.length, 1);
  assert.equal(n.readings[0].subject, ieee(1));
  assert.equal(n.unresolved.neighbours, 1);
});

test("parents: Child entries of end devices only, higher LQI wins, routers' Child entries ignored", () => {
  const raw = synth([
    [0, C, { nb: [[1, 100, "Child"], [2, 120, "Sibling"], [3, 60, "Child"]] }],
    [1, R, { nb: [[3, 150, "Child"], [0, 80, "Parent"]] }],
    [2, R, { nb: [[3, 90, "Child"]] }],
    [3, E],
  ]);
  const n = buildNetwork(raw);
  const byId = Object.fromEntries(n.devices.map((d) => [d.id, d]));
  assert.equal(byId[ieee(3)].parent, ieee(1));
  assert.deepEqual(byId[ieee(3)].possiblyStaleParents, [ieee(2), ieee(0)]);
  assert.equal(byId[ieee(1)].parent, null);   // a router never gets a parent, whatever the Child/Parent entries say
  assert.deepEqual(byId[ieee(1)].children, [ieee(3)]);
});

test("ratings: mid-rank percentile, LQI 0 excluded, vendor pool, no rating below ten values", () => {
  const specs = [[0, C], [1, R, { vendor: "A", nb: [] }]];
  for (let i = 0; i < 12; i += 1) specs.push([10 + i, E]);
  specs[1][2].nb = Array.from({ length: 12 }, (_, i) => [10 + i, i === 0 ? 0 : 10 * i]); // 0, 10, 20 ... 110
  const n = buildNetwork(synth(specs));
  const r = (s) => n.readings.find((x) => x.subject === ieee(s));
  assert.equal(r(10).rating, null);                    // LQI 0: never rated
  assert.equal(r(11).rating, 0.5 / 11);                // lowest of 11 non-zero values
  assert.equal(r(21).rating, 10.5 / 11);
  assert.equal(r(11).pool, "reporter");
  assert.equal(n.devices.find((d) => d.id === ieee(10)).rating, null);   // only reading is LQI 0
  assert.equal(n.devices.find((d) => d.id === ieee(21)).rating, 10.5 / 11);

  // Small reporters borrow the vendor's pool; a vendor with fewer than ten values leaves the rating empty.
  const small = synth([[0, C], [1, R, { vendor: "A", nb: [[2, 10], [3, 20], [4, 30], [5, 40], [6, 50]] }],
    [2, R, { vendor: "A", nb: [[1, 15], [3, 25], [4, 35], [5, 45], [6, 55]] }], [3, E], [4, E], [5, E], [6, E]]);
  const m = buildNetwork(small);
  assert.equal(m.readings[0].pool, "vendor");
  assert.equal(m.readings[0].rating, 0.5 / 10);
  const tiny = buildNetwork(small.slice(0, 5));
  assert.ok(tiny.readings.every((x) => x.rating === null && x.pool === null));
});

test("paths: loop, missing entry, unavailable hop, direct neighbours are not guessed", () => {
  const raw = synth([
    [0, C, { nb: [[1, 100], [2, 100]], rt: [[3, 1], [4, 1], [5, 1]] }],     // no entry for 1 or 2 (direct neighbours)
    [1, R, { nb: [[0, 100]], rt: [[0, 0], [3, 3]] }],
    [2, R, { nb: [[0, 100]], rt: [[0, 3]] }],                               // up path 2 -> 3 -> ... 3 has no entry
    [3, R, { nb: [[1, 100]], rt: [[0, 4]] }],
    [4, R, { avail: false, nb: [[1, 100]], rt: [[0, 3]] }],
    [5, R, { nb: [[1, 100]], rt: [[0, 4]] }],                               // goes through unavailable 4
    [6, E],
  ]);
  const n = buildNetwork(raw);
  const up = (k) => upPath(n, ieee(k));
  assert.deepEqual(up(1), { ids: [ieee(1), ieee(0)], complete: true });
  assert.equal(up(2).complete, false);             // 2 -> 3 -> 4 (unavailable) stops
  assert.equal(up(5).complete, false);
  assert.equal(up(6).complete, false);             // no parent
  assert.equal(up(0).complete, true);
  assert.equal(downPath(n, ieee(1)).complete, false);   // no coordinator entry for its direct neighbour
  assert.deepEqual(downPath(n, ieee(3)), { ids: [ieee(0), ieee(1), ieee(3)], complete: true });
  assert.equal(downPath(n, ieee(5)).complete, false);   // 0 -> 1 -> (no entry for 5 at router 1)
  assert.equal(downPath(n, ieee(4)).complete, false);   // destination unavailable
  assert.deepEqual(downPath(n, ieee(9)), { ids: [], complete: false });
  // loop: 1 and 2 point at each other for destination 7
  const loop = synth([[0, C, { rt: [[7, 1]] }], [1, R, { rt: [[7, 2]] }], [2, R, { rt: [[7, 1]] }], [7, R]]);
  assert.equal(downPath(buildNetwork(loop), ieee(7)).complete, false);
});

test("an unavailable router's own stale routes are not followed", () => {
  const n = buildNetwork(synth([[0, C, { nb: [[1, 100]] }], [1, R, { avail: false, nb: [[0, 90]], rt: [[0, 0]] }]]));
  assert.equal(n.routes.length, 1);
  assert.equal(n.routes[0].stale, true);
  assert.deepEqual(upPath(n, ieee(1)), { ids: [ieee(1)], complete: false });
});

test("down path to an end device: parent path plus parent link", () => {
  const raw = synth([
    [0, C, { nb: [[1, 100]], rt: [[1, 1]] }],
    [1, R, { nb: [[2, 90, "Child"]], rt: [[0, 0]] }],
    [2, E],
  ]);
  const n = buildNetwork(raw);
  assert.deepEqual(downPath(n, ieee(2)), { ids: [ieee(0), ieee(1), ieee(2)], complete: true });
  assert.deepEqual(upPath(n, ieee(2)), { ids: [ieee(2), ieee(1), ieee(0)], complete: true });
});

test("routes that are not Active are kept but not followed or counted", () => {
  const raw = synth([[0, C, { rt: [[2, 1]] }], [1, R, { rt: [[2, 2]] }], [2, R]]);
  raw[0].routes[0].route_status = "Discovery_Failed";
  const n = buildNetwork(raw);
  assert.equal(n.routes.length, 2);
  assert.equal(downPath(n, ieee(2)).complete, false);
  assert.equal(n.devices.find((d) => d.id === ieee(1)).relayLoad, 0);
});

test("relay load counts active, non-direct routes in available tables", () => {
  const raw = synth([
    [0, C, { rt: [[2, 1], [3, 1], [1, 1]] }],      // 2 relayed routes via 1; the route to 1 itself is direct
    [1, R, { rt: [[2, 2]] }],                      // direct
    [2, R, { rt: [[3, 1]] }],                      // one more via 1
    [3, R, { avail: false, rt: [[2, 1]] }],        // stale table: not counted
  ]);
  const n = buildNetwork(raw);
  assert.equal(n.devices.find((d) => d.id === ieee(1)).relayLoad, 3);
  assert.equal(n.devices.find((d) => d.id === ieee(2)).relayLoad, 0);
});

test("stale tables: readings dropped, routes flagged, no findings from them", () => {
  const raw = synth([
    [0, C, { nb: [[1, 100]] }],
    [1, R, { avail: false, nb: [[0, 5], [2, 4]], rt: [[2, 2]] }],
    [2, R, { nb: [[0, 100]] }],
  ]);
  const n = buildNetwork(raw);
  assert.ok(n.readings.every((r) => r.reporter !== ieee(1)));
  assert.ok(n.routes.every((r) => r.stale));
  assert.ok(!n.findings.some((f) => f.kind === "very low reading"));
  assert.equal(n.devices.find((d) => d.id === ieee(1)).hasTable, false);
  assert.equal(n.status.routersAvailable, 1);
});

test("findings: parent unknown / no parent, isolated, data incomplete, offline, parent offline, many children", () => {
  const raw = synth([
    [0, C, { nb: [[1, 100, "Child"], [2, 100, "Child"], [5, 100, "Child"], [6, 100, "Child"]] }],
    [1, R, { nb: [[0, 100], [3, 100, "Child"], [4, 100, "Child"], [7, 100, "Child"]] }],
    [2, R, { nb: [[0, 100]] }],
    [8, R, { nb: [[0, 100]] }],                   // nobody lists 8 -> isolated
    [9, R],                                       // available router without a table
    [3, E], [4, E], [7, E],
    [5, E],                                       // child of the coordinator
    [6, E, { avail: false }],
    [10, E],                                      // listed by nobody
  ]);
  const incomplete = buildNetwork(raw);
  const f = (net, kind) => net.findings.filter((x) => x.kind === kind);
  assert.deepEqual(f(incomplete, "parent unknown").map((x) => [x.device, x.missing]), [[ieee(10), [ieee(9)]]]);
  assert.equal(f(incomplete, "isolated").length, 0);                     // gated by the missing table of 9
  assert.deepEqual(f(incomplete, "data incomplete").map((x) => x.device), [ieee(9)]);
  assert.deepEqual(f(incomplete, "many end-device children").map((x) => x.device), [ieee(1)]);
  assert.deepEqual(f(incomplete, "offline").map((x) => x.device), [ieee(6)]);

  raw.find((d) => d.ieee === ieee(9)).neighbors = [{ ieee: ieee(0), nwk: nwkText(0), lqi: "90", relationship: "Sibling" }];
  const complete = buildNetwork(raw);
  assert.deepEqual(f(complete, "parent unknown").map((x) => [x.device, x.evidence.verdict, x.missing]), [[ieee(10), "no parent", []]]);
  assert.deepEqual(f(complete, "isolated").map((x) => x.device), [ieee(8), ieee(9)]);
  assert.equal(f(complete, "data incomplete").length, 0);

  const po = buildNetwork(synth([[0, C, { nb: [[1, 100, "Child"]] }], [1, R, { avail: false, nb: [[2, 90, "Child"]] }], [2, E]]));
  assert.deepEqual(f(po, "parent offline").map((x) => [x.device, x.evidence.parent]), [[ieee(2), ieee(1)]]);
  // The end device is listed only by the unavailable router: the finding names the last known parent.
  assert.equal(f(po, "parent offline")[0].evidence.lastKnown, true);
  assert.equal(f(po, "parent unknown").length, 0);
  assert.equal(upPath(po, ieee(2)).complete, false);   // stale parent is offline: the walk stops there
});

test("weak reception needs a low rank, a low value and complete expected reporters", () => {
  // Router 1 hears twelve routers; router 10 is the weakest at LQI 20 against a median of about 106
  const specs = [[0, C, { nb: [[1, 200]] }]];
  const hears = [];
  for (let i = 0; i < 12; i += 1) { specs.push([10 + i, R, { nb: [[1, 100 + i]] }]); hears.push([10 + i, i === 0 ? 20 : 100 + i]); }
  specs.push([1, R, { nb: [[0, 200], ...hears] }]);
  const withAll = buildNetwork(synth(specs));
  const weak = withAll.findings.filter((x) => x.kind === "weak reception");
  assert.deepEqual(weak.map((x) => x.device), [ieee(10)]);
  assert.equal(weak[0].evidence.reporter, ieee(1));
  assert.ok(weak[0].evidence.lqi < 0.5 * weak[0].evidence.reporterMedian);
  // Router 10 without a table has no expected reporters, so no verdict.
  const noReporterTable = synth(specs);
  noReporterTable.find((d) => d.ieee === ieee(10)).neighbors = []; // 10 itself has no table -> no expected reporters
  assert.equal(buildNetwork(noReporterTable).findings.filter((x) => x.kind === "weak reception").length, 0);
  // Expected reporter 11 (listed by 10) without a table blocks the verdict and raises data incomplete instead.
  const lacking = synth(specs);
  lacking.find((d) => d.ieee === ieee(10)).neighbors.push({ ieee: ieee(11), nwk: nwkText(11), lqi: "80", relationship: "Sibling" });
  lacking.find((d) => d.ieee === ieee(11)).neighbors = [];
  const net = buildNetwork(lacking);
  assert.equal(net.findings.filter((x) => x.kind === "weak reception" && x.device === ieee(10)).length, 0);
  assert.ok(net.findings.some((x) => x.kind === "data incomplete" && x.device === ieee(10) && x.missing.includes(ieee(11))));
});

test("very low reading: 1 to 10, never 0, never towards an unavailable device", () => {
  const raw = synth([[0, C, { nb: [[1, 0], [2, 1], [3, 10], [4, 11], [5, 5]] }], [1, E], [2, E], [3, E], [4, E], [5, E, { avail: false }]]);
  const low = buildNetwork(raw).findings.filter((x) => x.kind === "very low reading").map((x) => x.device);
  assert.deepEqual(low, [ieee(2), ieee(3)]);
});

test("labels: identical names get the network address; names and areas come from the registries", () => {
  const raw = synth([[0, C], [1, R], [2, R]]);
  raw[1].user_given_name = "Lamp"; raw[2].user_given_name = "Lamp";
  raw[0].device_reg_id = "reg0"; raw[0].area_id = "a1";
  const n = buildNetwork(raw, { deviceRegistry: [{ id: "reg0", identifiers: [["zha", ieee(0)]], name: "Stick", name_by_user: "Main stick", area_id: "a2" }],
    areaRegistry: [{ area_id: "a1", name: "Hall" }, { area_id: "a2", name: "Cellar" }] });
  assert.equal(n.devices[1].label, "Lamp (0x1001)");
  assert.equal(n.devices[2].label, "Lamp (0x1002)");
  assert.equal(n.devices[1].labelKind, "user");
  assert.equal(n.devices[0].label, "Main stick");   // registry name_by_user counts as a user-given name
  assert.equal(n.devices[0].name, "dev0");          // the ZHA name stays in `name`
  assert.equal(n.devices[0].registryId, "reg0");
  assert.equal(n.devices[1].registryId, null);
  assert.equal(n.devices[0].area, "Cellar");   // the registry's area wins over the one in the ZHA answer
});

test("observations: fingerprint ignores order and spelling, notices LQI changes, store keeps first sight", () => {
  const raw = synth([[0, C, { nb: [[1, 100], [2, 90]], rt: [[2, 2]] }], [1, R, { nb: [[0, 100]] }], [2, R, { nb: [[0, 90]] }]]);
  const fp = fingerprints(buildNetwork(raw));
  const shuffled = JSON.parse(JSON.stringify(raw));
  shuffled[0].neighbors.reverse(); shuffled[0].neighbors[0].nwk = nwkText(2).replace("0x", "0X");
  assert.deepEqual(fingerprints(buildNetwork(shuffled)), fp);
  const changed = JSON.parse(JSON.stringify(raw));
  changed[0].neighbors[0].lqi = "101";
  const fp2 = fingerprints(buildNetwork(changed));
  assert.notEqual(fp2[ieee(0)], fp[ieee(0)]);
  assert.equal(fp2[ieee(1)], fp[ieee(1)]);

  const first = updateObservations({}, fp, "2026-01-01T10:00:00");
  assert.deepEqual(first.changed, Object.keys(fp).sort());
  const same = updateObservations(first.store, fp, "2026-01-01T11:00:00");
  assert.deepEqual(same.changed, []);
  assert.equal(same.store[ieee(0)].firstSeen, "2026-01-01T10:00:00");
  const next = updateObservations(same.store, fp2, "2026-01-01T12:00:00");
  assert.deepEqual(next.changed, [ieee(0)]);
  assert.equal(next.store[ieee(1)].firstSeen, "2026-01-01T10:00:00");
  assert.equal(first.store[ieee(0)].firstSeen, "2026-01-01T10:00:00");   // input store is not modified
  assert.equal(newestChange(next.store), "2026-01-01T12:00:00");
  assert.equal(newestChange({}), null);
});

test("network is plain data: it survives a JSON round trip", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(sample)), sample);
});

test("labels: user name, else Coordinator, else model; duplicates get the address, or the IEEE tail without one", () => {
  const raw = synth([[0, C], [1, R], [2, R], [3, E]]);
  raw[1].model = "RODRET Dimmer"; raw[1].name = "IKEA of Sweden RODRET Dimmer";
  raw[2].model = "RODRET Dimmer"; raw[2].nwk = 0xabc;
  raw[3].model = ""; raw[3].name = "Odd device";
  const n = buildNetwork(raw);
  assert.deepEqual(n.devices.map((d) => [d.label, d.labelKind]), [["Coordinator", "coordinator"],
    ["RODRET Dimmer (0x1001)", "model"], ["RODRET Dimmer (0x0ABC)", "model"], ["Odd device", "model"]]);
  assert.equal(n.devices[1].name, "IKEA of Sweden RODRET Dimmer");
  raw[1].nwk = null; raw[2].nwk = null;
  assert.deepEqual(buildNetwork(raw).devices.slice(1, 3).map((d) => d.label), ["RODRET Dimmer (00:01)", "RODRET Dimmer (00:02)"]);
});

test("an offline start device has an incomplete up path, even with a stale route", () => {
  const n = buildNetwork(synth([[0, C], [1, E, { avail: false }], [2, R, { avail: false, rt: [[0, 0]] }]]));
  assert.deepEqual(upPath(n, ieee(2)), { ids: [ieee(2)], complete: false });
  assert.equal(upPath(n, ieee(1)).complete, false);
});

test("without the coordinator's table nothing is a verdict: hedged parent unknown, no isolated, data incomplete", () => {
  const raw = synth([[0, C], [1, R, { nb: [[0, 100]] }], [2, E], [3, R, { nb: [[1, 100]] }]]);
  const net = buildNetwork(raw);
  const kinds = net.findings.map((f) => [f.kind, f.device, f.missing]);
  assert.deepEqual(kinds.filter((k) => k[0] === "parent unknown"), [["parent unknown", ieee(2), [ieee(0)]]]);
  assert.equal(net.findings.some((f) => f.kind === "isolated"), false);
  assert.deepEqual(kinds.filter((k) => k[0] === "data incomplete"), [["data incomplete", ieee(0), [ieee(0)]]]);
});

// --- Link evidence, capacity, duplicates, partial down paths (spec 3.1, 4.3, 5.1) -----------------------------------
test("sample: pairs by evidence, implied directions, reasons, capacity per model", () => {
  const raw = load("zha-sample.json")["zha/devices"];
  const listedBoth = new Set();
  const listed = new Set(raw.filter((d) => d.available).flatMap((d) => d.neighbors.map((n) => `${d.ieee}|${n.ieee}`)));
  for (const k of listed) { const [a, b] = k.split("|"); if (a < b && listed.has(`${b}|${a}`)) listedBoth.add(k); }
  assert.equal(listedBoth.size, 242);                       // listed by both sides, LQI 0 included
  const state = (p) => [p.ab.state, p.ba.state];
  const measuredBoth = sample.pairs.filter((p) => state(p).every((x) => x === "measured"));
  const measuredOne = sample.pairs.filter((p) => state(p).filter((x) => x === "measured").length === 1);
  assert.equal(measuredBoth.length, 241);                   // one of the 242 has a 0 on one side
  assert.equal(measuredOne.length, 85);
  const implied = sample.pairs.flatMap((p) => [p.ab, p.ba]).filter((x) => x.state === "implied");
  assert.equal(implied.filter((x) => x.source === "parent").length, 12);   // one per end device
  const routeOnly = sample.pairs.filter((p) => state(p).every((x) => x === "implied"));
  assert.equal(routeOnly.length, 2);
  assert.ok(routeOnly.every((p) => p.ab.source === "route"));
  assert.equal(implied.length, 16);
  const reasons = {};
  for (const x of sample.pairs.flatMap((p) => [p.ab, p.ba]).filter((y) => y.state === "unknown")) {
    const k = x.reason.replace(/ \(\d+\/\d+(, vendor estimate)?\)/, "");
    reasons[k] = (reasons[k] || 0) + 1;
  }
  assert.deepEqual(reasons, { "lqi 0": 1, "table full": 46, "table nearly full, link probably weak": 19,
    "table has space, link probably weak or aged out": 7 });   // with the vendor fallback no capacity stays unknown
  const estimates = sample.pairs.flatMap((p) => [p.ab, p.ba]).filter((x) => /vendor estimate/.test(x.reason || ""));
  assert.ok(estimates.length > 0);
  const cap = (vendor, model) => sample.devices.find((d) => d.vendor === vendor && d.model === model && d.tableCapacity !== null);
  assert.equal(cap("IKEA of Sweden", "TRADFRIbulbGU10WS345lm").tableCapacity, 16);
  assert.equal(cap("Signify Netherlands B.V.", "LTG002").tableCapacity, 26);
  const lct = sample.devices.find((d) => d.model === "LCT012");        // one device of its model: vendor estimate
  assert.deepEqual([lct.tableCapacity, lct.tableCapacitySource], [26, "vendor"]);
  assert.equal(cap("IKEA of Sweden", "TRADFRIbulbGU10WS345lm").tableCapacitySource, "model");
  assert.equal(sample.unresolved.duplicates, 1);
  assert.ok(sample.readings.some((r) => r.lqi === 0 && r.measured === false));
  assert.ok(sample.readings.every((r) => r.measured === (r.lqi > 0)));
  assert.ok(sample.pairs.every((p) => p.a < p.b));
});

test("capacity per model: largest router-entry count of the same vendor and model, two devices needed", () => {
  const specs = [[0, C, { nb: [[1, 100], [2, 100]] }]];
  specs.push([1, R, { model: "X", nb: [[0, 100], [2, 100], [3, 100]] }]);   // 3 router entries
  specs.push([2, R, { model: "X", nb: [[0, 100]] }]);                        // 1
  specs.push([3, R, { model: "Y", nb: [[0, 100]] }]);                        // alone: unknown
  specs.push([4, E, { model: "X" }]);
  const n = buildNetwork(synth(specs));
  const d = (k) => n.devices.find((x) => x.id === ieee(k));
  assert.deepEqual([d(1).tableSize, d(1).tableCapacity, d(1).tableFull], [3, 3, true]);
  assert.deepEqual([d(2).tableSize, d(2).tableCapacity, d(2).tableFull], [1, 3, false]);
  assert.deepEqual([d(3).tableSize, d(3).tableCapacity, d(3).tableCapacitySource, d(3).tableFull], [1, 3, "vendor", false]);
  assert.equal(d(1).tableCapacitySource, "model");
  assert.deepEqual([d(4).tableSize, d(4).tableCapacity, d(4).tableFull], [null, null, null]);
});

test("pairs: measured, implied by parent or route, LQI 0 is no pair, missing table as reason", () => {
  const n = buildNetwork(synth([
    [0, C, { nb: [[1, 120], [5, 90, "Child"], [2, 80]] }],
    [1, R, { nb: [[0, 110], [20, 100]] }],
    [2, R, { nb: [[0, 100]] }],
    [5, E],
    [6, R, { nb: [[7, 0]] }],                     // LQI 0 only
    [7, R],
    [20, R],                                      // router without a table
  ]));
  const pair = (a, b) => n.pairs.find((p) => p.a === ieee(a) && p.b === ieee(b));
  assert.deepEqual([pair(0, 1).ab.state, pair(0, 1).ba.lqi, pair(0, 1).ab.reason], ["measured", 110, null]);
  const child = pair(0, 5);
  assert.deepEqual([child.ab.state, child.ba.state, child.ba.source], ["measured", "implied", "parent"]);
  assert.equal(pair(6, 7), undefined);            // only LQI 0: not a pair
  assert.equal(n.readings.find((r) => r.reporter === ieee(6)).measured, false);
  assert.equal(pair(1, 20).ba.reason, "table missing or stale");
  const lqi0 = buildNetwork(synth([[0, C, { nb: [[1, 100]] }], [1, R, { nb: [[0, 0]] }]]));
  assert.deepEqual([lqi0.pairs[0].ba.state, lqi0.pairs[0].ba.reason, lqi0.pairs[0].ba.lqi], ["unknown", "lqi 0", 0]);
});

test("pairs: an active route proves both directions where nothing is listed", () => {
  const n = buildNetwork(synth([[0, C, { rt: [[3, 1]] }], [1, R, { rt: [[3, 3]] }], [3, R]]));
  const p = n.pairs.find((x) => x.a === ieee(0) && x.b === ieee(1));
  assert.deepEqual([p.ab.state, p.ab.source, p.ba.state, p.ba.source], ["implied", "route", "implied", "route"]);
  assert.equal(n.pairs.length, 2);   // the direct route 1 -> 3 proves the pair 1|3 as well
});

test("pair reasons: table full, nearly full, space, end device", () => {
  const routers = (k) => Array.from({ length: k }, (_, i) => [10 + i, 100]);
  const specs = [[0, C, { nb: [[1, 100], [2, 100], [3, 100]] }],
    [1, R, { model: "X", nb: routers(4) }], [2, R, { model: "X", nb: routers(2) }], [3, R, { model: "X", nb: routers(1) }],
    [4, E]];
  for (let i = 0; i < 4; i += 1) specs.push([10 + i, R]);
  const n = buildNetwork(synth(specs));
  const reason = (k) => n.pairs.find((p) => p.a === ieee(0) && p.b === ieee(k)).ba.reason;
  assert.equal(reason(1), "table full (4/4)");
  assert.equal(reason(2), "table nearly full (2/4), link probably weak");
  assert.equal(reason(3), "table has space, link probably weak or aged out");
  const ed = buildNetwork(synth([[0, C, { nb: [[4, 90, "Child"]] }], [4, E]])).pairs[0];
  assert.equal(ed.ba.state, "implied");
  const noParent = buildNetwork(synth([[0, C, { nb: [[4, 90]] }], [4, E]])).pairs[0];
  assert.deepEqual([noParent.ba.state, noParent.ba.reason], ["unknown", "end device (no table)"]);
});

test("downPath to an end device appends it only when the path to the parent is complete", () => {
  const raw = synth([
    [0, C, { nb: [[1, 100], [3, 100]], rt: [[2, 1]] }],
    [1, R, { nb: [[2, 90, "Child"]] }],                       // no route entries towards 3 or 4 at router 1
    [2, R],
    [3, R, { nb: [[4, 90, "Child"]] }],
    [4, E],
  ]);
  const n = buildNetwork(raw);
  // 4's parent 3 is a direct neighbour of the coordinator without a routing entry: the path stays partial
  assert.deepEqual(downPath(n, ieee(4)), { ids: [ieee(0)], complete: false });
  const ok = buildNetwork(synth([[0, C, { nb: [[1, 100]], rt: [[1, 1]] }], [1, R, { nb: [[2, 90, "Child"]] }], [2, E]]));
  assert.deepEqual(downPath(ok, ieee(2)), { ids: [ieee(0), ieee(1), ieee(2)], complete: true });
});

test("duplicate readings: the higher LQI is kept and the duplicate is counted", () => {
  const raw = synth([[0, C, { nb: [[1, 100], [1, 120], [1, 90]] }], [1, R]]);
  const n = buildNetwork(raw);
  assert.equal(n.readings.length, 1);
  assert.equal(n.readings[0].lqi, 120);
  assert.equal(n.unresolved.duplicates, 2);
});

test("capacity without a peer of the model or the vendor stays unknown; a vendor estimate is named in the reason", () => {
  const alone = buildNetwork(synth([[0, C, { nb: [[1, 100]] }], [1, R, { vendor: "W", model: "Z", nb: [[2, 100]] }], [2, R]]));
  const w = alone.devices.find((d) => d.id === ieee(1));
  assert.deepEqual([w.tableCapacity, w.tableCapacitySource, w.tableFull], [null, null, null]);
  assert.equal(alone.pairs.find((p) => p.a === ieee(0) && p.b === ieee(1)).ba.reason, "capacity unknown");
  // two models of one vendor: the single-device model borrows the largest table of the vendor
  const routers = (k) => Array.from({ length: k }, (_, i) => [10 + i, 100]);
  const specs = [[0, C, { nb: [[1, 100], [2, 100], [3, 100]] }],
    [1, R, { model: "A", nb: routers(4) }], [2, R, { model: "A", nb: routers(2) }],
    [3, R, { model: "B", nb: routers(4) }]];
  for (let i = 0; i < 4; i += 1) specs.push([10 + i, R]);
  const n = buildNetwork(synth(specs));
  const reason = (k) => n.pairs.find((p) => p.a === ieee(0) && p.b === ieee(k)).ba.reason;
  assert.equal(reason(1), "table full (4/4)");
  assert.equal(reason(3), "table full (4/4, vendor estimate)");
  assert.equal(n.devices.find((d) => d.id === ieee(3)).tableCapacitySource, "vendor");
});
