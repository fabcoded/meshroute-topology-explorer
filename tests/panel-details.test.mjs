// SPDX-License-Identifier: MIT
// What the Details tab lists (spec 9.2) and the text forms of values: readings in both directions with reporter and
// rating, parent, children, routes and findings; LQI 0 as "uncertain"; ranks in the words of spec 5.4.
// node --test "tests/**/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { detailsOf, hopBasis, hopValue, howText, pathLine, pathParts, stopText, theoryRows }
  from "../custom_components/meshroute_topology_explorer/frontend/ui/details.js";
import { nodePaths } from "../custom_components/meshroute_topology_explorer/frontend/model/node-paths.js";
import { laneValue } from "../custom_components/meshroute_topology_explorer/frontend/graph/renderer.js";
import { pathHops, routePath } from "../custom_components/meshroute_topology_explorer/frontend/model/index.js";
import { lqiText, rankText, receptionText } from "../custom_components/meshroute_topology_explorer/frontend/ui/format.js";
import { translator } from "../custom_components/meshroute_topology_explorer/frontend/ui/i18n.js";
import { sampleNetwork } from "./panel-fixture.mjs";

test("a router: readings both ways, each rated on its reporter's scale, children, own routes", () => {
  const network = sampleNetwork();
  const router = network.devices.find((d) => d.role === "router" && d.available && d.children.length);
  const info = detailsOf(network, router.id);
  assert.equal(info.heardBy.length, network.readings.filter((r) => r.subject === router.id).length);
  assert.equal(info.hears.length, network.readings.filter((r) => r.reporter === router.id).length);
  assert.ok(info.heardBy.every((r) => r.reporter.id === r.device.id), "heard by: the other end reports");
  assert.ok(info.hears.every((r) => r.reporter.id === router.id), "hears: this device reports");
  const ratings = info.heardBy.map((r) => r.rating ?? -1);
  assert.deepEqual(ratings, [...ratings].sort((a, b) => b - a), "best first");
  assert.deepEqual(info.children.map((c) => c.id).sort(), [...router.children].sort());
  assert.equal(info.routes.length, network.routes.filter((r) => r.owner === router.id).length);
  assert.equal(info.relayLoad, router.relayLoad);
  assert.equal(detailsOf(network, "no:such"), null);
});

test("an end device: parent, LQI at the parent and its findings", () => {
  const network = sampleNetwork();
  const end = network.devices.find((d) => d.role === "end device" && d.parent && network.findings.some((f) => f.device === d.id));
  const info = detailsOf(network, end.id);
  assert.equal(info.parent.id, end.parent);
  assert.equal(info.parentLqi, end.parentLqi);
  assert.deepEqual(info.findings, network.findings.filter((f) => f.device === end.id));
  assert.equal(info.hears.length, 0, "end devices keep no neighbour table here");
});

test("values as text: LQI 0 is uncertain, ranks use the reporter's name in the weakest tenth", () => {
  const t = translator("en");
  assert.equal(lqiText(0, t), "0 (uncertain)");
  assert.equal(lqiText(null, t), "no value");
  assert.equal(lqiText(157, t), "157");
  assert.equal(rankText(0.35, "Router 07", t), "rank 35 %");
  assert.equal(rankText(0.04, "Router 07", t), "rank 4 %, weakest tenth of what Router 07 hears");
  assert.equal(rankText(null, "Router 07", t), "not rated");
  assert.equal(receptionText(0.971, t), "reception rank 97 %");
  assert.equal(translator("de")("lqi.uncertain"), "0 (unsicher)");
});

test("paths as text: every hop with the reception at its hearer, unknown ends said, in both languages", () => {
  const network = sampleNetwork();
  const byLabel = (label) => network.devices.find((d) => d.label === label).id;
  const name = (id) => network.devices.find((d) => d.id === id).label;
  const en = translator("en");
  const de = translator("de");
  const lines = (label, mode, t = en) => detailsOf(network, byLabel(label), mode).paths.map((p) => pathLine(p, t, name));
  assert.deepEqual(lines("End device 06", "coordinator"), [
    "there: End device 06 \u2192 Router 17 \u00B7 RX 103 \u2192 Router 13 \u00B7 RX 111 \u2192 Coordinator \u00B7 RX 51",
    "back: Coordinator \u2192 Router 13 \u00B7 RX 104 \u2192 Router 17 \u00B7 RX 124 \u2192 End device 06 \u00B7 RX Parent",
  ]);
  assert.deepEqual(lines("End device 08", "coordinator", de), [
    "hin: End device 08 \u2192 Router 02 \u00B7 RX 161 \u2192 Router 04 \u00B7 RX 200 \u2192 Coordinator \u00B7 RX 165",
    "zur\u00FCck: Coordinator \u2192 Router 03 \u00B7 RX 236 \u2192 Router 02 \u00B7 RX 252 \u2192 End device 08 \u00B7 RX Parent",
  ]);
  assert.deepEqual(lines("Router 01", "coordinator", de), [
    "hin: Router 01 \u2192 Coordinator \u00B7 RX 101",
    "zur\u00FCck: Coordinator \u2192 Weg unbekannt",
  ]);
  // All paths: the way with the coordinator, then out and in paths to and from every other available device (spec
  // 5.7), named by their other end.
  const all = lines("Router 11", "all");
  assert.equal(all.length, 2 + 2 * 40);
  assert.ok(all.includes("to Router 30: Router 11 \u2192 Router 27 \u00B7 RX 134 \u2192 Router 30 \u00B7 RX 108"));
  assert.ok(all.includes("from Router 01: Router 01 \u2192 Router 11 \u00B7 RX 142"));
  assert.ok(all.includes("to Router 26: Router 11 \u2192 Router 26 \u00B7 RX Route"), "a hop only a route proves");
  // A walk that reaches an unavailable goal names it as unavailable instead of inventing a reception.
  const [r01, r08] = [byLabel("Router 01"), byLabel("Router 08")];
  const walk = routePath(network, r01, r08);
  const toOffline = { kind: "out", from: r01, to: r08, ...walk, hops: pathHops(network, walk.ids) };
  assert.equal(pathLine(toOffline, en, name), "to Router 08: Router 01 \u2192 Router 08 (unavailable)");
  // An unavailable router: alone, its way up unknown.
  const off = network.devices.find((d) => !d.available);
  assert.equal(pathLine(detailsOf(network, off.id).paths[0], en, name), `there: ${off.label} \u2192 path unknown`);
  // Values as on the map: LQI 0 uncertain, "?" without evidence.
  assert.equal(hopValue({ state: "unknown", lqi: 0 }, en), "0 (uncertain)");
  assert.equal(hopValue({ state: "unknown", lqi: null }, en), "?");
  assert.equal(hopValue({ state: "implied", source: "route" }, de), "Route");
});

test("theoretical paths per device: a row per other device, shortest first, hops with how they are taken", () => {
  const network = sampleNetwork();
  const byLabel = (label) => network.devices.find((d) => d.label === label).id;
  const name = (id) => network.devices.find((d) => d.id === id).label;
  const en = translator("en");
  const de = translator("de");
  const info = detailsOf(network, byLabel("End device 06"), "all");
  assert.equal(info.theory.length, 40, "every other available device but the coordinator");
  const count = (p) => p.hops.length;
  for (let i = 1; i < info.theory.length; i++) {
    const [a, b] = [info.theory[i - 1], info.theory[i]];
    assert.ok(count(a.out) < count(b.out) || (count(a.out) === count(b.out) && count(a.in) <= count(b.in)), name(b.id));
  }
  // The parent first: one hop there (parent) and one back (child).
  const first = info.theory[0];
  assert.equal(name(first.id), "Router 17");
  assert.deepEqual([first.out.hops.map((h) => h.how), first.in.hops.map((h) => h.how)], [["parent"], ["child"]]);
  // Router 13: out by the parent, then a discovery from it; the steps name how each hop is taken.
  const r13 = info.theory.find((r) => name(r.id) === "Router 13");
  const steps = pathParts(r13.out, de, name).steps.map((s) => `${s.name}${s.how ? ` (${howText(s.how, de)})` : ""}`);
  assert.equal(steps[1], "Router 17 (Parent)");
  assert.ok(r13.out.hops.every((h) => h.how), "every hop says how it is taken");
  // In the stage "coordinator" there are no theoretical rows.
  assert.equal(detailsOf(network, byLabel("End device 06"), "coordinator").theory.length, 0);
  const coordinator = network.devices.find((d) => d.role === "coordinator").id;
  assert.equal(detailsOf(network, coordinator, "coordinator").theory.length, 0, "the coordinator's stage 1: its routes");
  assert.equal(detailsOf(network, coordinator, "all").theory.length, 41, "stage 2: its trees, like any device");
  // Words in both languages.
  assert.deepEqual(["table", "neighbour", "discovery", "parent", "child"].map((x) => howText(x, de)),
    ["Tabelle", "Nachbar", "Routensuche (berechnet)", "Parent", "Kind"]);
  assert.deepEqual(["table", "neighbour", "discovery", "parent", "child"].map((x) => howText(x, en)),
    ["table", "neighbour", "route discovery (computed)", "parent", "child"]);
  assert.equal(de("details.theory_title", { count: 40 }), "Wege zu anderen Ger\u00E4ten (theoretisch) \u00B7 40");
  assert.equal(stopText("no link", de), "keine Verbindung");
  assert.equal(stopText("loop", en), "loop");
  assert.deepEqual(theoryRows([], name), []);
  // Rows with the same hop counts sort by name in natural order: Router 2 before Router 10.
  const way = (kind, id) => ({ kind, from: kind === "out" ? "x" : id, to: kind === "out" ? id : "x", complete: true,
    hops: [{ how: "table" }] });
  const rows = theoryRows(["Router 10", "Router 2", "Router 1"].flatMap((id) => [way("out", id), way("in", id)]), (x) => x);
  assert.deepEqual(rows.map((r) => r.id), ["Router 1", "Router 2", "Router 10"]);
  assert.equal(de("details.theory_cost", { cost: 9 }), "Pfadkosten gesamt 9");
  assert.equal(en("details.theory_cost", { cost: 9 }), "Total path cost 9");
});

test("a hop whose hearer's table was read but does not list the sender shows the dash and names its basis (brief a4o)", () => {
  const network = sampleNetwork();
  const t = translator("de");
  const names = new Map(network.devices.map((d) => [d.id, d.label]));
  const name = (id) => names.get(id);
  const hops = [];
  for (const d of network.devices) {
    for (const p of nodePaths(network, d.id, "all")) if (p.complete) hops.push(...p.hops);
  }
  const unknown = hops.filter((h) => h.state === "unknown" && h.lqi !== 0);
  const listedNot = unknown.filter((h) => /^table (full|nearly full|has space)|^capacity unknown/.test(h.reason));
  assert.ok(listedNot.length > 0, "the sample has such hops");
  for (const hop of listedNot) {
    assert.equal(hopValue(hop, t), "–", hop.reason);
    assert.equal(laneValue(hop, { uncertain: "0", parent: "P", route: "R" }), "–", "map and Details agree");
    assert.match(hopBasis(hop, t, name), /^Grundlage: /);
  }
  const full = listedNot.find((h) => /^table full/.test(h.reason) && typeof h.backLqi === "number");
  assert.match(hopBasis(full, t, name), new RegExp(`${name(full.sender)} hört ${name(full.hearer)} mit ${full.backLqi}; Tabelle von ${name(full.hearer)} voll \\(\\d+/\\d+\\)$`));
  const space = listedNot.find((h) => /^table has space/.test(h.reason));
  assert.match(hopBasis(space, t, name), /hat Platz\. Link vermutlich einseitig oder gealtert$/);
  // No table to ask: "?" on both, and no basis.
  const noTable = { sender: "a", hearer: "b", state: "unknown", lqi: null, reason: "end device (no table)" };
  assert.equal(hopValue(noTable, t), "?");
  assert.equal(laneValue(noTable, { uncertain: "0" }), "?");
  assert.equal(hopBasis(noTable, t, name), null);
  assert.equal(hopValue({ state: "unknown", lqi: null, reason: "no evidence" }, t), "?");
});
