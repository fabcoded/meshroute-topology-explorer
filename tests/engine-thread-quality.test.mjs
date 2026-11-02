// SPDX-License-Identifier: MIT
// Tests for the Thread reception model (engines/thread/quality.js, docs/thread-quality-model.md): bands per direction
// from RSSI with the link-quality fallback, lane stroke levels, and the finding candidates per node, on the anonymized
// Matter sample and small synthetic snapshots (missing RSSI, RSSI 127, link quality only, asymmetric links).
// Run: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildThreadNetwork } from "../custom_components/meshroute_topology_explorer/frontend/engines/thread/model.js";
import { widthStep } from "../custom_components/meshroute_topology_explorer/frontend/graph/links.js";
import { BANDS, BAND_LEVEL, NOMINAL_NOISE_FLOOR_DBM, QUALITY_FINDINGS, QUALITY_HINTS, RSSI_HIGH_ABOVE_DBM,
  RSSI_LOW_AT_OR_BELOW_DBM, directionBand, laneLook, lqBand, nodeQualityFindings, qualityFindings, rssiBand }
  from "../custom_components/meshroute_topology_explorer/frontend/engines/thread/quality.js";

const sample = buildThreadNetwork(JSON.parse(readFileSync(new URL("./fixtures/matter-sample.json", import.meta.url),
  "utf8")).responses["matter/network_topology"]);
const node = (id, role, extra = {}) => ({ id: String(id), kind: "matter", network_type: "thread", node_id: id, role,
  available: true, ext_address: `AABBCCDD000000${String(id).padStart(2, "0")}`, ext_pan_id: "00112233aabbcc01", ...extra });
const br = (id) => ({ id: `br_${id}`, kind: "border_router", network_type: "thread", role: "router", available: null,
  ext_address: `AABBCCDD000000${String(id).padStart(2, "0")}`, ext_pan_id: "00112233aabbcc01" });
/** A Thread link; s2t is "source hears target" (model/thread.js RECEIVER_OF_SOURCE_TO_TARGET). */
const link = (source, target, s2t, t2s) => ({ source: String(source), target: String(target), network: "thread",
  strength: "strong", source_to_target: s2t, target_to_source: t2s, via_route_table: null, path_cost: 1 });
const dir = (lqi, rssi, strength = "strong") => ({ strength, lqi, rssi });
const net = (nodes, connections) => buildThreadNetwork({ collected_at: 1767268800000, nodes, connections });
const idOf = (network, key) => network.devices.find((d) => d.nodeKey === String(key)).id;
const kinds = (findings) => findings.map((f) => `${f.kind}@${f.device}`).sort();

test("limits: the OpenThread margins 20 and 10 dB on a -100 dBm floor give -80 and -90 dBm", () => {
  assert.equal(NOMINAL_NOISE_FLOOR_DBM, -100);
  assert.equal(RSSI_HIGH_ABOVE_DBM, -80);
  assert.equal(RSSI_LOW_AT_OR_BELOW_DBM, -90);
  assert.deepEqual(BANDS, ["low", "mid", "high"]);
});

test("rssiBand: edges belong to the weaker band; 127, missing and out-of-range values are no value", () => {
  const cases = [[-21, "high"], [-79, "high"], [-80, "mid"], [-85, "mid"], [-89, "mid"], [-90, "low"], [-104, "low"],
    [-128, "low"], [127, null], [null, null], [undefined, null], [11, null], [-129, null], [Number.NaN, null], ["-70", null]];
  for (const [rssi, band] of cases) assert.equal(rssiBand(rssi), band, `rssi ${rssi}`);
});

test("lqBand: 3 high, 2 mid, 1 low; 0 (observed dead) and anything else no value", () => {
  assert.deepEqual([3, 2, 1, 0, null, 4, 2.5, "3"].map(lqBand), ["high", "mid", "low", null, null, null, null, null]);
});

test("directionBand: RSSI first, link quality only where RSSI is missing or 127, nothing invented", () => {
  const m = (lqi, rssi) => ({ state: "measured", lqi, rssi });
  assert.deepEqual(directionBand(m(2, -85)), { band: "mid", basis: "rssi", rssi: -85, lq: 2, rssiBand: "mid",
    lqBand: "mid", mismatch: false });
  assert.equal(directionBand(m(3, 127)).band, "high", "127 is no RSSI: link quality 3 decides");
  assert.equal(directionBand(m(3, 127)).basis, "lq");
  assert.equal(directionBand(m(1, null)).band, "low");
  assert.equal(directionBand(m(null, -95)).basis, "rssi");
  assert.equal(directionBand(m(null, null)).band, null);
  assert.equal(directionBand(m(0, 127)).band, null, "link quality 0 and RSSI 127: no band, not low");
  assert.equal(directionBand(m(0, null)).band, null, "link quality 0 and no RSSI: a fresh entry, no band");
  for (const d of [null, undefined, { state: "implied", source: "parent", lqi: null, rssi: null },
    { state: "unknown", lqi: 2, rssi: -70, reason: "lqi 0" }]) {
    assert.equal(directionBand(d).band, null, `state ${d && d.state}`);
  }
});

test("directionBand: the receiver's own link quality caps the RSSI band (owner decision 2026-11-01)", () => {
  const m = (lqi, rssi) => directionBand({ state: "measured", lqi, rssi });
  assert.deepEqual([m(2, -75).band, m(2, -75).basis], ["mid", "lq cap"], "-75 dBm with link quality 2: mid");
  assert.deepEqual([m(1, -60).band, m(1, -60).basis], ["low", "lq cap"]);
  assert.deepEqual([m(3, -85).band, m(3, -85).basis], ["mid", "rssi"], "RSSI lower than the class: RSSI decides");
  assert.deepEqual([m(3, -70).band, m(3, -70).basis], ["high", "rssi"], "agreeing: basis rssi");
  assert.equal(laneLook({ state: "measured", lqi: 2, rssi: -75 }).level, BAND_LEVEL.mid);
});

test("directionBand: link quality 0 with a valid RSSI is a measured low reading, basis rssi", () => {
  const q = directionBand({ state: "measured", lqi: 0, rssi: -60 });
  assert.deepEqual([q.band, q.basis, q.rssi, q.lq], ["low", "rssi", -60, 0]);
  assert.equal(q.mismatch, true, "-60 dBm against link quality 0 is two bands apart");
});

test("directionBand: a reading two bands off its own link quality is a mismatch, one band is not", () => {
  const m = (lqi, rssi) => directionBand({ state: "measured", lqi, rssi }).mismatch;
  assert.equal(m(1, -60), true);
  assert.equal(m(3, -95), true);
  assert.equal(m(3, -85), false, "one band apart is not a mismatch");
  assert.equal(m(2, -95), false);
  assert.equal(m(null, -60), false);
});

test("laneLook: one stroke level per band, each inside its own width step of laneStyle; unknown keeps no level", () => {
  assert.deepEqual(BANDS.map((b) => widthStep(BAND_LEVEL[b])), [0, 1, 2]);
  assert.deepEqual(laneLook({ state: "measured", lqi: 3, rssi: -36 }), { band: "high", basis: "rssi", level: 5 / 6 });
  assert.deepEqual(laneLook({ state: "implied", source: "parent" }), { band: null, basis: null, level: null });
});

test("the sample: every measured direction gets its band from RSSI; the border router's side stays unknown", () => {
  const label = (id) => sample.devices.find((d) => d.id === id).nodeKey;
  const rows = sample.pairs.flatMap((p) => [[p.a, p.b, p.ab], [p.b, p.a, p.ba]])
    .map(([hearer, sender, d]) => { const q = directionBand(d); return `${label(hearer)}<${label(sender)} ${q.rssi} ${q.band}`; })
    .sort();
  const BR = "br_AABBCCDD00000005";
  assert.deepEqual(rows, [
    `14<15 -36 high`, `14<16 -85 mid`, `14<${BR} -75 high`, `15<14 -36 high`, `15<18 -77 high`, `15<${BR} -69 high`,
    `16<14 -75 high`, `18<15 -21 high`, `${BR}<14 null null`, `${BR}<15 null null`,
  ].sort());
  for (const p of sample.pairs) for (const d of [p.ab, p.ba]) {
    if (d.state === "measured") assert.equal(directionBand(d).basis, "rssi");
  }
});

test("the sample raises no quality finding or hint (no low band, every table consistent)", () => {
  assert.deepEqual(qualityFindings(sample), []);
});

test("weak parent link: a low band in either direction of an end device's parent link, asymmetric too", () => {
  const n = net([node(1, "leader"), node(2, "sleepy_end_device")], [link(1, 2, dir(1, -93, "weak"), dir(3, -70))]);
  const sed = idOf(n, 2);
  const [f] = nodeQualityFindings(n, sed);
  assert.equal(f.kind, "weak parent link");
  assert.equal(f.evidence.parent, idOf(n, 1));
  assert.equal(f.evidence.sleepy, true);
  assert.deepEqual(f.evidence.parentHears, { band: "low", basis: "rssi", rssi: -93, lq: 1, state: "measured" });
  assert.equal(f.evidence.childHears.band, "high", "the other direction is good: one weak direction is enough");
  assert.deepEqual(f.missing, []);
  assert.deepEqual(kinds(qualityFindings(n)), [`weak parent link@${sed}`]);
});

test("weak parent link: link quality decides where RSSI is missing; a missing direction is named, never low", () => {
  const n = net([node(1, "router"), node(2, "end_device")], [link(1, 2, dir(1, null, "weak"), null)]);
  const [f] = nodeQualityFindings(n, idOf(n, 2));
  assert.equal(f.kind, "weak parent link");
  assert.equal(f.evidence.parentHears.basis, "lq");
  assert.equal(f.evidence.childHears.band, null);
  assert.deepEqual(f.missing, ["childHears"]);
});

test("no weak parent link from RSSI 127, from a middle band, or with the parent offline", () => {
  const strong127 = net([node(1, "router"), node(2, "sleepy_end_device")], [link(1, 2, dir(3, 127), dir(3, 127))]);
  assert.deepEqual(qualityFindings(strong127), []);
  const mid = net([node(1, "router"), node(2, "sleepy_end_device")], [link(1, 2, dir(2, -89), dir(2, -86))]);
  assert.deepEqual(qualityFindings(mid), []);
  const offline = net([node(1, "router", { available: false }), node(2, "sleepy_end_device")],
    [link(1, 2, dir(1, -95), dir(1, -94))]);
  assert.ok(!qualityFindings(offline).some((f) => f.kind === "weak parent link"));
});

test("weak router links: a router whose only router link is low; a second good link clears it", () => {
  const single = net([node(1, "leader"), node(2, "router")], [link(1, 2, dir(1, -92), dir(1, -91))]);
  const found = qualityFindings(single);
  assert.deepEqual(kinds(found), [`weak router links@${idOf(single, 1)}`, `weak router links@${idOf(single, 2)}`]);
  assert.equal(found[0].evidence.only, true);
  assert.equal(found[0].evidence.links[0].weaker, "low");
  const two = net([node(1, "leader"), node(2, "router"), node(3, "router")],
    [link(1, 2, dir(1, -92), dir(1, -91)), link(2, 3, dir(3, -60), dir(3, -62))]);
  assert.deepEqual(kinds(qualityFindings(two)), [`weak router links@${idOf(two, 1)}`]);
});

test("weak router links: the weaker known direction counts; a border router's missing side is not low", () => {
  // Router 2 hears the border router well, the border router's own view is unknown: no finding.
  const n = net([node(2, "router"), br(9)], [link(2, "br_9", dir(3, -70), null)]);
  assert.deepEqual(qualityFindings(n), []);
  // Router 2 hears its only router neighbour well, but is heard low there: the weaker direction decides.
  const asym = net([node(1, "router"), node(2, "router")], [link(1, 2, dir(3, -60), dir(1, -95))]);
  assert.ok(qualityFindings(asym).some((f) => f.kind === "weak router links" && f.device === idOf(asym, 2)));
});

test("listed by one side: a neighbour lists the device, the device's own table does not; never for a border router", () => {
  const n = net([node(1, "leader"), node(2, "router"), node(3, "router"), br(9)],
    [link(1, 2, dir(3, -60), null), link(2, 3, dir(3, -50), dir(3, -52)), link(1, "br_9", dir(3, -65), null)]);
  const found = qualityFindings(n).filter((f) => f.kind === "listed by one side");
  assert.deepEqual(kinds(found), [`listed by one side@${idOf(n, 2)}`]);
  assert.deepEqual(found[0].evidence.neighbours, [{ other: idOf(n, 1), otherHears: { rssi: -60, lq: 3 },
    ownEntry: "not listed" }]);
  const dead = net([node(1, "leader"), node(2, "router"), node(3, "router")],
    [link(1, 2, dir(3, -60), dir(0, null, "none")), link(2, 3, dir(3, -50), dir(3, -52))]);
  const [h] = qualityFindings(dead).filter((f) => f.kind === "listed by one side");
  assert.equal(h.evidence.neighbours[0].ownEntry, "listed without a live link");
});

test("listed by one side: no hint when the silent side's table was not read (no reading of its own)", () => {
  const n = net([node(1, "leader"), node(2, "router")], [link(1, 2, dir(3, -60), null)]);
  assert.ok(!qualityFindings(n).some((f) => f.kind === "listed by one side"));
});

test("signal and link quality disagree: a hint at the receiver whose own link quality is two bands off", () => {
  const n = net([node(1, "leader"), node(2, "router")], [link(1, 2, dir(1, -60), dir(3, -58))]);
  const found = qualityFindings(n).filter((f) => f.kind === "signal and link quality disagree");
  assert.deepEqual(kinds(found), [`signal and link quality disagree@${idOf(n, 1)}`]);
  assert.deepEqual(found[0].evidence.readings, [{ other: idOf(n, 2), rssi: -60, lq: 1, rssiBand: "high", lqBand: "low" }]);
});

test("link quality 0 with a valid RSSI is listed as a live low reading, not as 'listed without a live link'", () => {
  const n = net([node(1, "leader"), node(2, "router"), node(3, "router")],
    [link(1, 2, dir(3, -60), dir(0, -95, "none")), link(2, 3, dir(3, -50), dir(3, -52))]);
  assert.ok(!qualityFindings(n).some((f) => f.kind === "listed by one side"));
  const fresh = net([node(1, "leader"), node(2, "router"), node(3, "router")],
    [link(1, 2, dir(3, -60), dir(0, 127, "none")), link(2, 3, dir(3, -50), dir(3, -52))]);
  const [h] = qualityFindings(fresh).filter((f) => f.kind === "listed by one side");
  assert.equal(h.evidence.neighbours[0].ownEntry, "listed without a live link");
});

test("parent of an end device: its own table decides; the reviewer's case", () => {
  // Router 1 lists the SED at -60 with no reverse entry; Router 2 lists it at -75; the SED lists only Router 2.
  const n = net([node(1, "leader"), node(2, "router"), node(3, "sleepy_end_device")],
    [link(1, 2, dir(3, -40), dir(3, -41)), link(1, 3, dir(3, -60), null), link(2, 3, dir(2, -75), dir(1, -92, "weak"))]);
  const sed = n.devices.find((d) => d.nodeKey === "3");
  assert.equal(sed.parent, idOf(n, 2));
  assert.deepEqual(sed.possiblyStaleParents, [idOf(n, 1)]);
  const [f] = nodeQualityFindings(n, sed.id);
  assert.equal(f.kind, "weak parent link", "d1 judges the Router 2 pair");
  assert.equal(f.evidence.parent, idOf(n, 2));
});

test("nothing is raised for an unavailable device, and the network is not changed", () => {
  const n = net([node(1, "leader"), node(2, "sleepy_end_device", { available: false })],
    [link(1, 2, dir(1, -95), dir(1, -96))]);
  const before = JSON.stringify(n);
  assert.deepEqual(nodeQualityFindings(n, idOf(n, 2)), []);
  qualityFindings(n);
  qualityFindings(sample);
  assert.equal(JSON.stringify(n), before);
});

test("every raised kind is declared as a finding or a hint, and none uses a Zigbee kind", () => {
  const zigbee = ["weak reception", "very low reading", "data incomplete", "route to offline device", "isolated",
    "many end-device children"];
  for (const k of [...QUALITY_FINDINGS, ...QUALITY_HINTS]) assert.ok(!zigbee.includes(k), k);
  const all = [
    net([node(1, "leader"), node(2, "sleepy_end_device")], [link(1, 2, dir(1, -93), dir(1, -60))]),
    net([node(1, "leader"), node(2, "router"), node(3, "router")], [link(1, 2, dir(3, -60), null),
      link(2, 3, dir(1, -95), dir(1, -94))]),
  ].flatMap(qualityFindings);
  assert.ok(all.length >= 3);
  for (const f of all) assert.ok([...QUALITY_FINDINGS, ...QUALITY_HINTS].includes(f.kind), f.kind);
});
