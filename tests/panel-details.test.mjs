// SPDX-License-Identifier: MIT
// What the Details tab lists (spec 9.2) and the text forms of values: readings in both directions with reporter and
// rating, parent, children, routes and findings; LQI 0 as "uncertain"; ranks in the words of spec 5.4.
// node --test "tests/**/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { detailsOf, hopValue, pathLine } from "../custom_components/meshroute_topology_explorer/frontend/ui/details.js";
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
    "To the coordinator: End device 06 \u2192 Router 17 (RX 103) \u2192 Router 13 (RX 111) \u2192 Coordinator (RX 51)",
    "From the coordinator: Coordinator \u2192 Router 16 (RX 114) \u2192 Router 17 (RX 168) \u2192 End device 06 (RX Parent)",
  ]);
  assert.deepEqual(lines("End device 08", "coordinator", de), [
    "Zum Koordinator: End device 08 \u2192 Router 02 (RX 161) \u2192 Router 04 (RX 200) \u2192 Coordinator (RX 165)",
    "Vom Koordinator: Coordinator \u2192 Weg unbekannt",
  ]);
  // All paths: out and in paths are named by their other end.
  const all = lines("Router 11", "all");
  assert.equal(all.length, 11);
  assert.ok(all.includes("To Router 30: Router 11 \u2192 Router 27 (RX 134) \u2192 Router 30 (RX 108)"));
  assert.ok(all.includes("From Router 01: Router 01 \u2192 Router 11 (RX 142)"));
  assert.ok(all.includes("To Router 26: Router 11 \u2192 Router 26 (RX Route)"), "a hop only a route proves");
  // A route to an unavailable device names it as unavailable instead of inventing a reception.
  const toOffline = detailsOf(network, byLabel("Router 01"), "all").paths.filter((p) => !p.complete && p.ids.at(-1) === p.to);
  assert.deepEqual(toOffline.map((p) => pathLine(p, en, name)), ["To Router 08: Router 01 \u2192 Router 08 (unavailable)"]);
  // An unavailable router: alone, its way up unknown.
  const off = network.devices.find((d) => !d.available);
  assert.equal(pathLine(detailsOf(network, off.id).paths[0], en, name), `To the coordinator: ${off.label} \u2192 path unknown`);
  // Values as on the map: LQI 0 uncertain, "?" without evidence.
  assert.equal(hopValue({ state: "unknown", lqi: 0 }, en), "0 (uncertain)");
  assert.equal(hopValue({ state: "unknown", lqi: null }, en), "?");
  assert.equal(hopValue({ state: "implied", source: "route" }, de), "Route");
});
