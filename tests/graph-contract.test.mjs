// SPDX-License-Identifier: MIT
// Contract between the data model and the graph core on the sample: the Network of buildNetwork() is drawn as it is,
// labels, ratings and the model's pairs arrive unchanged, every measured reading shapes the layout, lanes fall into
// classes per direction, the overview of each stage of "Communication paths" draws what it should (spec 4.3, 5.1,
// 7.1, 8).
// node --test "tests/**/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildNetwork } from "../custom_components/meshroute_topology_explorer/frontend/engines/zigbee/model.js";
import { GraphView } from "../custom_components/meshroute_topology_explorer/frontend/graph/graph-view.js";
import { focus, overview, sceneBackbone, sceneClasses, scenePaths }
  from "../custom_components/meshroute_topology_explorer/frontend/engines/zigbee/scene.js";
import { theoreticalLanes, theoreticalPath }
  from "../custom_components/meshroute_topology_explorer/frontend/engines/zigbee/theoretical.js";
import { FakeCanvas, fakeEnv, labelWidth } from "./graph-fakes.mjs";

const r = JSON.parse(readFileSync(new URL("./fixtures/zha-sample.json", import.meta.url), "utf8")).responses;
const network = buildNetwork(r["zha/devices"], { deviceRegistry: r["config/device_registry/list"],
  areaRegistry: r["config/area_registry/list"], configEntries: r["config_entries/get"] });

// [hops on click, of which computed]; before the change (backbone classes reaching in): 2, 1, 0, 0.
const PREDICTED_ON_CLICK = { "End device 06": [85, 34], "Router 13": [82, 20], "Router 11": [82, 9], Coordinator: [96, 0] };

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
  // Stage 2: every lane any theoretical path uses, as a route where it is
  // not up or down, lighter where only a computed route discovery takes it.
  view.setEngineView({ paths: "all" });
  env.flush();
  const bb = sceneBackbone(scene);
  const backbone = scene.lanes.filter((l) => bb.kind[l.index] && sc.cls[l.index] !== "up" && sc.cls[l.index] !== "down");
  const two = view.lastDraw.classes;
  assert.deepEqual([two.up, two.down, two.assumed], [drawn.up, drawn.down, drawn.assumed], "stage 1 as it was");
  assert.equal(two.route, backbone.length);
  assert.equal(two.predicted, backbone.filter((l) => bb.kind[l.index] === "predicted").length);
  assert.equal(two.heard + two.none + view.lastDraw.glyphs, 0);
  // The heard option without a selection looks like stage 2: heard-only partners come on click.
  view.setEngineView({ heard: true });
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
    view.setEngineView({ sourceRoute: sourceRoute });
    for (const paths of ["coordinator", "all"]) {
      for (const heard of [false, true]) {
        view.setEngineView({ paths: paths });
        view.setEngineView({ heard: heard });
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

test("on click and hover the selection's own tree decides each hop's class: computed where only a discovery takes it", () => {
  const { view, env } = show();
  const { scene } = view;
  view.setEngineView({ paths: "all" });
  const tally = {};
  for (const label of ["End device 06", "Router 13", "Router 11", "Coordinator"]) {
    const i = scene.nodes.findIndex((n) => n.label === label);
    const own = scenePaths(scene, i, "all", "assume");
    // The selection's stage-1 lanes: its up and down paths with the coordinator.
    const stage1 = scenePaths(scene, i, "coordinator", "assume");
    for (const focus of [{ selected: i, hovered: -1 }, { selected: -1, hovered: i }]) {
      view.selected = focus.selected;
      view.hovered = focus.hovered;
      view.draw();
      const { paths, classes } = view.lastDraw;
      for (const v of paths.values) {
        const key = `${v.s}>${v.h}`;
        const hop = own.hops.get(key);
        const s1 = stage1.hops.get(key);
        if (s1 && (s1.cls === "up" || s1.cls === "down")) {
          assert.equal(v.cls, s1.cls, `${label}: ${key} is its own ${s1.cls} lane`);
          continue;
        }
        assert.equal(v.cls, hop.cls, `${label}: ${key} has the class of the selection's own tree`);
        assert.equal(v.predicted, hop.predicted, `${label}: ${key} computed only if its own tree says so`);
      }
      if (focus.selected >= 0) tally[label] = [paths.hops, classes.predicted];
      else assert.equal(paths.hops, tally[label][0], `${label}: hover previews every hop of the click`);
    }
  }
  env.flush();
  // Hops on click, of which computed (before: 2, 1, 0, 0 of the same hops, the backbone's classes reached in).
  assert.deepEqual(tally, PREDICTED_ON_CLICK);
  // Router 13 -> Router 21: the details say route discovery for both hops, and the map draws the second
  // computed even though the backbone takes its lane as somebody's down lane.
  const label = (l) => scene.nodes.findIndex((n) => n.label === l);
  const [r13, r11, r21] = ["Router 13", "Router 11", "Router 21"].map(label);
  const hops = theoreticalPath(scene.pathNet, scene.nodes[r13].id, scene.nodes[r21].id).hops;
  assert.deepEqual(hops.map((h) => [h.sender, h.hearer, h.how]),
    [[scene.nodes[r13].id, scene.nodes[r11].id, "discovery"], [scene.nodes[r11].id, scene.nodes[r21].id, "discovery"]]);
  view.selected = r13;
  view.draw();
  const drawn = new Map(view.lastDraw.paths.values.map((v) => [`${v.s}>${v.h}`, v]));
  // R13 -> R11 is R13's neighbour hop to R11 itself, so the strongest of its own ways makes it a route, not computed;
  // no table names R11 as R13's next hop, so it is drawn derived (dash-dot). R11 -> R21 only a discovery takes: computed.
  assert.deepEqual([drawn.get(`${r13}>${r11}`).cls, drawn.get(`${r13}>${r11}`).predicted], ["route", false]);
  const r13Hops = focus(scene, r13, { paths: "all", sourceRoute: "assume", selected: r13 }).hops;
  const stroke = (s, h) => r13Hops.find((hop) => hop.s === s && hop.h === h).stroke;
  assert.deepEqual([stroke(r13, r11), stroke(r11, r21)], ["dashdot", "dashdot-muted"]);
  assert.deepEqual([drawn.get(`${r11}>${r21}`).cls, drawn.get(`${r11}>${r21}`).predicted], ["route", true]);
  // A lane the selection takes by a table stays a proven route, even where only discovery is computed elsewhere.
  const proven = [...scenePaths(scene, r13, "all", "assume").hops.values()].filter((h) => h.cls === "route" && !h.predicted);
  assert.ok(proven.length > 0);
  for (const h of proven) assert.equal(drawn.get(`${h.s}>${h.h}`).predicted, false);
  // The overview (no selection) keeps the backbone: 570 lanes, 19 of them computed only.
  view.selected = -1;
  view.draw();
  assert.equal(view.lastDraw.lanes, 570);
  assert.equal(view.lastDraw.classes.predicted, 19);
});

test("a lane keeps its look in all three views: the stroke says the evidence, the width the role (spec 7.1)", () => {
  const { view } = show();
  const { scene } = view;
  const at = (label) => scene.nodes.findIndex((n) => n.label === label);
  const key = (a, b) => `${at(a)}>${at(b)}`;
  const VIEWS = ["coordinator", "table", "all"];
  // Per view the drawn lanes as "stroke weight": the overview (i = -1) or the click on device i.
  const drawn = (i) => Object.fromEntries(VIEWS.map((paths) => {
    const v = { paths, sourceRoute: "assume", returnRoutes: true, selected: i };
    const looks = i < 0 ? scene.lanes.map((l) => [l.key, overview(scene, v)[l.index]]).filter(([, o]) => o)
      : focus(scene, i, v).hops.map((h) => [`${h.s}>${h.h}`, h]);
    return [paths, new Map(looks.map(([k, o]) => [k, `${o.stroke} ${o.weight}`]))];
  }));
  const look = (d, k) => VIEWS.map((v) => d[v].get(k) ?? null);
  // Router 02 (routing entries of the fixture): way up over Router 04, its own entry and Router 04's. Its return is
  // assumed (the coordinator holds no entry for it), but on lanes tables name: Coordinator -> RWL022 via Router 04,
  // Router 04 -> End device 10 via Router 02. Before, the way up was dash-dot under "Routing table" and the return
  // dotted in "all". In the routing table view the walks back are direct neighbour hops (5.1): the coordinator and
  // Router 04 list Router 02 (162, 200) without an entry for it; Router 04's hop is read, as its entry for End device
  // 10 names Router 02, the coordinator's derived, as no entry names Router 02 there (the fixture, by hand).
  const r02 = drawn(at("Router 02"));
  for (const k of [key("Router 02", "Router 04"), key("Router 04", "Coordinator"), key("Router 04", "Router 02")]) {
    assert.deepEqual(look(r02, k), ["solid strong", "solid strong", "solid strong"], k);
  }
  assert.deepEqual(look(r02, key("Coordinator", "Router 04")), ["solid strong", null, "solid strong"]);
  // In "all" End device 07's way to Router 02 takes the same hop over its parent, the coordinator (5.7 rule 4).
  assert.deepEqual(look(r02, key("Coordinator", "Router 02")), [null, "dashdot regular", "dashdot regular"]);
  // Router 06: its own entry to the coordinator; no table names Router 06 as next hop, so its return (assumed, or
  // in the routing table view the coordinator's direct hop to its neighbour, LQI 79) stays dash-dot wherever drawn.
  const r06 = drawn(at("Router 06"));
  assert.deepEqual(look(r06, key("Router 06", "Coordinator")), ["solid strong", "solid strong", "solid strong"]);
  assert.deepEqual(look(r06, key("Coordinator", "Router 06")), ["dashdot strong", "dashdot strong", "dashdot strong"]);
  // Router 13: a direct neighbour of the coordinator both ways by entries on both sides.
  const r13 = drawn(at("Router 13"));
  for (const k of [key("Router 13", "Coordinator"), key("Coordinator", "Router 13")]) {
    assert.deepEqual(look(r13, k), ["solid strong", "solid strong", "solid strong"], k);
  }
  // Every lane drawn in more than one view looks the same in each, for the overview and for clicks; only a hop the
  // click in "all" takes by route discovery alone is drawn computed on its own (decision 2026-11-01).
  let compared = 0;
  for (const label of [null, "Router 02", "Router 06", "Router 13", "Router 11", "End device 06", "RODRET Dimmer",
    "Coordinator"]) {
    const d = drawn(label ? at(label) : -1);
    for (const k of new Set(VIEWS.flatMap((v) => [...d[v].keys()]))) {
      const looks = look(d, k).filter((o, n) => o && !(VIEWS[n] === "all" && o.startsWith("dashdot-muted")));
      if (looks.length < 2) continue;
      compared++;
      assert.equal(new Set(looks).size, 1, `${label || "overview"} ${k}: ${look(d, k).join(" | ")}`);
    }
  }
  assert.ok(compared > 200, `${compared} lanes compared`);
});

test("a stage or checkbox change redraws at once, with and without a selection ", () => {
  const { view, env } = show();
  const { scene } = view;
  const r13 = scene.nodes.findIndex((n) => n.label === "Router 13");
  const steps = (selected) => {
    view.selected = selected;
    view.setEngineView({ paths: "coordinator" });
    view.setEngineView({ heard: false });
    view.draw();
    const out = [];
    // [stage, heard]: stage 2, the checkbox on, stage 1, the checkbox off, the checkbox on, stage 2.
    for (const [stage, heard] of [["all", false], ["all", true], ["coordinator", true], ["coordinator", false],
      ["coordinator", true], ["all", true]]) {
      const before = view.lastDraw;
      view.setEngineView({ paths: stage });
      view.setEngineView({ heard: heard });
      env.flush(); // the next animation frame, nothing else
      assert.notEqual(view.lastDraw, before, `${stage} heard ${heard}: drawn again`);
      out.push(view.lastDraw.lanes);
    }
    return out;
  };
  // Without a selection the checkbox changes nothing: the backbone in stage 2, the up and down lanes in stage 1.
  assert.deepEqual(steps(-1), [570, 570, 95, 95, 95, 570]);
  // Router 13 selected: its way up and down (2 lanes) in stage 1 and its trees in stage 2 (82), whatever the checkbox
  // says: it works under the routing table only (spec 12).
  assert.deepEqual(steps(r13), [82, 82, 2, 2, 2, 82]);
  // Under the routing table the checkbox draws the heard partners.
  view.selected = r13;
  view.setEngineView({ paths: "table", heard: false });
  env.flush();
  const tablePlain = view.lastDraw.lanes;
  view.setEngineView({ heard: true });
  env.flush();
  assert.deepEqual([tablePlain, view.lastDraw.lanes], [6, 11], "Router 13 under the routing table: 6 lanes, 11 with the option");
});

test("a device on the selected device's paths keeps its label in a hub position", () => {
  // End device 06 with every theoretical path: Router 17 is the hub of the lanes, and their values had taken every
  // place around it, so its label vanished (blocks were left out when no place was free).
  const { view, env } = show();
  const i = view.scene.nodes.findIndex((n) => n.label === "End device 06");
  for (const stage of ["coordinator", "all"]) {
    view.setEngineView({ paths: stage });
    view.selected = i;
    view.ctx.calls.length = 0;
    view.draw();
    env.flush();
    const labelled = view.ctx.calls.filter((c) => c[0] === "fillText").map((c) => c[1]);
    assert.ok(labelled.includes("Router 17"), `stage ${stage}: Router 17 is labelled`);
  }
});

test("every hop of the focus carries its value on click, overlap accepted (spec 7.1)", () => {
  // On 7b7e9b1 a click in stage 2 lost 24-33 of 82 values (no free place or a lane too short) and Router 11 in stage 1
  // showed 1 of 3 at the fitted view.
  const { view, env } = show();
  const { scene } = view;
  for (const [label, stage, hops] of [["Router 13", "all", 82], ["Router 11", "coordinator", null], ["End device 06", "all", 85]]) {
    view.setEngineView({ paths: stage });
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

test("no value covers the label of the selected device, its lanes and values stay", () => {
  // Stage 2 on a hub put the many RX values over the name of the clicked device. Values now take the next spot on their
  // own lane; the label (type line and name) is drawn and no value box intersects it.
  const { view, env } = show();
  const { scene } = view;
  const kinds = Object.fromEntries(scene.nodes.filter((n) => n.kind).map((n) => [n.kind, `T:${n.kind}`]));
  view.setTexts({ kinds });
  for (const working of [false, true]) for (const [label, stage] of [["Router 13", "all"], ["End device 06", "coordinator"], ["End device 06", "all"],
    ["Router 11", "all"], ["Coordinator", "all"]]) {
    view.setEngineView({ paths: stage });
    const i = scene.nodes.findIndex((n) => n.label === label);
    view.selected = i;
    if (working) { // the type line shows from the working scale: zoom there, centred on the device
      view.autoFit = false;
      view.cam = { k: view.workingZoom, cx: view.pos.x[i], cy: view.pos.y[i] };
    }
    view.ctx.calls.length = 0;
    view.draw();
    const { paths } = view.lastDraw;
    const texts = view.ctx.calls.filter((c) => c[0] === "fillText");
    const wanted = [label, working && scene.nodes[i].kind ? kinds[scene.nodes[i].kind] : null].filter(Boolean);
    // Text boxes of the label lines: the name sits right at the device, so find the lines nearest to its symbol.
    const x = view.lastDraw.sx[i];
    const y = view.lastDraw.sy[i];
    const boxes = [];
    for (const text of wanted) {
      const c = texts.filter((t) => t[1] === text).sort((p, q) => Math.hypot(p[2] - x, p[3] - y) - Math.hypot(q[2] - x, q[3] - y))[0];
      assert.ok(c, `${label} (${stage}${working ? ", working zoom" : ""}): "${text}" is drawn`);
      const w = labelWidth(text) + 4;
      boxes.push({ text, x: c[2] - w / 2, y: c[3] - 7, w, h: 14 });
    }
    for (const v of paths.values) {
      assert.ok(v.drawn && v.x !== null, `${label} (${stage}${working ? ", working zoom" : ""}): every hop keeps its value`);
      const r = { x: v.x - v.w / 2, y: v.y - v.height / 2, w: v.w, h: v.height };
      for (const b of boxes) {
        const hit = r.x < b.x + b.w && b.x < r.x + r.w && r.y < b.y + b.h && b.y < r.y + r.h;
        assert.ok(!hit, `${label} (${stage}${working ? ", working zoom" : ""}): value ${v.s}>${v.h} covers "${b.text}"`);
      }
    }
  }
  env.flush();
});
