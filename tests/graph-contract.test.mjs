// SPDX-License-Identifier: MIT
// Contract between the data model and the graph core on the sample: the Network of buildNetwork() is drawn as it is,
// labels, ratings and the model's pairs arrive unchanged, every measured reading shapes the layout, lanes fall into
// classes per direction, the overview of each stage of "Communication paths" draws what it should (spec 4.3, 5.1,
// 7.1, 8).
// node --test "tests/**/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildNetwork } from "../custom_components/meshroute_topology_explorer/frontend/model/index.js";
import { GraphView } from "../custom_components/meshroute_topology_explorer/frontend/graph/graph-view.js";
import { BEST_HEARD } from "../custom_components/meshroute_topology_explorer/frontend/graph/links.js";
import { sceneClasses } from "../custom_components/meshroute_topology_explorer/frontend/graph/renderer.js";
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

test("the sample's lanes by class, per direction: 41 up (12 parent links), 41 down, 27 routes, 467 heard only", (t) => {
  const { view } = show();
  const { scene } = view;
  assert.equal(scene.pairs.length, network.pairs.length);
  assert.equal(scene.lanes.length, 2 * network.pairs.length, "two lanes per pair");
  const off = sceneClasses(scene, "off");
  assert.deepEqual(off.counts, { heard: 467, route: 27, down: 41, up: 41, assumed: 0 });
  // Source routes assumed (spec 5.1): four lanes only an assumed return path uses; the other hops of the 8 assumed
  // paths are measured down lanes or lanes another class already carries.
  assert.deepEqual(sceneClasses(scene, "assume").counts, { heard: 464, route: 27, down: 45, up: 41, assumed: 4 });
  const role = (i) => scene.nodes[i].role;
  const up = scene.lanes.filter((l) => off.cls[l.index] === "up");
  assert.equal(up.filter((l) => role(l.s) === "end device").length, 12, "an end device's way to its parent");
  // Every hop of every up path is an up lane in its direction, and the reverse lane of an up hop is never up.
  for (const path of scene.upPaths) {
    for (let i = 0; i + 1 < path.length; i++) {
      assert.equal(off.cls[scene.laneByKey.get(`${path[i]}>${path[i + 1]}`).index], "up");
      assert.ok(!scene.laneByKey.get(`${path[i + 1]}>${path[i]}`).up, "the way back is not up");
    }
  }
  const impliedBoth = scene.pairs.filter((p) => p.ab.state === "implied" && p.ba.state === "implied");
  assert.equal(impliedBoth.length, 2, "two pairs only a route proves, in both directions");
  assert.ok(impliedBoth.every((p) => p.lanes.some((i) => off.cls[i] && off.cls[i] !== "heard")), "they carry traffic");
  t.diagnostic && t.diagnostic(`lanes ${scene.lanes.length}: ${JSON.stringify(off.counts)}`);
});

test("the overview per stage: up and down lanes, from 'heard' each device's best heard-only partners; debug all", () => {
  const { view, env } = show();
  const { scene } = view;
  const sc = sceneClasses(scene, "assume"); // the default source-route stage
  const traffic = sc.counts.up + sc.counts.down;
  view.draw();
  const drawn = view.lastDraw.classes;
  assert.equal(drawn.up + drawn.down, traffic, "every up and down lane");
  assert.equal(drawn.route + drawn.heard + drawn.none, 0, "nothing else");
  assert.equal(drawn.assumed, sc.counts.assumed, "assumed return paths, dotted");
  view.setPaths("all");
  env.flush();
  assert.deepEqual(view.lastDraw.classes, drawn, "stage 2 adds only on click");
  // Stage 3: each device's best heard-only partners (by the best rating at the hearer), both lanes where heard.
  for (let i = 0; i < scene.nodes.length; i++) {
    const own = scene.pairs.filter((p) => sc.heardOnly[p.index] && (p.a === i || p.b === i));
    const rank = (p) => Math.max(...p.lanes.filter((l) => sc.cls[l] === "heard").map((l) => scene.lanes[l].dir.rating ?? -1));
    const sorted = own.map(rank).sort((x, y) => y - x);
    const threshold = sorted[Math.min(BEST_HEARD, sorted.length) - 1];
    for (const p of own) if (rank(p) > threshold) assert.ok(sc.shown[p.index], "its best heard-only partners are shown");
    assert.ok(sc.best[i].length <= BEST_HEARD);
  }
  view.setPaths("heard");
  env.flush();
  const heard = scene.lanes.filter((l) => sc.cls[l.index] === "heard" && sc.shown[l.pair]).length;
  assert.equal(view.lastDraw.classes.heard, heard);
  assert.ok(heard < sc.counts.heard);
  assert.equal(view.lastDraw.classes.route, 0, "routes between devices only on click");
  view.setDebug(true);
  env.flush();
  const all = view.lastDraw.classes;
  assert.equal(all.up + all.down + all.route + all.heard + all.none + view.lastDraw.glyphs, scene.lanes.length,
    "every lane, or its glyph");
});
