// SPDX-License-Identifier: MIT
// What the Details tab lists (spec 9.2) and the text forms of values: readings in both directions with reporter and
// rating, parent, children, routes and findings; LQI 0 as "uncertain"; ranks in the words of spec 5.4.
// node --test "tests/**/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { detailsOf } from "../custom_components/meshroute_topology_explorer/frontend/ui/details.js";
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
