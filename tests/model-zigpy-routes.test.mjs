// SPDX-License-Identifier: MIT
// The source-route stage "read from zigpy" (spec 5.1; brief a4w): parsing the command's answer, the strict gate a
// route record passes before it is drawn as measured, that it only fills gaps (never replaces a complete measured down
// path, and says so when it differs), the assumption for the rest, lanes, Details, the status line, and the one call per
// data load. node --test tests/
import test from "node:test";
import assert from "node:assert/strict";
import { responses, sampleNetwork } from "./panel-fixture.mjs";
import { fakeZigpyRoutes } from "./zigpy-fake.mjs";
import { buildNetwork, downPath, upPath, nodePaths } from "../custom_components/meshroute_topology_explorer/frontend/model/index.js";
import { assumedDownPaths, downPathWith, returnPaths, sourceRouteSummary, zigpyRecords }
  from "../custom_components/meshroute_topology_explorer/frontend/model/source-routes.js";
import { parseZigpyRoutes, readZigpyRoutes } from "../custom_components/meshroute_topology_explorer/frontend/adapters/zha.js";
import { readNetwork } from "../custom_components/meshroute_topology_explorer/frontend/ui/controller.js";
import { classifyLanes, laneClass } from "../custom_components/meshroute_topology_explorer/frontend/engines/zigbee/lanes.js";
import { detailsOf, pathParts } from "../custom_components/meshroute_topology_explorer/frontend/ui/details.js";
import { sourceRoutePart } from "../custom_components/meshroute_topology_explorer/frontend/engines/zigbee/status.js";
import { translator } from "../custom_components/meshroute_topology_explorer/frontend/ui/i18n.js";

const en = translator("en");
const answer = fakeZigpyRoutes(responses["zha/devices"]);

/** The sample with zigpy's answer attached, as readNetwork does. */
function withZigpy(z = parseZigpyRoutes(answer)) {
  const n = sampleNetwork();
  n.zigpy = z;
  return n;
}

test("on the sample: 6 return paths from route records, the 2 broken records assumed, measured ones untouched", () => {
  const n = withZigpy();
  const { paths, differs } = zigpyRecords(n);
  const assumed = assumedDownPaths(n);
  const broken = [answer.broken.unnamed, answer.broken.moved];
  assert.ok(broken.every(Boolean));
  assert.deepEqual([...paths.keys()].sort(), [...assumed.keys()].filter((id) => !broken.includes(id)).sort());
  for (const [id, p] of paths) {
    assert.deepEqual(p.ids, [...upPath(n, id).ids].reverse(), "a route record is the way up, reversed");
    assert.equal(p.recorded, true);
    assert.equal(p.assumed, undefined);
  }
  const others = n.devices.filter((d) => d.role !== "coordinator");
  const complete = (mode) => others.filter((d) => downPathWith(n, d.id, mode).complete).length;
  assert.deepEqual([complete("off"), complete("assume"), complete("zigpy")], [33, 41, 41]);
  // Never over a complete measured down path: those stay as measured, and a record that differs is only named.
  for (const d of others) {
    const measured = downPath(n, d.id);
    if (measured.complete) assert.deepEqual(downPathWith(n, d.id, "zigpy").ids, measured.ids);
  }
  const expectDiffers = others.filter((d) => downPath(n, d.id).complete && upPath(n, d.id).complete
    && downPath(n, d.id).ids.join() !== [...upPath(n, d.id).ids].reverse().join()).map((d) => d.id).sort();
  assert.deepEqual([...differs.keys()].sort(), expectDiffers);
  assert.ok(differs.size > 0);
  assert.deepEqual(sourceRouteSummary(n, "zigpy"),
    { mode: "zigpy", count: 2, recorded: 6, zigpy: { status: "ok", reason: null, radio: "zigpy_znp" } });
  assert.deepEqual(sourceRouteSummary(n, "assume"), { mode: "assume", count: 8, recorded: 0, zigpy: null });
});

test("zigpy not readable: the stage assumes like 'assume' and says why", () => {
  const n = withZigpy({ status: "not_supported", reason: "zha_not_loaded", message: "zha_not_loaded: ZHA is not loaded" });
  assert.equal(zigpyRecords(n).paths.size, 0);
  assert.deepEqual([...returnPaths(n, "zigpy").keys()].sort(), [...assumedDownPaths(n).keys()].sort());
  assert.deepEqual(sourceRouteSummary(n, "zigpy").zigpy, { status: "not_supported", reason: "zha_not_loaded", radio: null });
  const bare = sampleNetwork(); // a network read before the stage existed has no zigpy field
  assert.equal(sourceRouteSummary(bare, "zigpy").zigpy.status, "missing");
  assert.equal(sourceRouteSummary(bare, "zigpy").count, 8);
});

test("the gate, step by step on a small network", () => {
  const ieee = (k) => `00:11:22:33:44:55:66:${k.toString(16).padStart(2, "0")}`;
  const dev = (k, type, extra = {}) => ({ ieee: ieee(k), nwk: k, device_type: type, available: true, model: `M${k}`,
    neighbors: [], routes: [], ...extra });
  const nb = (k, type) => ({ ieee: ieee(k), nwk: `0x${k.toString(16).padStart(4, "0")}`, lqi: "200", device_type: type,
    relationship: "Sibling" });
  const route = (dest, next) => ({ dest_nwk: `0x${dest.toString(16).padStart(4, "0")}`,
    next_hop: `0x${next.toString(16).padStart(4, "0")}`, route_status: "Active" });
  // 0 coordinator; 1 and 5 routers next to it; 2 behind 1 (its up path unknown: no route at 1); 3 with an entry at 0;
  // 4 behind 2; 6 unavailable; 7 heard by nobody.
  const raw = [
    dev(0, "Coordinator", { neighbors: [nb(1, "Router"), nb(3, "Router"), nb(5, "Router")], routes: [route(3, 1)] }),
    dev(1, "Router", { neighbors: [nb(0, "Coordinator"), nb(2, "Router"), nb(6, "Router")] }),
    dev(2, "Router", { neighbors: [nb(1, "Router"), nb(4, "Router")] }),
    dev(3, "Router", { neighbors: [nb(0, "Coordinator"), nb(1, "Router")] }),
    dev(4, "Router", { neighbors: [nb(2, "Router")] }),
    dev(5, "Router", { neighbors: [nb(0, "Coordinator")] }),
    dev(6, "Router", { available: false, neighbors: [nb(1, "Router")] }),
    dev(7, "Router"),
  ];
  const rec = (k, relays, nwk = k) => ({ ieee: ieee(k), nwk, relays: relays.map((r) => ({ nwk: r, ieee: ieee(r) })) });
  const n = buildNetwork(raw);
  n.zigpy = parseZigpyRoutes({ radio: "bellows", devices: [
    rec(2, [1]), // good: no up path from the tables, so no assumption either; the record closes the gap
    rec(4, [2, 1]), // good, two relays
    rec(5, []), // good: a direct neighbour
    rec(3, [1]), // the coordinator holds an entry for 3: the gap is elsewhere, unknown stays
    rec(1, [6]), // relay unavailable
    { ieee: ieee(7), nwk: 7, relays: [{ nwk: 0x99, ieee: null }] }, // relay zigpy could not name
  ] });
  const { paths } = zigpyRecords(n);
  assert.deepEqual(paths.get(ieee(2)).ids, [ieee(0), ieee(1), ieee(2)]);
  assert.deepEqual(paths.get(ieee(4)).ids, [ieee(0), ieee(1), ieee(2), ieee(4)], "relays are listed from the device's side");
  assert.deepEqual(paths.get(ieee(5)).ids, [ieee(0), ieee(5)]);
  for (const k of [3, 1, 7]) assert.ok(!paths.has(ieee(k)), `device ${k}`);

  const variant = (records) => {
    const m = buildNetwork(raw);
    m.zigpy = parseZigpyRoutes({ devices: records });
    return zigpyRecords(m).paths;
  };
  assert.equal(variant([rec(2, [1], 0x42)]).size, 0, "the device's own address changed since the record (a rejoin)");
  assert.equal(variant([{ ...rec(4, [2, 1]), relays: [{ nwk: 0x77, ieee: ieee(2) }, { nwk: 1, ieee: ieee(1) }] }]).size, 0,
    "a relay that holds another address now");
  assert.equal(variant([rec(4, [2, 1, 2])]).size, 0, "a loop");
  assert.equal(variant([rec(4, [1])]).size, 0, "a hop without a pair in the model (1 and 4 never heard each other)");
  assert.equal(variant([rec(2, [4, 2])]).size, 0, "the device itself among its relays");
  assert.equal(variant([rec(4, [2, 0])]).size, 0, "the coordinator among the relays");
});

test("node view and lanes: a recorded return path is measured, not assumed; under 'assume' nothing changes", () => {
  const n = withZigpy();
  const id = [...zigpyRecords(n).paths.keys()][0];
  const down = (mode) => nodePaths(n, id, "coordinator", { sourceRoute: mode }).find((p) => p.kind === "down");
  assert.equal(down("zigpy").recorded, true);
  assert.equal(down("zigpy").assumed, false);
  assert.ok(down("zigpy").hops.every((h) => !h.assumed));
  assert.equal(down("assume").assumed, true);
  assert.equal(down("assume").recorded, undefined);
  assert.equal(down("off").complete, false);
  const { lanes } = classifyLanes(n);
  const recorded = lanes.filter((l) => l.downRecorded);
  assert.ok(recorded.length > 0);
  for (const l of recorded) {
    assert.equal(laneClass(l, "zigpy"), "down");
    if (!l.up && !l.downMeasured && !l.downAssumed && !l.route) assert.notEqual(laneClass(l, "assume"), "down");
  }
  // Under "zigpy", the lanes of the two broken records are still drawn, as assumed.
  assert.ok(lanes.some((l) => l.downZigpyAssumed && !l.downRecorded && !l.downMeasured));
  assert.equal(lanes.filter((l) => l.downZigpyAssumed).length < lanes.filter((l) => l.downAssumed).length, true);
});

test("Details: 'measured (route record, age unknown)', the radio library, and a differing record as one line", () => {
  const n = withZigpy();
  const name = (x) => (n.devices.find((d) => d.id === x) || { label: x }).label;
  const id = [...zigpyRecords(n).paths.keys()][0];
  const info = detailsOf(n, id, "coordinator", { sourceRoute: "zigpy" });
  const back = info.paths.find((p) => p.kind === "down");
  assert.equal(pathParts(back, en, name).prefix, "back, measured (route record, age unknown)");
  assert.deepEqual(info.record, { radio: "zigpy_znp", differs: null });
  assert.match(en("details.paths_recorded_note", { radio: "zigpy_znp" }), /radio library zigpy_znp\). zigpy keeps no time/);
  const [other, ids] = [...zigpyRecords(n).differs][0];
  const differing = detailsOf(n, other, "coordinator", { sourceRoute: "zigpy" });
  assert.deepEqual(differing.record.differs, ids.slice(1, -1));
  assert.equal(en("details.path_record_differs", { via: "Router 01 → Router 02" }), "Route record differs: via Router 01 → Router 02");
  assert.equal(en("details.path_record_differs_direct"), "Route record differs: direct, without a relay");
  assert.equal(detailsOf(n, other, "coordinator", { sourceRoute: "assume" }).record, null);
});

test("status line: recorded and assumed counts, and why zigpy could not be read", () => {
  const ok = sourceRoutePart({ mode: "zigpy", count: 2, recorded: 6, zigpy: { status: "ok" } });
  assert.equal(en(ok[0], ok[1]), "Source route from zigpy · 6 recorded, 2 assumed");
  const short = sourceRoutePart({ mode: "zigpy", count: 2, recorded: 6, zigpy: { status: "ok" } }, true);
  assert.equal(en(short[0], short[1]), "6 recorded · 2 assumed");
  assert.equal(short[2], "status.sr_zigpy");
  const failed = sourceRoutePart({ mode: "zigpy", count: 8, recorded: 0, zigpy: { status: "not_supported", reason: "no_gateway" } });
  assert.equal(en(failed[0], failed[1]), "zigpy not available · 8 assumed");
  assert.equal(en(failed[2], failed[1]), "ZHA has no running gateway; return paths are assumed.");
  const odd = sourceRoutePart({ mode: "zigpy", count: 8, recorded: 0, zigpy: { status: "not_supported", reason: "timeout" } });
  assert.equal(en(odd[2], odd[1]), "zigpy's route records could not be read (timeout); return paths are assumed.");
  const compact = sourceRoutePart({ mode: "zigpy", count: 8, zigpy: { status: "missing" } }, true);
  assert.equal(en(compact[0], compact[1]), "zigpy not available");
  assert.equal(sourceRoutePart({ mode: "zigpy", count: 0, recorded: 0, zigpy: { status: "ok" } }), null);
  for (const key of ["zha_not_loaded", "no_gateway", "internals_changed", "error", "unknown_command"]) {
    assert.notEqual(en(`status.zigpy_reason_${key}`), `status.zigpy_reason_${key}`, key);
  }
});

test("parsing the answer: only well-formed records, addresses as numbers, IEEE in colon form", () => {
  const z = parseZigpyRoutes({ radio: "zigpy_znp", devices: [
    { ieee: "00:11:22:33:44:55:66:77", nwk: 0x1234, relays: [{ nwk: 0x10, ieee: "00:11:22:33:44:55:66:88" }] },
    { ieee: "00:11:22:33:44:55:66:99", nwk: 0x10000, relays: [] }, // not a 16-bit address
    { ieee: "nonsense", nwk: 1, relays: [] },
    { ieee: "00:11:22:33:44:55:66:aa", nwk: 2, relays: "0x10" },
    { ieee: "00:11:22:33:44:55:66:bb", nwk: 3, relays: [{ nwk: "x" }] },
    { ieee: "00:11:22:33:44:55:66:CC", nwk: "0x0004", relays: [{ nwk: 5, ieee: null }] },
    null,
  ] });
  assert.equal(z.status, "ok");
  assert.equal(z.radio, "zigpy_znp");
  assert.deepEqual([...z.records.keys()], ["00:11:22:33:44:55:66:77", "00:11:22:33:44:55:66:cc"]);
  assert.deepEqual(z.records.get("00:11:22:33:44:55:66:cc"), { nwk: 4, relays: [{ nwk: 5, ieee: null }] });
  assert.deepEqual(parseZigpyRoutes(null), { status: "ok", radio: null, records: new Map() });
});

test("reading: one command, its errors become a reason, a lost connection is passed on", async () => {
  const hass = (reply) => ({ callWS: async (msg) => { hass.sent.push(msg); return reply(); } });
  hass.sent = [];
  const z = await readZigpyRoutes(hass(() => answer));
  assert.deepEqual(hass.sent, [{ type: "meshroute_topology_explorer/zigpy_routes" }]);
  assert.equal(z.records.size, answer.devices.length);
  const fail = (err) => readZigpyRoutes({ callWS: async () => { throw err; } });
  assert.deepEqual(await fail({ code: "not_supported", message: "internals_changed: the gateway has no application_controller" }),
    { status: "not_supported", reason: "internals_changed", message: "internals_changed: the gateway has no application_controller" });
  assert.equal((await fail({ code: "unknown_command", message: "Unknown command." })).reason, "unknown_command");
  assert.equal((await fail(new Error("boom"))).reason, "error");
  await assert.rejects(fail({ type: "result", success: false, error: { code: 3 } }));
});

test("one call per data load: readNetwork attaches zigpy's answer, and a failure never fails the load", async () => {
  const calls = [];
  const fakeHass = (zigpy) => ({
    user: { is_admin: true },
    callWS: async (msg) => {
      calls.push(msg.type);
      if (msg.type === "meshroute_topology_explorer/zigpy_routes") return zigpy();
      return responses[msg.type];
    },
  });
  const ready = await readNetwork(fakeHass(() => answer));
  assert.equal(ready.phase, "ready");
  assert.equal(ready.network.zigpy.status, "ok");
  assert.equal(calls.filter((c) => c === "meshroute_topology_explorer/zigpy_routes").length, 1);
  const failed = await readNetwork(fakeHass(() => { throw { code: "not_supported", message: "zha_not_loaded: ZHA is not loaded" }; }));
  assert.equal(failed.phase, "ready");
  assert.deepEqual([failed.network.zigpy.status, failed.network.zigpy.reason], ["not_supported", "zha_not_loaded"]);
  const lost = await readNetwork(fakeHass(() => { throw { code: 3 }; }));
  assert.equal(lost.phase, "disconnected");
});
