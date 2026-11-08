// SPDX-License-Identifier: MIT
// Thread routes from the Matter cache (#11, spec 3.2 "Routes"): OpenThread's forwarding rule, end devices via their
// parent, a router's own entry, the derived first hop back, the weakest hop, unused alternatives, the default border
// router, missing and contradictory tables. Fixture: tests/thread-routes-fixture.mjs (the owner's numbers and the
// example extension of board M38); every expected route is worked out by hand from its tables. Run: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { buildThreadNetwork } from "../custom_components/meshroute_topology_explorer/frontend/engines/thread/model.js";
import { linkCost, nextHop, parentOf, readTables, weakestHop, MAX_COST }
  from "../custom_components/meshroute_topology_explorer/frontend/engines/thread/routes.js";
import { idOf, threadRoutesSample } from "./thread-routes-fixture.mjs";

const build = (options = {}) => {
  const { topology, tables } = threadRoutesSample(options);
  return buildThreadNetwork(topology, { tables });
};
const net = build();
const ids = (hops) => hops.map((h) => `${h.from}>${h.to}`);
const path = (...keys) => keys.slice(1).map((k, i) => `${idOf(keys[i])}>${idOf(k)}`);
const routeOf = (network, from, to) => network.routing.routeTo(idOf(from), idOf(to));

test("#11 link cost from link quality: 3 -> 1, 2 -> 2, 1 -> 4, 0 unusable", () => {
  assert.deepEqual([3, 2, 1, 0, null, 7].map(linkCost), [1, 2, 4, MAX_COST, MAX_COST, MAX_COST]);
});

test("#11 a router's own entry names its router ID and is not a router of its own", () => {
  const tables = net.routing.tables;
  const lu = tables.holders.get(idOf("LU"));
  assert.equal(lu.routerId, 28);
  assert.equal(lu.routes.has(idOf("LU")), false);
  assert.equal(tables.idOfRouter.get(28), idOf("LU"));
  assert.equal(tables.idOfRouter.get(60), idOf("BRA")); // the border router from the others' tables
});

test("#11 the 2 = 2 tie takes the direct link (sofaunten to border router A)", () => {
  const step = nextHop(net.routing.tables, idOf("LU"), idOf("BRA"));
  assert.equal(step.next, idOf("BRA"));
  assert.equal(step.kind, "direct");
  assert.equal(step.cost, 2);
  assert.deepEqual(step.alternative, { via: idOf("LO"), cost: 2, kind: "next hop" });
  const r = routeOf(net, "LU", "BRA");
  assert.deepEqual(ids(r.there.hops), path("LU", "BRA"));
  // Border router A has no table: what it hears of sofaunten is sofaunten's LQI out, no RSSI.
  assert.deepEqual([r.there.hops[0].lqi, r.there.hops[0].rssi, r.there.hops[0].source], [2, null, "lqi out"]);
  // Back: the border router's choice mirrored and derived; what sofaunten hears is measured: the weak link.
  assert.deepEqual(ids(r.back.hops), path("BRA", "LU"));
  assert.equal(r.back.hops[0].derived, true);
  assert.deepEqual([r.back.hops[0].lqi, r.back.hops[0].rssi, r.back.hops[0].source], [2, -86, "neighbours"]);
});

test("#11 a costlier direct link loses to the next hop and is kept as an unused alternative (plug 1)", () => {
  const step = nextHop(net.routing.tables, idOf("P1"), idOf("BRA"));
  assert.equal(step.next, idOf("LO"));
  assert.equal(step.cost, 2); // sofaoben's claimed 1 + link 1
  assert.deepEqual(step.alternative, { via: idOf("BRA"), cost: 4, kind: "direct" });
});

test("#11 multi-hop: the motion sensor to border router A, there and back (board M38)", () => {
  const r = routeOf(net, "XS", "BRA");
  assert.deepEqual(r.parent, { id: idOf("P2"), source: "route table" });
  assert.deepEqual(ids(r.there.hops), path("XS", "P2", "P1", "LO", "BRA"));
  assert.equal(r.there.complete, true);
  // 2 (the sensor counts what it receives from plug 2, LQI 2) + 2 + 1 + 1.
  assert.deepEqual(r.there.hops.map((h) => h.cost), [2, 2, 1, 1]);
  assert.equal(r.there.cost, 6);
  assert.deepEqual(r.there.hops.map((h) => [h.rssi, h.lqi]), [[-83, 2], [-88, 2], [-74, 3], [null, 3]]);
  assert.equal(r.there.weakest, 1); // LQI 2 twice: the weaker RSSI, -88 at plug 1
  assert.deepEqual(r.there.hops[2].alternative, { via: idOf("BRA"), cost: 4, kind: "direct" });
  assert.deepEqual(ids(r.back.hops), path("BRA", "LO", "P1", "P2", "XS"));
  assert.deepEqual(r.back.hops.map((h) => h.derived), [true, false, false, false]);
  assert.deepEqual(r.back.hops.map((h) => h.decided), ["mirrored", "next hop", "direct", "child"]);
  assert.deepEqual(r.back.hops.map((h) => [h.rssi, h.lqi]), [[-71, 3], [-72, 3], [-86, 2], [-80, 2]]);
  assert.equal(r.back.cost, 6);
  assert.equal(r.back.weakest, 2); // plug 1 -> plug 2 (-86) is weaker than plug 2 -> sensor (-80)
});

test("#11 the default border router is the one with the lowest complete path cost", () => {
  const r = net.routing.defaultRoute(idOf("XS"));
  assert.equal(r.to, idOf("BRB")); // 2 + 1 + 1 = 4 beats 6 to border router A
  assert.deepEqual(ids(r.there.hops), path("XS", "P2", "P3", "BRB"));
  assert.equal(net.routing.defaultRoute(idOf("TE")).to, idOf("BRA")); // 1 + 1 against 1 + 5
  assert.equal(net.routing.defaultRoute(idOf("BRA")), null);
});

test("#11 the parent change of the two sleepy sensors: from their own tables, LinkEstablished only", () => {
  const cached = routeOf(net, "KF", "BRA");
  assert.deepEqual(ids(cached.there.hops), path("KF", "LU", "BRA"));
  // The parent's side of a sleepy child: the last RSSI, as the average is not maintained (-13 next to -42).
  assert.deepEqual([cached.there.hops[0].rssi, cached.there.hops[0].lqi], [-42, 3]);
  assert.equal(cached.there.hops[0].cost, 2); // the child counts what it receives: LQI 2
  const fresh = build({ fresh: true });
  const moved = routeOf(fresh, "KF", "BRA");
  assert.deepEqual(moved.parent, { id: idOf("BRA"), source: "route table" });
  assert.deepEqual(ids(moved.there.hops), path("KF", "BRA"));
  assert.deepEqual(ids(moved.back.hops), path("BRA", "KF"));
  assert.equal(moved.back.hops[0].derived, true);
  assert.equal(routeOf(fresh, "TE", "BRA").parent.id, idOf("BRA"));
});

test("#11 an end device's parent entry: NextHop 0 and PathCost 0 are ignored (0 is a valid router ID)", () => {
  const { topology, tables } = threadRoutesSample();
  for (const node of tables.nodes) {
    for (const e of node.route_table) {
      if (e.routerId === 50) e.routerId = 0; // plug 2 becomes router 0
      if (node.routing_role >= 5 && e.nextHop === 50) e.nextHop = 0;
    }
  }
  const n = buildThreadNetwork(topology, { tables });
  const r = n.routing.routeTo(idOf("XS"), idOf("BRA"));
  assert.deepEqual(ids(r.there.hops), path("XS", "P2", "P1", "LO", "BRA"));
});

test("#11 the parent from the RLOC16 where 0/53/64 is reported", () => {
  const { topology, tables } = threadRoutesSample();
  const xs = tables.nodes.find((x) => x.node_id === 24);
  xs.rloc16 = (40 << 10) | 3; // reports plug 1 as parent, whatever its route table says
  const n = buildThreadNetwork(topology, { tables });
  assert.deepEqual(parentOf(n.routing.tables, n, idOf("XS")), { id: idOf("P1"), source: "rloc16" });
});

test("#11 missing tables stop the route and say where; nothing is guessed", () => {
  const { topology, tables } = threadRoutesSample();
  tables.nodes = tables.nodes.filter((x) => x.node_id !== 21); // plug 1 not in the cache
  const n = buildThreadNetwork(topology, { tables });
  const r = n.routing.routeTo(idOf("XS"), idOf("BRA"));
  assert.equal(r.there.complete, false);
  assert.equal(r.there.reason, "table_missing");
  assert.equal(r.there.at, idOf("P1"));
  assert.equal(r.there.cost, null);
  assert.equal(r.back.reason, "there_incomplete");
  // A route table not reported at all (null) is no table, never an empty one.
  const t2 = threadRoutesSample().tables;
  t2.nodes.find((x) => x.node_id === 22).route_table = null;
  const n2 = buildThreadNetwork(threadRoutesSample().topology, { tables: t2 });
  assert.equal(n2.routing.routeTo(idOf("XS"), idOf("BRA")).there.reason, "table_missing");
  // Without the command's answer there is no routing at all.
  const none = buildThreadNetwork(threadRoutesSample().topology, { tablesProblem: "not_supported: matter_not_loaded" });
  assert.equal(none.routing, null);
  assert.equal(none.capabilities.routes, false);
  assert.equal(net.capabilities.routes, true);
});

test("#11 contradictory router IDs and loops stop the route", () => {
  const { topology, tables } = threadRoutesSample();
  // Plug 2 claims router 40 for plug 3 as well: router 40 is ambiguous, so the next hop via it is unknown.
  const p2 = tables.nodes.find((x) => x.node_id === 22);
  p2.route_table.find((e) => e.routerId === 45).routerId = 40;
  const n = buildThreadNetwork(topology, { tables });
  assert.equal(n.routing.tables.conflicts.has(40), true);
  const r = n.routing.routeTo(idOf("XS"), idOf("BRA"));
  assert.equal(r.there.complete, false);
  // A loop: plug 1 sends border router A's traffic back to plug 2, which sends it to plug 1.
  const loop = threadRoutesSample();
  const p1 = loop.tables.nodes.find((x) => x.node_id === 21);
  for (const e of p1.route_table) {
    if (e.routerId === 60) Object.assign(e, { linkEstablished: false, nextHop: 50, pathCost: 1 });
    if (e.routerId === 10) e.linkEstablished = false;
  }
  const looped = buildThreadNetwork(loop.topology, { tables: loop.tables }).routing.routeTo(idOf("XS"), idOf("BRA"));
  assert.equal(looped.there.reason, "loop");
});

test("#11 weakest hop: lowest LQI, ties by the weaker RSSI; no link quality, no weakest", () => {
  assert.equal(weakestHop([{ lqi: 3, rssi: -60 }, { lqi: 2, rssi: -70 }, { lqi: 2, rssi: -80 }]), 2);
  assert.equal(weakestHop([{ lqi: 2, rssi: null }, { lqi: 2, rssi: -70 }]), 1);
  assert.equal(weakestHop([{ lqi: 2, rssi: -70 }, { lqi: 2, rssi: null }]), 0);
  assert.equal(weakestHop([{ lqi: null, rssi: -90 }]), null);
});

test("#11 no Age field is read: changing every age changes no route", () => {
  const { topology, tables } = threadRoutesSample();
  for (const node of tables.nodes) {
    for (const e of [...node.route_table, ...node.neighbor_table]) e.age = 255;
  }
  const n = buildThreadNetwork(topology, { tables });
  const a = n.routing.routeTo(idOf("XS"), idOf("BRA"));
  const b = net.routing.routeTo(idOf("XS"), idOf("BRA"));
  assert.deepEqual(a.there.hops, b.there.hops);
  assert.deepEqual(readTables(n, tables).holders.get(idOf("LU")).unchangedSince, (1767268800 - 3 * 3600) * 1000);
});
