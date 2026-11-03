// SPDX-License-Identifier: MIT
// Path history (spec 5.8): decoding of history/records, the network rebuilt per snapshot, the walks there and back,
// weakest hop by rank, route spans, lane series and Thread values. Round trip: capture -> record -> rebuilt network ->
// walk equals the walk on the live network. Uses only the committed sample (tests/fixtures). npm test
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeRecords, laneSeries } from "../custom_components/meshroute_topology_explorer/frontend/engines/history-records.js";
import { createHistory, createHistoryCache, hopContext, liveContext, rebuildNetwork, routeSpans, walkOnNetwork, weakestHop }
  from "../custom_components/meshroute_topology_explorer/frontend/engines/zigbee/history.js";
import { tableWalk } from "../custom_components/meshroute_topology_explorer/frontend/engines/zigbee/paths.js";
import { pathHops } from "../custom_components/meshroute_topology_explorer/frontend/engines/zigbee/node-paths.js";
import { between, snapshotOfRaw, series, toResponse } from "../tools/history_synth.mjs";

const read = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8"));
const zha = read("zha-sample.json").responses;
const live = { rawDevices: zha["zha/devices"], deviceRegistry: zha["config/device_registry/list"],
  areaRegistry: zha["config/area_registry/list"], configEntries: zha["config_entries/get"] };
const fixture = read("zha-history-sample.json");
const ctx = liveContext(live);
const ids = ctx.network.devices.map((d) => d.id);
const coordinator = ctx.network.devices.find((d) => d.role === "coordinator").id;
const ranked = (w) => [w.ids, w.complete, w.hops.map((h) => [h.sender, h.hearer, h.how, h.state, h.rankPct])];

test("decode: keys resolved, time-only records share the table, {k} lines extend, bad rows dropped, order by time", () => {
  const s = decodeRecords({ k: ["a", "b"], records: [
    { t: 200 }, // before any full record: empty
    { t: 300, e: [[0, 1, 90, -60], [1, 0, 80], [0, 7, 5]], r: [[0, 1, 1, "Active"]] },
    { t: 400 }, { k: ["c"] }, { t: 100, e: [[2, 0, null]] }, { t: "x" }] });
  assert.deepEqual(s.map((x) => x.t), [100, 200, 300, 400]);
  assert.deepEqual(s[0].table.e, [["c", "a", null, null]]);
  assert.ok(s[1].empty && !s[2].empty);
  assert.deepEqual(s[2].table.e, [["a", "b", 90, -60], ["b", "a", 80, null]]);
  assert.equal(s[3].table, s[2].table);
  assert.deepEqual(s.map((x) => x.index), [0, 1, 2, 3]);
});

test("round trip: capture -> record -> rebuilt network -> every walk equals the walk on the live network", () => {
  const snap = snapshotOfRaw(live.rawDevices);
  const table = decodeRecords(toResponse([{ t: 1, snap }]))[0].table;
  const net = rebuildNetwork(ctx, table);
  assert.equal(net.devices.filter((d) => d.placeholder).length, 0);
  let compared = 0;
  for (const a of ids) for (const b of ids) {
    if (a === b) continue;
    const w = tableWalk(ctx.network, a, b);
    const hp = pathHops(ctx.network, w.ids);
    const want = [w.ids, w.complete, w.hops.map((h, i) => [h.sender, h.hearer, h.how, hp[i].state,
      hp[i].state === "measured" && typeof hp[i].rating === "number" ? Math.round(hp[i].rating * 100) : null])];
    assert.deepEqual(ranked(walkOnNetwork(net, table, a, b)), want, `${a} > ${b}`);
    compared += 1;
  }
  assert.ok(compared > 1500);
});

test("rebuild: unknown device -> placeholder; live device without tables -> table not read; tables make it available", () => {
  const [a, b] = ids.filter((i) => i !== coordinator);
  const ghost = "aa:bb:cc:dd:ee:ff:00:11";
  const table = { e: [[coordinator, ghost, 120, null], [ghost, coordinator, 100, null]], r: [], l: [] };
  const net = rebuildNetwork(ctx, table);
  const p = net.devices.find((d) => d.id === ghost);
  assert.ok(p.placeholder && p.role === "unknown" && p.nwk === null);
  assert.equal(net.devices.length, ids.length + 1);
  const w = walkOnNetwork(net, table, a, b);
  assert.equal(w.complete, false);
  assert.equal(w.reason, "table not read");
  assert.equal(net.devices.find((d) => d.id === coordinator).available, true);
});

test("weakest hop: by rank, never by LQI; hops without a rank never; ties go to the first", () => {
  const hop = (rankPct, lqi) => ({ rankPct, lqi });
  assert.equal(weakestHop([hop(60, 30), hop(20, 250), hop(45, 10)]), 1);
  assert.equal(weakestHop([hop(null, 5), hop(70, 200), hop(null, null)]), 1);
  assert.equal(weakestHop([hop(null, 5), hop(null, null)]), null);
  assert.equal(weakestHop([hop(40, 1), hop(40, 2)]), 0);
  assert.equal(weakestHop([]), null);
});

const history = createHistory({ response: fixture, live });

test("timeline: a walk there and back per record, stopped routes say why, children are never ranked", () => {
  const children = ctx.network.devices.filter((d) => d.role === "end device" && d.parent && d.available).map((d) => d.id);
  const child = children.find((c) => history.timeline(coordinator, c).points[0].there.complete);
  const tl = history.timeline(coordinator, child);
  assert.equal(tl.points.length, fixture.records.length);
  const first = tl.points[0];
  assert.equal(first.there.complete, true);
  assert.equal(first.there.hops.at(-1).how, "child");
  assert.equal(first.there.hops.at(-1).rankPct, null);
  assert.notEqual(first.there.weakest, first.there.hops.length - 1);
  assert.equal(first.back.hops[0].how, "parent");
  assert.equal(history.timeline(coordinator, child), tl, "cached per pair");
  for (const p of tl.points) for (const w of [p.there, p.back]) assert.ok(w.complete || typeof w.reason === "string");
});

test("light timeline equals the full engine build on every record, for many pairs", () => {
  let n = 0;
  for (const a of ids.slice(0, 12)) for (const b of ids) {
    if (a === b) continue;
    const tl = history.timeline(a, b);
    for (const p of tl.points) {
      const full = history.walkAt(a, b, p.index);
      assert.deepEqual(ranked(p.there), ranked(full.there), `${a} > ${b} at ${p.index}`);
      assert.deepEqual(ranked(p.back), ranked(full.back));
      assert.equal(p.there.weakest, full.there.weakest);
      n += 1;
    }
  }
  assert.ok(n > 500);
});

test("spans: consecutive equal routes group, counts add up, a route change starts a new span", () => {
  const find = ids.flatMap((a) => ids.filter((b) => a < b).map((b) => [a, b])).find(([a, b]) => history.timeline(a, b).spans.length > 1);
  assert.ok(find, "the fixture changes at least one route");
  const tl = history.timeline(...find);
  assert.equal(tl.spans.reduce((n, s) => n + s.count, 0), tl.points.length);
  for (let i = 1; i < tl.spans.length; i++) {
    assert.equal(tl.spans[i].firstIndex, tl.spans[i - 1].lastIndex + 1);
    assert.notDeepEqual([tl.spans[i].there.ids, tl.spans[i].there.reason, tl.spans[i].back.ids, tl.spans[i].back.reason],
      [tl.spans[i - 1].there.ids, tl.spans[i - 1].there.reason, tl.spans[i - 1].back.ids, tl.spans[i - 1].back.reason]);
  }
  const s = tl.spans[0];
  assert.equal(s.there.ranks.length, s.there.hops.length);
});

test("spans: rank statistics over the span and the weakest hop by mean rank", () => {
  const w = (r) => ({ ids: ["a", "b", "c"], complete: true, reason: null, hops: [{ sender: "a", hearer: "b", rankPct: r[0] },
    { sender: "b", hearer: "c", rankPct: r[1] }] });
  const pts = [[80, 30], [60, 50], [70, 10]].map((r, i) => ({ t: i, index: i, there: w(r), back: w([null, null]) }));
  const [s] = routeSpans(pts);
  assert.deepEqual(s.there.ranks[1], { min: 10, mean: 30, max: 50 });
  assert.deepEqual(s.there.weakest, { sender: "b", hearer: "c", min: 10, mean: 30, max: 50 });
  assert.equal(s.back.weakest, null);
});

const snaps = (rows) => decodeRecords({ k: ["a", "b"], records: rows });
test("lane series: both directions, null where a record lacks the entry, first appearance, centred and last windows", () => {
  const H = 3600;
  const rows = [{ t: 0, e: [[0, 1, 50]] }, { t: 10 * H, e: [[0, 1, 60, -70], [1, 0, 40]] }, { t: 60 * H, e: [[1, 0, 45]] },
    { t: 120 * H, e: [[0, 1, 70], [1, 0, 41]] }, { t: 200 * H }];
  const s = snaps(rows);
  const c = laneSeries(s, "a", "b", { center: 50 * H });
  assert.deepEqual(c.aHearsB, [[10 * H, 60, -70], [60 * H, null]]);
  assert.deepEqual(c.bHearsA, [[10 * H, 40], [60 * H, 45]]);
  assert.equal(c.from, 2 * H);
  assert.deepEqual(c.firstSeen, { aHearsB: 0, bHearsA: 10 * H });
  const last = laneSeries(s, "a", "b", { last: true });
  assert.deepEqual(last.aHearsB.map((p) => p[0]), [200 * H].filter((t) => t >= 200 * H - 48 * H));
  assert.deepEqual(last.aHearsB, [[200 * H, 70]]);
  assert.equal(laneSeries(s, "a", "b", { from: 0, to: 10 * H }).aHearsB.length, 2);
  assert.deepEqual(laneSeries(snaps([]), "a", "b").aHearsB, []);
});

test("lane context and ghost: a hop opens its lane with the route it came from", () => {
  const a = coordinator;
  const b = ids.find((i) => ctx.byId.get(i).role === "router" && i !== a);
  const tl = history.timeline(a, b);
  const p = tl.points.find((x) => x.back.hops.length);
  const c = hopContext(tl, "back", p, 0, true);
  assert.deepEqual([c.direction, c.t, c.hopIndex, c.hopCount, c.ghost], ["back", p.t, 0, p.back.hops.length, true]);
  assert.equal(c.sender, p.back.hops[0].sender);
  const lane = history.lane(c.hearer, c.sender, { center: c.t }, c);
  assert.equal(lane.context, c);
  assert.equal(lane.a, c.hearer);
  assert.equal(history.device(c.sender).id, c.sender);
  assert.equal(history.device("zz").placeholder, true);
});

test("Thread: lane values per direction (LQI and RSSI) per record, no walks", () => {
  const th = createHistory({ engine: "thread", response: { k: ["x", "y"], records: [
    { t: 1, e: [[0, 1, 3, -60], [1, 0, 2, -72]] }, { t: 2 }, { t: 3, e: [[0, 1, 1, -90]] }] } });
  const tl = th.timeline("x", "y");
  assert.deepEqual(tl.points.map((p) => [p.aHearsB, p.bHearsA]), [[[3, -60], [2, -72]], [[3, -60], [2, -72]], [[1, -90], null]]);
  assert.deepEqual(tl.spans, []);
  assert.equal(tl.points[0].there, undefined);
  assert.deepEqual(th.lane("x", "y", { from: 0, to: 9 }).bHearsA, [[1, 2, -72], [2, 2, -72], [3, null]]);
});

test("cache: one history per network and range", () => {
  const c = createHistoryCache();
  c.set("zha", "7d", history);
  assert.equal(c.get("zha", "7d"), history);
  assert.equal(c.get("zha", "48h"), undefined);
  c.clear("zha");
  assert.equal(c.get("zha", "7d"), undefined);
});

test("performance: 90 days at one record per 4 h (541 changed snapshots) give a pair timeline in about a second", () => {
  const a = snapshotOfRaw(live.rawDevices);
  const b = snapshotOfRaw(live.rawDevices);
  const list = series(a, b, { start: 0, step: 4 * 3600, count: 541 }).map((x, i) => (i % 540 === 0 ? x : { t: x.t, snap: between(a, b, 0.5, i) }));
  const h = createHistory({ response: toResponse(list), live });
  assert.equal(h.snapshots.length, 541);
  const [x, y] = [coordinator, ids[ids.length - 1]];
  // CPU time of this process, not wall time: the full suite runs files in parallel, and wall time then
  // measured the machine's load (failed once at a 3 s bound while running alone took 1.75 s). CPU time
  // includes GC threads (about 2.3–2.7 s here), so the bound is 6 s: a guard against regressions, not a target.
  const c0 = process.cpuUsage();
  const tl = h.timeline(x, y);
  const cpu = process.cpuUsage(c0);
  const ms = (cpu.user + cpu.system) / 1000;
  assert.equal(tl.points.length, 541);
  assert.ok(ms < 6000, `${ms.toFixed(0)} ms CPU`);
  console.log(`# pair timeline, 541 snapshots: ${ms.toFixed(0)} ms CPU`);
});

/** A one-record response from the fixture's first record with `p` replaced (or removed with null). */
function withParents(p) {
  const k = [...fixture.k];
  const at = (key) => { if (!k.includes(key)) k.push(key); return k.indexOf(key); };
  const rec = { ...fixture.records[0] };
  delete rec.p;
  if (p) rec.p = p.map(([c, q]) => [at(c), at(q)]);
  return { k, records: [{ ...rec, t: 1 }, { ...rec, t: 2, p: p ? p.map(([c, q]) => [at(c), at(q)]) : undefined }] };
}
const child = ids.find((i) => ctx.byId.get(i).role === "end device" && ctx.byId.get(i).parent
  && ctx.byId.get(ctx.byId.get(i).parent).available);
const parentOf = ctx.byId.get(child).parent;
const others = ids.filter((i) => ctx.byId.get(i).role === "router" && i !== parentOf && ctx.byId.get(i).available);

test("parents from p: a parent move between two records changes the walk", () => {
  const moved = others[0];
  const base = withParents([[child, parentOf]]);
  const second = withParents([[child, moved]]);
  const resp = { k: second.k, records: [base.records[0], { ...second.records[1] }] };
  resp.k = [...new Set([...base.k, ...second.k])];
  const h = createHistory({ response: resp, live });
  const tl = h.timeline(coordinator, child);
  assert.equal(tl.points[0].back.ids[1], parentOf);
  assert.equal(tl.points[1].back.ids[1], moved);
  assert.equal(tl.points[1].back.hops[0].how, "parent");
  assert.notEqual(tl.spans.length, 1);
  // the full engine agrees with the light build
  assert.deepEqual(ranked(h.walkAt(coordinator, child, 1).back), ranked(tl.points[1].back));
});

test("parents from p: two parents take the one that lists the child with the better reading; no p falls back to live", () => {
  const [x, y] = [parentOf, others[0]];
  const readingOf = (r, c) => (fixture.records[0].e.find((e) => fixture.k[e[0]] === r && fixture.k[e[1]] === c) || [0, 0, -1])[2];
  const two = withParents([[child, x], [child, y]]);
  const h = createHistory({ response: two, live });
  const expected = readingOf(y, child) > readingOf(x, child) ? y : x;
  assert.equal(h.timeline(coordinator, child).points[0].back.ids[1], expected);
  const none = createHistory({ response: withParents(null), live });
  const none0 = { ...none.snapshots[0] };
  assert.equal(none0.table.p.length, 0);
  assert.equal(none.timeline(coordinator, child).points[0].back.ids[1], parentOf, "live parent for records without p");
});
