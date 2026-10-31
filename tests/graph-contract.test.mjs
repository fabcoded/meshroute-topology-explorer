// SPDX-License-Identifier: MIT
// Contract between the data model and the graph core on the sample: the Network of buildNetwork() is drawn as it is,
// labels, ratings and the model's pairs arrive unchanged, every measured reading shapes the layout, pairs fall into
// the three link classes, the default view shows routes in full and heard-only pairs as each device's best three
// (spec 4.3, 5.1, 7.1, 8).
// node --test "tests/**/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildNetwork } from "../custom_components/meshroute_topology_explorer/frontend/model/index.js";
import { GraphView } from "../custom_components/meshroute_topology_explorer/frontend/graph/graph-view.js";
import { BEST_HEARD } from "../custom_components/meshroute_topology_explorer/frontend/graph/links.js";
import { FakeCanvas, fakeEnv } from "./graph-fakes.mjs";

const r = JSON.parse(readFileSync(new URL("./fixtures/zha-sample.json", import.meta.url), "utf8")).responses;
const network = buildNetwork(r["zha/devices"], { deviceRegistry: r["config/device_registry/list"],
  areaRegistry: r["config/area_registry/list"], configEntries: r["config_entries/get"] });

function show() {
  const canvas = new FakeCanvas(1400, 860);
  const env = fakeEnv({ dpr: 1 });
  const view = new GraphView(canvas, { env });
  view.setNetwork(network);
  env.flush();
  return { view, env };
}

test("devices, labels and ratings of the model arrive unchanged", () => {
  const { view } = show();
  const { scene } = view;
  assert.equal(scene.nodes.length, network.devices.length);
  for (const d of network.devices) {
    const node = scene.nodes[scene.index.get(d.id)];
    assert.equal(node.role, d.role);
    assert.equal(node.available, d.available);
    assert.equal(node.rating, d.rating);
    assert.ok(node.label === d.label || (node.label.startsWith("…") && d.label.endsWith(node.label.slice(1))));
  }
  assert.ok(scene.nodes.some((n) => n.label === "Coordinator"));
});

test("every measured reading is a spring; LQI 0 and unknown values are not", () => {
  const { view } = show();
  const measured = network.readings.filter((x) => x.measured && x.lqi > 0);
  assert.ok(measured.length < network.readings.length, "the sample has LQI 0 readings");
  assert.equal(view.layout.rest.length, new Set(measured.map((x) => `${x.reporter}>${x.subject}`)).size);
});

test("the sample's pairs by class: 41 up path (12 parent links), 52 other route, 235 heard only", (t) => {
  const { view } = show();
  const { scene } = view;
  assert.equal(scene.pairs.length, network.pairs.length);
  assert.deepEqual(scene.classes, { heard: 235, route: 52, up: 41 });
  const role = (i) => scene.nodes[i].role;
  const parentLinks = scene.pairs
    .filter((p) => p.cls === "up" && (role(p.a) === "end device" || role(p.b) === "end device"));
  assert.equal(parentLinks.length, 12);
  const impliedBoth = scene.pairs.filter((p) => p.ab.state === "implied" && p.ba.state === "implied");
  assert.equal(impliedBoth.length, 2, "two pairs only a route proves, in both directions");
  assert.ok(impliedBoth.every((p) => p.cls !== "heard"));
  // Every hop of every up path is an up-path pair.
  const key = (x, y) => (x < y ? `${x}|${y}` : `${y}|${x}`);
  const up = new Set(scene.pairs.filter((p) => p.cls === "up").map((p) => key(p.a, p.b)));
  for (const path of scene.upPaths) {
    for (let i = 0; i + 1 < path.length; i++) assert.ok(up.has(key(path[i], path[i + 1])));
  }
  t.diagnostic && t.diagnostic(`pairs ${scene.pairs.length}: ${JSON.stringify(scene.classes)}, ` +
    `shown by default ${scene.shownCount}`);
});

test("the default view shows every up-path and route pair and each device's best heard-only pairs; debug all", () => {
  const { view, env } = show();
  const { scene } = view;
  for (const p of scene.pairs) if (p.cls !== "heard") assert.ok(p.shown);
  for (let i = 0; i < scene.nodes.length; i++) {
    const own = scene.pairs.filter((p) => p.cls === "heard" && (p.a === i || p.b === i));
    const rank = (p) => p.rating ?? -1;
    const sorted = own.map(rank).sort((x, y) => y - x);
    const threshold = sorted[Math.min(BEST_HEARD, sorted.length) - 1];
    for (const p of own) if (rank(p) > threshold) assert.ok(p.shown, "its best heard-only pairs are shown");
  }
  view.draw();
  assert.equal(view.lastDraw.lines, scene.shownCount);
  assert.ok(scene.shownCount < scene.pairs.length);
  view.setDebug(true);
  env.flush();
  assert.equal(view.lastDraw.lines, scene.pairs.length);
});
