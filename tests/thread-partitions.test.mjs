// SPDX-License-Identifier: MIT
// Tests for #21 as built (owner 2026-11-13, "show only, do not judge"; spec 3.2 "Partitions", 9.2): Details show a
// Thread device's own PartitionId (0/53/9) and LeaderRouterId (0/53/13) as last read, raw, and nothing where none was
// read, the value is invalid or the device is a border router; differing partition ids change no route and no status.
// Fixture: tests/thread-routes-fixture.mjs (#11's synthetic network, which reports no partition ids) with ids added
// here. Expected texts and values are written by hand. Run: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { installFakeDom, FakeEl } from "./dom-fake.mjs";

installFakeDom();
const F = "../custom_components/meshroute_topology_explorer/frontend/";
const { buildThreadNetwork } = await import(`${F}engines/thread/model.js`);
const { statusLine } = await import(`${F}engines/thread/status.js`);
const { ENGINES } = await import(`${F}engines/index.js`);
const { translator } = await import(`${F}ui/i18n.js`);
const { idOf, routeTable, threadRoutesSample } = await import("./thread-routes-fixture.mjs");

const t = translator("en");
const now = (1767268800 + 600) * 1000;
/** #11's network with `change(tablesOf)` applied; tablesOf(nodeId) is that node's thread_tables entry. */
function build(change = () => {}) {
  const sample = threadRoutesSample();
  change((nodeId) => sample.tables.nodes.find((n) => n.node_id === nodeId), sample);
  return buildThreadNetwork(sample.topology, { tables: sample.tables, deviceRegistry: sample.registry });
}
/** The text of the Details tab of device `k` (a key of the fixture). */
function details(network, k) {
  const container = new FakeEl("div");
  ENGINES.thread.details(container, { network, t, id: idOf(k), onSelect() {}, onFindings() {}, now });
  return container.textContent;
}
const LINE = /Thread partition as last read/;

test("#21 Details: the device's own partition id and leader router ID as last read, raw", () => {
  const n = build((of) => Object.assign(of(14), { partition_id: 111111111, leader_router_id: 60 }));
  assert.match(details(n, "LU"),
    /Thread partition as last read: 111111111, leader router ID 60\. The read time is not reported\./);
  // Leader router ID 60 is border router A's router ID here: shown as a number, never named.
  assert.doesNotMatch(details(n, "LU"), /leader router ID 60[^.]*Border router A/);
  assert.doesNotMatch(details(n, "LO"), LINE, "sofaoben reports none");
});

test("#21 Details: the partition alone where the leader router ID is not reported or invalid", () => {
  for (const leader of [null, undefined, 63, -1, "60", 1.5]) {
    const n = build((of) => Object.assign(of(16), { partition_id: 4294967295, leader_router_id: leader }));
    const text = details(n, "TE");
    assert.match(text, /Thread partition as last read: 4294967295\. The read time is not reported\./, String(leader));
    assert.doesNotMatch(text, /leader router ID/, String(leader));
  }
  const zero = build((of) => Object.assign(of(16), { partition_id: 0, leader_router_id: 0 }));
  assert.match(details(zero, "TE"), /Thread partition as last read: 0, leader router ID 0\./);
});

test("#21 Details: no line where no valid partition id was read, and none on a border router", () => {
  for (const value of [null, undefined, "111111111", -1, 2 ** 32, 1.5, true]) {
    const n = build((of) => Object.assign(of(14), { partition_id: value, leader_router_id: 60 }));
    assert.doesNotMatch(details(n, "LU"), LINE, String(value));
  }
  // A border router that is a Matter node with its own tables and partition id: no line either.
  const n = build((of, sample) => {
    sample.topology.nodes.find((x) => x.host_name === "Border router A").node_id = 99;
    sample.tables.nodes.push({ node_id: 99, available: true, routing_role: 5, ext_address: idOf("BRA").replace(/:/g, ""),
      rloc16: null, neighbor_table: [], route_table: routeTable("BRA"), times: null, partition_id: 111111111,
      leader_router_id: 60 });
  });
  assert.equal(n.devices.find((d) => d.id === idOf("BRA")).partitionRead, null);
  assert.doesNotMatch(details(n, "BRA"), LINE);
  // Without the route tables nothing is read.
  const sample = threadRoutesSample();
  const none = buildThreadNetwork(sample.topology);
  assert.ok(none.devices.every((d) => d.partitionRead === null));
});

test("#21 differing partition ids judge nothing: routes and status as without them", () => {
  const plain = build();
  // Three ids on one network, as cached values of different read times can be (owner's network 2026-11-13).
  const mixed = build((of) => {
    for (const [nodeId, partition, leader] of [[14, 111111111, 60], [15, 111111111, 60], [21, 111111111, 60],
      [22, 111111111, 60], [23, 111111111, 60], [16, 222222222, 28], [18, 333333333, null], [24, 444444444, 7]]) {
      Object.assign(of(nodeId), { partition_id: partition, leader_router_id: leader });
    }
  });
  // The ids did reach the devices (else the comparison below would prove nothing).
  const read = (nodeId) => mixed.devices.find((d) => d.nodeId === nodeId).partitionRead;
  assert.deepEqual([read(15), read(16), read(18), read(24)], [{ partition: 111111111, leaderRouterId: 60 },
    { partition: 222222222, leaderRouterId: 28 }, { partition: 333333333, leaderRouterId: null },
    { partition: 444444444, leaderRouterId: 7 }]);
  assert.deepEqual(statusLine(mixed, { now }), statusLine(plain, { now }));
  assert.deepEqual(mixed.status, plain.status);
  for (const k of ["XS", "TE", "KF", "P1", "P2", "P3", "LO", "LU"]) {
    const [a, b] = [mixed.routing.defaultRoute(idOf(k)), plain.routing.defaultRoute(idOf(k))];
    assert.deepEqual([a.to, a.there, a.back, a.parent], [b.to, b.there, b.back, b.parent], k);
  }
  assert.deepEqual([...mixed.routing.tables.idOfRouter], [...plain.routing.tables.idOfRouter]);
  assert.deepEqual(mixed.routing.borderRouters, plain.routing.borderRouters);
  assert.deepEqual(mixed.findings, plain.findings);
});
