// SPDX-License-Identifier: MIT
// Thread routes on screen (#11, boards M38 and M40 A): the map's route focus (two numbers per hop, hop numbers, the
// weakest hop, a derived hop dash-dot, other lanes grey with values, unused alternatives only with the View option),
// the Details hop list with source and age (amber over 4 hours), the View option, the adapter's read of
// thread_tables. Fixture: tests/thread-routes-fixture.mjs. Run: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { installFakeDom, FakeEl } from "./dom-fake.mjs";
import { buildThreadNetwork } from "../custom_components/meshroute_topology_explorer/frontend/engines/thread/model.js";
import { buildScene } from "../custom_components/meshroute_topology_explorer/frontend/graph/renderer.js";
import { ENGINES } from "../custom_components/meshroute_topology_explorer/frontend/engines/index.js";
import { hopText } from "../custom_components/meshroute_topology_explorer/frontend/engines/thread/scene.js";
import { OLD_TABLE_MS, mayBeOld, readText, routeHolders, routeRows } from "../custom_components/meshroute_topology_explorer/frontend/engines/thread/details.js";
import { readThread } from "../custom_components/meshroute_topology_explorer/frontend/adapters/matter.js";
import { translator } from "../custom_components/meshroute_topology_explorer/frontend/ui/i18n.js";
import { idOf, threadRoutesSample } from "./thread-routes-fixture.mjs";

installFakeDom();
const thread = ENGINES.thread;
const sample = threadRoutesSample();
const net = buildThreadNetwork(sample.topology, { tables: sample.tables, deviceRegistry: sample.registry });
const scene = buildScene(net, (s) => s.length * 6);
thread.scene.classify(scene);
const at = (k) => scene.index.get(idOf(k));
const key = (a, b) => `${at(a)}>${at(b)}`;

test("#11 hop text: RSSI over LQI, '– dBm' where no RSSI was read", () => {
  assert.equal(hopText({ rssi: -88, lqi: 2 }), "−88 dBm\nLQI 2");
  assert.equal(hopText({ rssi: null, lqi: 3 }), "– dBm\nLQI 3");
});

test("#11 selecting a device draws its route there and back, numbered, weakest marked, derived dash-dot (M38)", () => {
  const i = at("XS");
  const focus = thread.scene.focus(scene, i, { selected: i });
  const route = focus.hops.filter((x) => x.cls === "route");
  const byKey = new Map(route.map((x) => [`${x.s}>${x.h}`, x]));
  // The motion sensor's default border router is B (path cost 4).
  for (const k of [key("XS", "P2"), key("P2", "P3"), key("P3", "BRB"), key("BRB", "P3"), key("P3", "P2"), key("P2", "XS")]) {
    assert.ok(byKey.has(k), k);
  }
  assert.deepEqual(route.filter((x) => x.number).map((x) => [`${x.s}>${x.h}`, x.number]),
    [[key("XS", "P2"), 1], [key("P2", "P3"), 2], [key("P3", "BRB"), 3]]);
  assert.equal(byKey.get(key("BRB", "P3")).stroke, "dashdot");
  assert.equal(byKey.get(key("BRB", "P3")).assumed, true);
  assert.equal(byKey.get(key("XS", "P2")).weak, true); // LQI 2 against 3 and 3
  assert.equal(byKey.get(key("XS", "P2")).text, "−83 dBm\nLQI 2");
  // M40 A: every other measured lane in grey with its value, no device dimmed.
  const context = focus.hops.filter((x) => x.cls === "context");
  assert.ok(context.some((x) => `${x.s}>${x.h}` === key("LU", "LO")));
  assert.ok(context.every((x) => x.muted && x.context && x.text.includes("LQI")));
  assert.equal(focus.nodes.size, scene.nodes.length);
  assert.equal(focus.hops.some((x) => x.cls === "unused"), false, "unused routes are off by default");
});

test("#11 the View option 'unused routes' adds the alternatives dash-dot in grey with their cost", () => {
  const i = at("P1");
  const off = thread.scene.focus(scene, i, { selected: i });
  const on = thread.scene.focus(scene, i, { selected: i, unusedRoutes: true });
  assert.equal(off.hops.some((x) => x.cls === "unused"), false);
  const unused = on.hops.filter((x) => x.cls === "unused");
  const direct = unused.find((x) => `${x.s}>${x.h}` === key("P1", "BRA"));
  assert.ok(direct, "plug 1's direct link to border router A, unused while via sofaoben costs 2");
  assert.deepEqual([direct.stroke, direct.text], ["dashdot-muted", "unused · cost 4"]);
  // The route itself reads first: its lanes keep their class.
  assert.ok(on.hops.some((x) => x.cls === "route" && `${x.s}>${x.h}` === key("P1", "LO")));
});

test("#11 a hover and a border router keep the device's own lanes", () => {
  const i = at("XS");
  const hover = thread.scene.focus(scene, i, { selected: -1 });
  assert.ok(hover.hops.every((x) => x.s === i || x.h === i));
  const br = at("BRA");
  const own = thread.scene.focus(scene, br, { selected: br });
  assert.ok(own.hops.every((x) => x.cls === "parent" || x.cls === "neighbour"));
});

test("#11 a route that stops at a missing table ends in a stem towards its goal", () => {
  const { topology, tables } = threadRoutesSample();
  tables.nodes = tables.nodes.filter((x) => x.node_id !== 23 && x.node_id !== 21); // plugs 1 and 3 not in the cache
  const n = buildThreadNetwork(topology, { tables });
  const s = buildScene(n, (x) => x.length * 6);
  thread.scene.classify(s);
  const i = s.index.get(idOf("XS"));
  const focus = thread.scene.focus(s, i, { selected: i });
  assert.equal(focus.ends.length, 1);
  assert.equal(focus.ends[0].at, s.index.get(idOf("P1")) ?? s.index.get(idOf("P3")));
});

test("#11 hop list: both directions, table of each value, amber over 4 hours, holders with 'no table'", () => {
  const r = net.routing.routeTo(idOf("XS"), idOf("BRA"));
  const now = sample.tables.read_at * 1000;
  const rows = routeRows(net.routing.tables, r, now);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((x) => [x.n, x.from, x.to]), [[1, idOf("XS"), idOf("P2")], [2, idOf("P2"), idOf("P1")],
    [3, idOf("P1"), idOf("LO")], [4, idOf("LO"), idOf("BRA")]]);
  assert.deepEqual([rows[3].there.source, rows[3].there.holder, rows[3].backDerived], ["lqi out", idOf("LO"), true]);
  assert.equal(rows[0].child, true);
  // Plug 2's table read 3 h 10 min to 3 h ago (not amber); the motion sensor's before 21 h ago, lower bound unknown
  // (amber) - the sensor's side of hop 1 back.
  assert.equal(rows[0].there.old, false);
  assert.equal(rows[0].back.old, true);
  assert.equal(rows[1].weakThere, true);
  assert.equal(rows[2].weakBack, false);
  assert.equal(rows[1].weakBack, true);
  const holders = routeHolders(net.routing.tables, rows);
  assert.deepEqual(holders.map((x) => [x.id, x.table]), [[idOf("P2"), "neighbours"], [idOf("XS"), "neighbours"],
    [idOf("P1"), "neighbours"], [idOf("LO"), "neighbours"], [idOf("LO"), "routes"]]);
  assert.deepEqual(holders.find((x) => x.id === idOf("XS")).times, { lo: null, hi: now - 21 * 3600000 });
  assert.equal(holders.find((x) => x.id === idOf("LO")).both, true);
  assert.equal(OLD_TABLE_MS, 4 * 3600 * 1000);
});

test("#11 Details: the route card with its hop list, source line and derived note; every text resolves", () => {
  const t = translator("en");
  const container = new FakeEl("div");
  thread.details(container, { network: net, t, id: idOf("P1"), onSelect() {}, onFindings() {},
    now: sample.tables.read_at * 1000 });
  const text = container.textContent;
  assert.match(text, /Route to Border router A/);
  assert.match(text, /2 hops · path cost 2/);
  assert.match(text, /Source: Matter server's copy · /);
  assert.match(text, /sofaoben \(neighbour table\) read [^·–]+–[^·]+ · Plug 1 read /);
  assert.match(text, /Derived: which way the border router sends is mirrored from the way there; what sofaoben hears is measured\. The border router query \(#12\) reads the border router's own choice\./);
  assert.doesNotMatch(text, /details\.|route\.reason|route\.source/);
  const source = container.find((el) => el.tag === "p" && /^Source:/.test(el.textContent))[0];
  assert.equal(source.find((el) => el.tag === "span" && el.title).length, 3, "one tooltip per table");
  // Without the tables: the reason, no route.
  const plain = buildThreadNetwork(sample.topology, { tablesProblem: "not_supported: matter_not_loaded: Matter is not loaded" });
  const c2 = new FakeEl("div");
  thread.details(c2, { network: plain, t, id: idOf("P1"), onSelect() {}, onFindings() {} });
  assert.match(c2.textContent, /Route tables not read: not_supported/);
  assert.equal(thread.options(plain)[0].note, "view.thread_paths_note");
  assert.equal(thread.options(net)[0].controls[0].key, "unusedRoutes");
});

test("#11 the adapter reads thread_tables after the topology and keeps its failure as the reason", async () => {
  const calls = [];
  const hass = (tablesError) => ({ callWS: async (msg) => {
    calls.push(msg.type);
    if (msg.type === "config_entries/get") return [{ entry_id: "m", domain: "matter", state: "loaded" }];
    if (msg.type === "matter/network_topology") return sample.topology;
    if (msg.type === "meshroute_topology_explorer/thread_tables") {
      if (tablesError) throw { code: "not_supported", message: tablesError };
      return sample.tables;
    }
    throw { code: "unknown_command" };
  } });
  const ok = await readThread(hass(null));
  assert.equal(ok.status, "ok");
  assert.equal(ok.network.capabilities.routes, true);
  assert.deepEqual(calls.slice(-2), ["matter/network_topology", "meshroute_topology_explorer/thread_tables"]);
  const failed = await readThread(hass("matter_not_loaded: Matter is not loaded"));
  assert.equal(failed.network.routing, null);
  assert.match(failed.network.routingProblem, /matter_not_loaded/);
});

test("#11 the weakest hop is marked only below LQI 3; Details still name it", () => {
  // Plug 1 -> sofaoben -> border router A: every hop LQI 3, no red mark on the map or in the hop list.
  const i = at("P1");
  const focus = thread.scene.focus(scene, i, { selected: i });
  assert.equal(focus.hops.some((x) => x.weak), false);
  const r = net.routing.routeTo(idOf("P1"), idOf("BRA"));
  assert.notEqual(r.there.weakest, null);
  const rows = routeRows(net.routing.tables, r, sample.tables.read_at * 1000);
  assert.equal(rows.some((x) => x.weakThere || x.weakBack), false);
  const container = new FakeEl("div");
  thread.details(container, { network: net, t: translator("en"), id: idOf("P1"), onSelect() {}, onFindings() {},
    now: sample.tables.read_at * 1000 });
  assert.match(container.textContent, /Weakest there: Plug 1 → sofaoben/);
  assert.equal(container.find((el) => el.tag === "td" && /\bweak\b/.test(el.className || "")).length, 0);
  // The motion sensor's route (LQI 2 on its first hop) keeps the mark.
  const xs = thread.scene.focus(scene, at("XS"), { selected: at("XS") });
  assert.ok(xs.hops.some((x) => x.weak));
});

test("#11 Details say where an offline device stops the route", () => {
  const s = threadRoutesSample();
  s.tables.nodes.find((x) => x.node_id === 22).available = false; // plug 2, the sensor's parent, offline for Matter
  const n = buildThreadNetwork(s.topology, { tables: s.tables, deviceRegistry: s.registry });
  assert.equal(n.routing.defaultRoute(idOf("XS")).there.reason, "offline");
  const c2 = new FakeEl("div");
  thread.details(c2, { network: n, t: translator("en"), id: idOf("XS"), onSelect() {}, onFindings() {} });
  assert.match(c2.textContent, /The route stops at Plug 2: offline/);
});

test("#11 F5: read intervals in words, amber on the worst case at the 4 h boundary", () => {
  const t = translator("en");
  // Local times, so the test holds in any time zone.
  const at = (d, h, m) => new Date(2026, 10, d, h, m).getTime();
  const now = at(9, 14, 20);
  const clock = (ms) => new Intl.DateTimeFormat(t.formatLocale, { hour: "2-digit", minute: "2-digit" }).format(new Date(ms));
  assert.equal(readText({ lo: at(9, 9, 50), hi: at(9, 10, 0) }, now, t), `read ${clock(at(9, 9, 50))}–${clock(at(9, 10, 0))}`);
  assert.equal(readText({ lo: at(8, 22, 10), hi: at(9, 8, 5) }, now, t), `read yesterday ${clock(at(8, 22, 10))}–${clock(at(9, 8, 5))}`);
  assert.match(readText({ lo: at(6, 9, 50), hi: at(6, 10, 0) }, now, t), /^read 11\/6 \S+( [AP]M)?–\S+/);
  assert.equal(readText({ lo: null, hi: at(9, 13, 50) }, now, t), `read before ${clock(at(9, 13, 50))}`);
  assert.equal(readText({ lo: null, hi: at(8, 15, 9) }, now, t), `read before ${clock(at(8, 15, 9))} yesterday`);
  // Old by the lower bound: exactly 4 h is not yet old, a millisecond more is; unknown is always old.
  const lo = now - OLD_TABLE_MS;
  assert.equal(mayBeOld({ lo, hi: now - 60000 }, now), false);
  assert.equal(mayBeOld({ lo: lo - 1, hi: now - 60000 }, now), true);
  assert.equal(mayBeOld({ lo: null, hi: now - 60000 }, now), true);
  assert.equal(mayBeOld(null, now), true);
  // A table read between 3 h 50 and 3 h 40 ago turns amber 10 minutes later, by its lower bound.
  const read = { lo: now - 3.83 * 3600000, hi: now - 3.67 * 3600000 };
  assert.equal(mayBeOld(read, now), false);
  assert.equal(mayBeOld(read, now + 11 * 60000), true);
});

test("#11 F5: the source line's tooltips say interval (C) or upper bound only (D); the pill menu says the period", () => {
  const t = translator("en");
  const now = sample.tables.read_at * 1000;
  const container = new FakeEl("div");
  thread.details(container, { network: net, t, id: idOf("XS"), onSelect() {}, onFindings() {}, now });
  const spans = container.find((el) => el.tag === "span" && el.title);
  const tip = (name) => spans.find((el) => el.textContent.startsWith(name)).title;
  assert.match(tip("Plug 2"), /^Read by the Matter server between .+ and .+\. The server does not report when it reads; Meshroute checks its copy every 10 minutes \(last check .+\)\.$/);
  assert.match(tip("Motion sensor"), /^Read at .+ or earlier; Meshroute had not seen this table before \(age unknown\)\. The server re-reads its tables about once a day\.$/);
  assert.match(container.textContent, /Motion sensor read before /);
  assert.match(container.textContent, /Values that may be older than 4 hours in amber: the route may have changed since\./);
  assert.equal(spans.find((el) => el.textContent.startsWith("Motion sensor")).className, "warn-text");
  assert.equal(spans.find((el) => el.textContent.startsWith("Plug 2")).className, "");
  const parts = thread.status(net, { collected: { time: "12:00", age: "now" } }).parts.map(([key, params]) => t(key, params));
  assert.ok(parts.includes("Table times: observed every 10 min"), parts.join(" | "));
  const plain = buildThreadNetwork(sample.topology, {});
  assert.ok(thread.status(plain, { collected: { time: "12:00", age: "now" } }).parts.some(([key]) => key === "status.thread_tables_age"));
});
