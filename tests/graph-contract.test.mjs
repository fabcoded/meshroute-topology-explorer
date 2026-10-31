// SPDX-License-Identifier: MIT
// Contract between the data model and the graph core on the sample: the Network of buildNetwork() is drawn as it is,
// labels, ratings and readings arrive unchanged, every reading shapes the layout, lines follow the pair's better
// rating and the default view shows each device's best pairs only (spec 5.4, 7.1, 8).
// node --test "tests/**/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildNetwork } from "../custom_components/meshroute_topology_explorer/frontend/model/index.js";
import { GraphView } from "../custom_components/meshroute_topology_explorer/frontend/graph/graph-view.js";
import { BEST_PAIRS } from "../custom_components/meshroute_topology_explorer/frontend/graph/renderer.js";
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

test("every reading becomes a spring and part of a pair; the pair carries its better rating", (t) => {
  const { view } = show();
  const known = network.readings.filter((x) => view.scene.index.has(x.reporter) && view.scene.index.has(x.subject));
  assert.equal(known.length, network.readings.length, "the model names only devices it lists");
  assert.equal(view.layout.rest.length, new Set(known.map((x) => `${x.reporter}>${x.subject}`)).size);
  for (const pair of view.scene.pairs) {
    const ids = [view.scene.nodes[pair.a].id, view.scene.nodes[pair.b].id];
    const readings = known.filter((x) => ids.includes(x.reporter) && ids.includes(x.subject));
    const ratings = readings.map((x) => x.rating).filter((v) => v !== null);
    assert.equal(pair.rating, ratings.length ? Math.max(...ratings) : null);
  }
  const ring = view.layout.ringIds().map((id) => network.devices.find((d) => d.id === id).label).sort();
  t.diagnostic && t.diagnostic(`pairs ${view.scene.pairs.length}, default lines ${view.scene.bestCount}, ring ${ring.join(", ")}`);
  assert.deepEqual(ring, ["Router 07", "Router 08"]);
});

test("the default view shows each device's best pairs; debug shows all", () => {
  const { view, env } = show();
  const { scene } = view;
  for (let i = 0; i < scene.nodes.length; i++) {
    const own = scene.pairs.filter((p) => p.a === i || p.b === i);
    const shown = own.filter((p) => p.best);
    assert.ok(shown.length >= Math.min(BEST_PAIRS, own.length), scene.nodes[i].label);
    // Every pair rated above the device's BEST_PAIRS-th best is a line (ties at the boundary may go either way).
    const rank = (p) => p.rating ?? -1;
    const sorted = own.map(rank).sort((x, y) => y - x);
    const threshold = sorted[Math.min(BEST_PAIRS, sorted.length) - 1];
    for (const p of own) if (rank(p) > threshold) assert.ok(p.best, "its own best pairs are among the lines");
  }
  view.draw();
  assert.equal(view.lastDraw.lines, scene.bestCount);
  assert.ok(scene.bestCount < scene.pairs.length);
  view.setDebug(true);
  env.flush();
  assert.equal(view.lastDraw.lanes, scene.pairs.length);
});
