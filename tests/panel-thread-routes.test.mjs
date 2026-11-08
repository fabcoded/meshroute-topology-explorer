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
import { OLD_TABLE_MS, routeHolders, routeRows } from "../custom_components/meshroute_topology_explorer/frontend/engines/thread/details.js";
import { readThread } from "../custom_components/meshroute_topology_explorer/frontend/adapters/matter.js";
import { translator } from "../custom_components/meshroute_topology_explorer/frontend/ui/i18n.js";
import { idOf, threadRoutesSample } from "./thread-routes-fixture.mjs";

installFakeDom();
const thread = ENGINES.thread;
const sample = threadRoutesSample();
const net = buildThreadNetwork(sample.topology, { tables: sample.tables });
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

test("#11 the View option 'unused routes' adds the alternatives dashed with their cost", () => {
  const i = at("P1");
  const off = thread.scene.focus(scene, i, { selected: i });
  const on = thread.scene.focus(scene, i, { selected: i, unusedRoutes: true });
  assert.equal(off.hops.some((x) => x.cls === "unused"), false);
  const unused = on.hops.filter((x) => x.cls === "unused");
  const direct = unused.find((x) => `${x.s}>${x.h}` === key("P1", "BRA"));
  assert.ok(direct, "plug 1's direct link to border router A, unused while via sofaoben costs 2");
  assert.deepEqual([direct.stroke, direct.text], ["dashed", "unused · cost 4"]);
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
  // Plug 2's table is 3 h old (not amber); the motion sensor's 21 h (amber) - the sensor's side of hop 1 back.
  assert.equal(rows[0].there.old, false);
  assert.equal(rows[0].back.old, true);
  assert.equal(rows[1].weakThere, true);
  assert.equal(rows[2].weakBack, false);
  assert.equal(rows[1].weakBack, true);
  const holders = routeHolders(net.routing.tables, rows);
  assert.deepEqual(holders.map((x) => x.id), [idOf("P2"), idOf("XS"), idOf("P1"), idOf("LO")]);
  assert.ok(holders.every((x) => x.table && x.since === (sample.tables.read_at - (x.id === idOf("XS") ? 21 : 3) * 3600) * 1000));
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
  assert.match(text, /unchanged since/);
  assert.match(text, /Exact values for this hop only with the border router query \(#12\)/);
  assert.doesNotMatch(text, /details\.|route\.reason|route\.source/);
  const source = container.find((el) => el.tag === "p" && /^Source:/.test(el.textContent))[0];
  assert.equal(source.title || source.attrs.title, t("details.route_source_note"));
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
