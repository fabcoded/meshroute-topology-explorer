// SPDX-License-Identifier: MIT
// Tests for the Thread through Matter adapter (spec 3.2, 4.6) on the anonymized Matter sample and small synthetic
// snapshots: roles, directions (the reporting node is the receiver), parents, missing values staying unknown.
// Run: node --test tests/
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildThreadNetwork, extAddress, isoTime, threadLqi, threadRssi, RECEIVER_OF_SOURCE_TO_TARGET,
  THREAD_CAPABILITIES } from "../custom_components/meshroute_topology_explorer/frontend/model/thread.js";
import { classifyLanes, unknownGlyph } from "../custom_components/meshroute_topology_explorer/frontend/graph/links.js";

const sampleTopology = JSON.parse(readFileSync(new URL("./fixtures/matter-sample.json", import.meta.url), "utf8"))
  .responses["matter/network_topology"];
const sample = buildThreadNetwork(sampleTopology);
const byNode = (net, key) => net.devices.find((d) => d.nodeKey === key);
const node = (id, role, extra = {}) => ({ id: String(id), kind: "matter", network_type: "thread", node_id: id, role,
  available: true, ext_address: `AABBCCDD000000${String(id).padStart(2, "0")}`, ext_pan_id: "00112233aabbcc01", ...extra });
const link = (source, target, s2t, t2s, extra = {}) => ({ source: String(source), target: String(target), network: "thread",
  strength: "strong", source_to_target: s2t, target_to_source: t2s, via_route_table: null, path_cost: 1, ...extra });
const dir = (lqi, rssi, strength = "strong") => ({ strength, lqi, rssi });

test("the sample: five nodes, their roles, the border router as a node, collection time", () => {
  assert.equal(sample.source, "thread");
  assert.equal(sample.devices.length, 5);
  assert.deepEqual(sample.capabilities, THREAD_CAPABILITIES);
  assert.equal(sample.capabilities.routes, false);
  assert.deepEqual(sample.routes, []);
  const roles = Object.fromEntries(sample.devices.map((d) => [d.nodeKey.startsWith("br_") ? "br" : d.nodeKey, d.role]));
  assert.deepEqual(roles, { 14: "router", 15: "router", 16: "end device", 18: "end device", br: "border router" });
  assert.equal(byNode(sample, "14").leader, true);
  assert.equal(byNode(sample, "15").leader, false);
  assert.equal(byNode(sample, "16").sleepy, true);
  const br = sample.devices.find((d) => d.role === "border router");
  assert.equal(br.kind, "hub");
  assert.equal(br.wired, true);
  assert.equal(br.available, true, "availability null is not offline");
  assert.equal(br.availabilityKnown, false);
  assert.equal(br.hasTable, false);
  assert.equal(sample.collectedAt, "2026-01-01T12:00:00.000Z");
  assert.match(sample.id, /^thread-[A-Za-z0-9]{1,32}$/);
  assert.equal(sample.status.nodes, 5);
  assert.equal(sample.status.links, 5);
  assert.equal(sample.status.linksBoth, 3);
  assert.equal(sample.status.borderRouters, 1);
  assert.equal(sample.findings.length, 0);
});

test("source_to_target is received at the source: the reporter is the connection's source", () => {
  assert.equal(RECEIVER_OF_SOURCE_TO_TARGET, "source");
  // 14 -> 16 in the sample: source_to_target lqi 2, rssi -85 (14 hears 16), target_to_source lqi 3, rssi -75.
  const a = byNode(sample, "14").id;
  const b = byNode(sample, "16").id;
  const r14 = sample.readings.find((r) => r.reporter === a && r.subject === b);
  const r16 = sample.readings.find((r) => r.reporter === b && r.subject === a);
  assert.deepEqual([r14.lqi, r14.rssi, r14.scale], [2, -85, "thread-lqi"]);
  assert.deepEqual([r16.lqi, r16.rssi], [3, -75]);
  // The border router has no table: only the Matter nodes' readings of it exist.
  const br = sample.devices.find((d) => d.role === "border router").id;
  assert.equal(sample.readings.filter((r) => r.reporter === br).length, 0);
  assert.equal(sample.readings.filter((r) => r.subject === br).length, 2);
});

test("parents: an end device's parent is the router it is linked to; children listed", () => {
  const p16 = byNode(sample, "16");
  const p18 = byNode(sample, "18");
  assert.equal(p16.parent, byNode(sample, "14").id);
  assert.equal(p18.parent, byNode(sample, "15").id);
  assert.deepEqual(byNode(sample, "15").children, [p18.id]);
  assert.equal(p16.parentLqi, 2);
});

test("pairs: measured, and a direction without a table is unknown with '?'", () => {
  const br = sample.devices.find((d) => d.role === "border router").id;
  const pair = sample.pairs.find((p) => p.a === br || p.b === br);
  const brHears = pair.a === br ? pair.ab : pair.ba;
  const heardByOther = pair.a === br ? pair.ba : pair.ab;
  assert.equal(heardByOther.state, "measured");
  assert.equal(brHears.state, "unknown");
  assert.equal(brHears.lqi, null);
  assert.equal(brHears.rssi, null);
  assert.equal(unknownGlyph(brHears.reason), "?");
});

test("missing values stay unknown, never 0; strength none and unknown are not measured", () => {
  const net = buildThreadNetwork({ collected_at: 1767268800, nodes: [node(1, "router"), node(2, "router"), node(3, "router")],
    connections: [link(1, 2, dir(null, null, "unknown"), dir(3, 127)), link(1, 3, dir(0, null, "none"), null)] });
  const [a, b, c] = ["1", "2", "3"].map((k) => byNode(net, k).id);
  const r12 = net.readings.find((r) => r.reporter === a && r.subject === b);
  assert.equal(r12.measured, false);
  assert.equal(r12.lqi, null);
  assert.equal(r12.rssi, null);
  const r21 = net.readings.find((r) => r.reporter === b && r.subject === a);
  assert.equal(r21.measured, true, "an LQI alone is a measurement");
  assert.equal(r21.rssi, null, "127 is OpenThread's 'no RSSI'");
  const p13 = net.pairs.find((p) => [p.a, p.b].includes(c));
  const aHearsC = p13.a === a ? p13.ab : p13.ba;
  const cHearsA = p13.a === a ? p13.ba : p13.ab;
  assert.equal(aHearsC.state, "unknown");
  assert.equal(aHearsC.reason, "reported as no link");
  assert.equal(cHearsA.reason, "table missing or stale", "3 reports nothing: its table is not known");
  assert.equal(unknownGlyph(cHearsA.reason), "?");
  // 2 reports 1, so its table was read: a neighbour it does not list gets "–".
  const net2 = buildThreadNetwork({ nodes: [node(1, "router"), node(2, "router"), node(3, "router")],
    connections: [link(1, 2, dir(3, -50), dir(3, -52)), link(2, 3, null, dir(2, -80))] });
  const p23 = net2.pairs.find((p) => [p.a, p.b].includes(byNode(net2, "3").id));
  const twoHearsThree = p23.a === byNode(net2, "2").id ? p23.ab : p23.ba;
  assert.equal(twoHearsThree.reason, "not in the neighbour table");
  assert.equal(unknownGlyph(twoHearsThree.reason), "–");
  assert.equal(net.collectedAt, "2026-01-01T12:00:00.000Z", "seconds are accepted as well");
});

test("roles: REED and awake end devices, unknown roles, Wi-Fi and other PANs ignored", () => {
  const net = buildThreadNetwork({ nodes: [
    node(1, "leader"), node(2, "reed"), node(3, "end_device"), node(4, "detached"), node(5, null),
    { id: "ap", kind: "wifi_ap", network_type: "wifi" },
    node(6, "router", { ext_pan_id: "ffffffffffffff01" }),
  ], connections: [link(1, 2, dir(3, -60), dir(3, -61)), { source: "1", target: "ap", network: "wifi" }] });
  assert.equal(net.devices.length, 5);
  assert.equal(net.unresolved.ignored, 3);
  assert.equal(byNode(net, "2").role, "end device");
  assert.equal(byNode(net, "2").reed, true);
  assert.equal(byNode(net, "2").sleepy, false);
  assert.equal(byNode(net, "3").sleepy, false);
  assert.equal(byNode(net, "4").role, "unknown");
  assert.equal(byNode(net, "5").role, "unknown");
  assert.equal(byNode(net, "5").sleepy, null);
});

test("unavailable nodes: drawn offline, their readings stale and never drawn; findings say so", () => {
  const net = buildThreadNetwork({ nodes: [node(1, "router", { available: false, last_seen: 1767268000000 }),
    node(2, "sleepy_end_device"), node(3, "sleepy_end_device")],
  connections: [link(1, 2, dir(3, -50), dir(3, -55))] });
  const r = byNode(net, "1");
  assert.equal(r.available, false);
  assert.equal(r.hasTable, false);
  assert.equal(net.staleReadings.length, 1);
  assert.equal(net.readings.length, 1);
  const kinds = net.findings.map((f) => `${f.kind}:${byNode(net, "1").id === f.device ? 1 : f.device === byNode(net, "2").id ? 2 : 3}`);
  assert.deepEqual(kinds.sort(), ["offline:1", "parent offline:2", "parent unknown:3"]);
  assert.equal(net.findings.find((f) => f.kind === "parent unknown").evidence.verdict, "no parent link");
  assert.equal(net.devices.length, 3, "an end device without a link is listed, not hidden");
});

test("parsers: extended addresses, link quality, RSSI, times", () => {
  assert.equal(extAddress("AABBCCDD00000001"), "aa:bb:cc:dd:00:00:00:01");
  assert.equal(extAddress("0xaabbccdd00000001"), "aa:bb:cc:dd:00:00:00:01");
  assert.equal(extAddress("aabb"), null);
  assert.equal(threadLqi(4), null);
  assert.equal(threadLqi("3"), null);
  assert.equal(threadRssi(-200), null);
  assert.equal(threadRssi(-75), -75);
  assert.equal(isoTime(null), null);
});

test("lanes: parent links are drawn as traffic, other readings as neighbours, no up path band", () => {
  const { lanes, upPaths } = classifyLanes(sample);
  const id = (k) => byNode(sample, k).id;
  const lane = (s, h) => lanes.find((l) => l.sender === id(s) && l.hearer === id(h));
  assert.equal(lane("16", "14").up, true, "end device -> parent");
  assert.equal(lane("14", "16").downMeasured, true, "parent -> child");
  assert.equal(lane("14", "15").up, false);
  assert.equal(lane("14", "15").dir.state, "measured");
  assert.ok([...upPaths.values()].every((ids) => ids.length === 0));
});
