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
import { sceneBackbone, sceneClasses } from "../custom_components/meshroute_topology_explorer/frontend/graph/renderer.js";
import { theoreticalLanes, theoreticalPath }
  from "../custom_components/meshroute_topology_explorer/frontend/model/theoretical.js";
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

test("the sample's lanes by class, per direction: 41 up (12 parent links), 52 down, 29 routes, 458 heard only", (t) => {
  const { view } = show();
  const { scene } = view;
  assert.equal(scene.pairs.length, network.pairs.length);
  assert.equal(scene.lanes.length, 2 * network.pairs.length, "two lanes per pair");
  const off = sceneClasses(scene, "off");
  assert.deepEqual(off.counts, { heard: 458, route: 29, down: 52, up: 41, assumed: 0 });
  // Source routes assumed (spec 5.1): two lanes only an assumed return path uses; the other hops of the 8 assumed
  // paths are measured down lanes or lanes another class already carries.
  assert.deepEqual(sceneClasses(scene, "assume").counts, { heard: 457, route: 29, down: 54, up: 41, assumed: 2 });
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

test("the overview per stage: up and down lanes; from 'all' the backbone of theoretical paths; 'heard only' adds nothing", () => {
  const { view, env } = show();
  const { scene } = view;
  const sc = sceneClasses(scene, "assume"); // the default source-route stage
  const traffic = sc.counts.up + sc.counts.down;
  view.draw();
  const drawn = view.lastDraw.classes;
  assert.equal(drawn.up + drawn.down, traffic, "every up and down lane");
  assert.equal(drawn.route + drawn.heard + drawn.none, 0, "nothing else");
  assert.equal(drawn.assumed, sc.counts.assumed, "assumed return paths, dotted");
  // Stage 2 (decision by Fabian Schwamborn, 2026-11-01): every lane any theoretical path uses, as a route where it is
  // not up or down, lighter where only a computed route discovery takes it.
  view.setPaths("all");
  env.flush();
  const bb = sceneBackbone(scene);
  const backbone = scene.lanes.filter((l) => bb.kind[l.index] && sc.cls[l.index] !== "up" && sc.cls[l.index] !== "down");
  const two = view.lastDraw.classes;
  assert.deepEqual([two.up, two.down, two.assumed], [drawn.up, drawn.down, drawn.assumed], "stage 1 as it was");
  assert.equal(two.route, backbone.length);
  assert.equal(two.predicted, backbone.filter((l) => bb.kind[l.index] === "predicted").length);
  assert.equal(two.heard + two.none + view.lastDraw.glyphs, 0);
  // The heard option without a selection looks like stage 2: heard-only partners come on click.
  view.setHeard(true);
  env.flush();
  assert.deepEqual(view.lastDraw.classes, two);
  assert.equal(view.lastDraw.glyphs, 0);
  view.setDebug(true);
  env.flush();
  const all = view.lastDraw.classes;
  assert.equal(all.up + all.down + all.route + all.heard + all.none + view.lastDraw.glyphs, scene.lanes.length,
    "every lane, or its glyph");
});

test("spec 12: the backbone on the sample, 570 lanes: 95 up or down, the rest by their strongest kind", () => {
  const { view } = show();
  const { scene } = view;
  const lanes = theoreticalLanes(scene.pathNet);
  const sc = sceneClasses(scene, "assume");
  const key = (l) => `${scene.nodes[l.s].id}>${scene.nodes[l.h].id}`;
  const stage1 = new Set(scene.lanes.filter((l) => sc.cls[l.index] === "up" || sc.cls[l.index] === "down").map(key));
  const order = ["table", "child", "parent", "neighbour", "discovery"];
  const rest = {};
  let inStage1 = 0;
  for (const [k, { hows }] of lanes) {
    if (stage1.has(k)) { inStage1++; continue; }
    const kind = order.find((o) => hows.has(o));
    rest[kind] = (rest[kind] || 0) + 1;
  }
  assert.deepEqual([lanes.size, inStage1, stage1.size], [570, 95, 95], "every up and down lane is on some path");
  assert.deepEqual(rest, { neighbour: 427, table: 29, discovery: 19 });
  // The coordinator's trees add no lane: its ways are up and down lanes or lanes other paths use already.
  const without = new Set();
  const devices = network.devices.filter((d) => d.available && d.role !== "coordinator");
  for (const a of devices) for (const b of devices) {
    if (a !== b) for (const h of theoreticalPath(scene.pathNet, a.id, b.id).hops) without.add(`${h.sender}>${h.hearer}`);
  }
  assert.equal(without.size, 570);
  assert.deepEqual(sceneBackbone(scene).counts, { route: 551, predicted: 19 });
});

test("spec 12: lanes the overview draws per stage, with source routes assumed and off, and in debug mode", () => {
  const counts = {};
  for (const sourceRoute of ["assume", "off"]) {
    const { view, env } = show();
    view.setSourceRoute(sourceRoute);
    for (const paths of ["coordinator", "all"]) {
      for (const heard of [false, true]) {
        view.setPaths(paths);
        view.setHeard(heard);
        env.flush();
        counts[`${sourceRoute} ${paths}${heard ? " + heard" : ""}`] = [view.lastDraw.lanes, view.lastDraw.glyphs];
      }
    }
    view.setDebug(true);
    env.flush();
    counts[`${sourceRoute} debug`] = [view.lastDraw.lanes, view.lastDraw.glyphs];
  }
  // 41 up and 54 down lanes (2 of them assumed); stage 2 the backbone, with or without the heard option (no selection), 570 lanes (with source routes off the
  // two assumed lanes are drawn as routes of the backbone).
  assert.deepEqual(counts, {
    "assume coordinator": [95, 0], "assume coordinator + heard": [95, 0], "assume all": [570, 0],
    "assume all + heard": [570, 0], "assume debug": [583, 73],
    "off coordinator": [93, 0], "off coordinator + heard": [93, 0], "off all": [570, 0], "off all + heard": [570, 0],
    "off debug": [583, 73],
  });
});

test("a lane keeps its strongest class on click and hover: up and down solid, computed only where nothing proves it", () => {
  const { view, env } = show();
  const { scene } = view;
  const sc = sceneClasses(scene, "assume");
  const bb = sceneBackbone(scene);
  view.setPaths("all");
  const tally = {};
  for (const label of ["End device 06", "Router 13", "Router 11", "Coordinator"]) {
    const i = scene.nodes.findIndex((n) => n.label === label);
    for (const focus of [{ selected: i, hovered: -1 }, { selected: -1, hovered: i }]) {
      view.selected = focus.selected;
      view.hovered = focus.hovered;
      view.draw();
      const { paths, classes } = view.lastDraw;
      for (const v of paths.values) {
        const lane = scene.laneByKey.get(`${v.s}>${v.h}`);
        const own = sc.cls[lane.index];
        if (own === "up" || own === "down") assert.equal(v.cls, own, `${label}: ${v.s}>${v.h} stays ${own}`);
        if (v.predicted) assert.equal(bb.kind[lane.index], "predicted", `${label}: ${v.s}>${v.h} is computed only`);
        if (bb.kind[lane.index] === "route" && v.cls === "route") assert.equal(v.predicted, false);
      }
      // On click only the focus's lanes are drawn; hover lays them over the dimmed overview.
      if (focus.selected >= 0) tally[label] = [paths.hops, classes.predicted];
      else assert.equal(paths.hops, tally[label][0], `${label}: hover previews every hop of the click`);
    }
  }
  env.flush();
  // Hops on click, of which drawn as computed: few, as most lanes are someone's up or down lane or a table's or
  // neighbour's hop as well.
  assert.deepEqual(tally, { "End device 06": [85, 2], "Router 13": [82, 1], "Router 11": [82, 0],
    Coordinator: [96, 0] });
});

test("a stage or checkbox change redraws at once, with and without a selection (owner's report 2026-11-01)", () => {
  const { view, env } = show();
  const { scene } = view;
  const r13 = scene.nodes.findIndex((n) => n.label === "Router 13");
  const steps = (selected) => {
    view.selected = selected;
    view.setPaths("coordinator");
    view.setHeard(false);
    view.draw();
    const out = [];
    // [stage, heard]: stage 2, the checkbox on, stage 1, the checkbox off, the checkbox on, stage 2.
    for (const [stage, heard] of [["all", false], ["all", true], ["coordinator", true], ["coordinator", false],
      ["coordinator", true], ["all", true]]) {
      const before = view.lastDraw;
      view.setPaths(stage);
      view.setHeard(heard);
      env.flush(); // the next animation frame, nothing else
      assert.notEqual(view.lastDraw, before, `${stage} heard ${heard}: drawn again`);
      out.push(view.lastDraw.lanes);
    }
    return out;
  };
  // Without a selection the checkbox changes nothing: the backbone in stage 2, the up and down lanes in stage 1.
  assert.deepEqual(steps(-1), [570, 570, 95, 95, 95, 570]);
  // Router 13 selected: its way up and down (2 lanes), plus its 3 heard-only partners (7 lanes); its trees in stage 2
  // (82), where every measured neighbour is a lane of its paths, so the checkbox adds none (spec 12).
  assert.deepEqual(steps(r13), [82, 82, 7, 2, 7, 82]);
});

test("a device on the selected device's paths keeps its label in a hub position (A4m, owner report 2026-11-01)", () => {
  // End device 06 with every theoretical path: Router 17 is the hub of the lanes, and their values had taken every
  // place around it, so its label vanished (blocks were left out when no place was free).
  const { view, env } = show();
  const i = view.scene.nodes.findIndex((n) => n.label === "End device 06");
  for (const stage of ["coordinator", "all"]) {
    view.setPaths(stage);
    view.selected = i;
    view.ctx.calls.length = 0;
    view.draw();
    env.flush();
    const labelled = view.ctx.calls.filter((c) => c[0] === "fillText").map((c) => c[1]);
    assert.ok(labelled.includes("Router 17"), `stage ${stage}: Router 17 is labelled`);
  }
});

test("every hop of the focus carries its value on click, overlap accepted (board M11 rule 8, owner 2026-11-01)", () => {
  // On 7b7e9b1 a click in stage 2 lost 24-33 of 82 values (no free place or a lane too short) and Router 11 in stage 1
  // showed 1 of 3 at the fitted view.
  const { view, env } = show();
  const { scene } = view;
  for (const [label, stage, hops] of [["Router 13", "all", 82], ["Router 11", "coordinator", null], ["End device 06", "all", 85]]) {
    view.setPaths(stage);
    view.selected = scene.nodes.findIndex((n) => n.label === label);
    view.draw();
    const { paths } = view.lastDraw;
    if (hops) assert.equal(paths.hops, hops, `${label}: hops`);
    const missing = paths.values.filter((v) => !v.drawn || v.x === null);
    assert.equal(missing.length, 0, `${label} (${stage}): ${missing.length} of ${paths.values.length} values dropped`);
    assert.equal(paths.values.length, paths.hops, `${label}: one value per hop`);
  }
  env.flush();
});
