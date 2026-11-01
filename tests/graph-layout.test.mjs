// SPDX-License-Identifier: MIT
// Tests of the quality-view layout (spec 7.1, 12): spring curve, determinism, fidelity on the sample in every
// density (one base layout drawn at base x D), speed on a synthetic network, the unknown ring, pinning, Barnes-Hut.
// node --test "tests/**/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  Layout, DENSITY, SETTLE_MOVE, springFactor, baseLength, seededRandom,
} from "../custom_components/meshroute_topology_explorer/frontend/graph/layout.js";
import { buildQuadtree, quadtreeForce } from "../custom_components/meshroute_topology_explorer/frontend/graph/quadtree.js";
import { displayLabels } from "../custom_components/meshroute_topology_explorer/frontend/graph/labels.js";
import { NODE_DIAMETER } from "../custom_components/meshroute_topology_explorer/frontend/graph/renderer.js";
import { buildNetwork } from "../custom_components/meshroute_topology_explorer/frontend/model/index.js";
import { syntheticNetwork } from "./synthetic-network.mjs";
import { fidelity, spearman } from "./fidelity.mjs";
import { labelWidth as measure } from "./graph-fakes.mjs";

const responses = JSON.parse(readFileSync(new URL("./fixtures/zha-sample.json", import.meta.url), "utf8")).responses;
const sample = buildNetwork(responses["zha/devices"], { deviceRegistry: responses["config/device_registry/list"],
  areaRegistry: responses["config/area_registry/list"], configEntries: responses["config_entries/get"] });
const l0Of = (network) => baseLength(displayLabels(network.devices, measure), measure, NODE_DIAMETER);
const report = (t, msg) => (t.diagnostic ? t.diagnostic(msg) : console.log(msg));

test("spring factor follows f(q) = 1 + 5 (1 - q)^2; LQI 0 or no value has none", () => {
  assert.equal(springFactor(255), 1);
  assert.equal(springFactor(127.5), 1 + 5 * 0.25);
  assert.ok(Math.abs(springFactor(1) - (1 + 5 * (254 / 255) ** 2)) < 1e-12);
  for (const unknown of [0, null, undefined, NaN, "157", -3]) assert.equal(springFactor(unknown), null, "no spring");
  for (let v = 1; v < 255; v++) assert.ok(springFactor(v) > springFactor(v + 1), "strictly falling");
});

test("L0 is node diameter plus mean label width, with an injected measure", () => {
  const fixed = (text) => text.length * 7;
  assert.equal(baseLength(["ab", "abcd"], fixed, 16), 16 + 21);
  assert.equal(baseLength([], fixed, 16), 16);
});

test("positions use only + - * / and sqrt: no engine-dependent maths in layout.js and quadtree.js", () => {
  for (const file of ["layout.js", "quadtree.js"]) {
    const code = readFileSync(new URL(`../custom_components/meshroute_topology_explorer/frontend/graph/${file}`,
      import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    for (const banned of [/Math\.(sin|cos|tan|atan2?|hypot|exp|log\w*|pow|cbrt)\b/, /\*\*/]) {
      assert.ok(!banned.test(code), `${file}: ${banned}`);
    }
  }
});

test("same network and seed give the same layout, whatever the input order; another seed differs", () => {
  const a = new Layout(sample, { baseLength: 90, seed: 3 });
  a.run();
  const rnd = seededRandom(99);
  const shuffle = (list) => list.map((v) => [rnd(), v]).sort((p, q) => p[0] - q[0]).map((p) => p[1]);
  const b = new Layout({ ...sample, devices: shuffle(sample.devices), readings: shuffle(sample.readings) },
    { baseLength: 90, seed: 3 });
  b.run();
  assert.deepEqual([...a.x], [...b.x]);
  assert.deepEqual([...a.y], [...b.y]);
  const c = new Layout(sample, { baseLength: 90, seed: 4 });
  c.run();
  assert.notDeepEqual([...a.x], [...c.x]);
});

test("fidelity on the sample: rank correlation of drawn length and LQI <= -0.75 in every density (seed 1)", (t) => {
  // The map computes one layout in base units (D = 1) and draws it at base x D (spec 7.1): every density shows the
  // same proportions, so the correlation is the same in each.
  const l0 = l0Of(sample);
  const layout = new Layout(sample, { baseLength: l0, density: 1, seed: 1 });
  layout.run();
  assert.ok(layout.lastMove < SETTLE_MOVE, "settled by movement, not by the step budget");
  assert.ok(layout.temperature > SETTLE_MOVE, "by balance: the cooling cap was not what stopped it");
  const known = layout.springLengths().filter((x) => x.lqi !== null);
  const rhos = Object.entries(DENSITY).map(([name, d]) => {
    const rho = spearman(known.map((x) => x.length * d), known.map((x) => x.lqi));
    report(t, `fidelity ${name} (D=${d}, L0=${l0.toFixed(1)}): ${rho.toFixed(3)} after ${layout.steps} steps`);
    assert.ok(rho <= -0.75, `${name}: ${rho}`);
    return rho;
  });
  assert.ok(rhos.every((r) => Math.abs(r - rhos[0]) < 1e-12), "identical in every density");
  assert.equal(fidelity(layout), rhos[1]);
});

test("Spearman helper: perfect, inverse and tied ranks", () => {
  assert.equal(spearman([1, 2, 3], [10, 20, 30]), 1);
  assert.equal(spearman([1, 2, 3], [30, 20, 10]), -1);
  assert.ok(Math.abs(spearman([1, 1, 2, 3], [1, 2, 3, 4]) - 0.9486832980505138) < 1e-12);
});

test("density factors are pinned: dense 0.96, medium 1.44, spread 2.28 (spec 7.1; former 0.7 / 1 / 1.5, then 0.8 / 1.2 / 1.9)", () => {
  assert.deepEqual({ ...DENSITY }, { dense: 0.96, medium: 1.44, spread: 2.28 });
});

test("speed: 300 devices and 3 000 readings settle within 5 s", (t) => {
  const net = syntheticNetwork({ devices: 300, readings: 3000, seed: 7 });
  assert.equal(net.devices.length, 300);
  assert.equal(net.readings.length, 3000);
  // The target is computing time (spec 12): node runs all test files at once, so wall time on a busy machine measured
  // the scheduler (6.3 s once in nine runs, 1.5 s alone). Process CPU time is not free of load either: with more
  // runnable processes than cores it grows to 2-3 times (shared caches and hyperthreads, 4.6 s measured with 12
  // busy loops on 8 cores, 1.6 s alone). So the limit applies to the best of up to three runs of the same layout
  // (the layout is deterministic, the first run under the limit ends the loop; a quiet machine runs it once).
  let ms = Infinity;
  let layout;
  let wallMs = 0;
  for (let attempt = 0; attempt < 3 && ms >= 5000; attempt++) {
    layout = new Layout(net, { baseLength: l0Of(net), seed: 1 });
    const wall = performance.now();
    const cpu = process.cpuUsage();
    layout.run();
    const used = process.cpuUsage(cpu);
    ms = Math.min(ms, (used.user + used.system) / 1000);
    wallMs = performance.now() - wall;
  }
  report(t, `synthetic 300/3000: settled in ${ms.toFixed(0)} ms CPU (${wallMs.toFixed(0)} ms wall), ${layout.steps} steps, ` +
    `largest last move ${layout.lastMove.toFixed(3)}, fidelity ${fidelity(layout).toFixed(3)}`);
  assert.ok(layout.lastMove < SETTLE_MOVE, "settled by movement, not by the step budget");
  assert.ok(layout.temperature > SETTLE_MOVE, "by balance: the cooling cap was not what stopped it");
  assert.ok(ms < 5000, `${ms} ms CPU`);
});

test("devices without readings sit evenly on an ellipse just outside the mesh, in id order from the top", () => {
  const net = {
    devices: ["a", "b", "c", "d", "e", "x3", "x1", "x2", "x4"].map((id) => ({ id })),
    readings: [
      { reporter: "a", subject: "b", lqi: 200 }, { reporter: "b", subject: "c", lqi: 90 },
      { reporter: "c", subject: "d", lqi: 30 }, { reporter: "d", subject: "e", lqi: 140 },
      { reporter: "a", subject: "ghost", lqi: 50 }, // unknown device: ignored
    ],
  };
  const layout = new Layout(net, { baseLength: 80, seed: 2 });
  layout.run();
  assert.deepEqual(layout.ringIds(), ["x1", "x2", "x3", "x4"]);
  const { x: cx, y: cy, a, b } = layout.ringShape;
  const mesh = layout.meshIds().map((id) => layout.position(id));
  const box = { w: Math.max(...mesh.map((p) => p.x)) - Math.min(...mesh.map((p) => p.x)),
    h: Math.max(...mesh.map((p) => p.y)) - Math.min(...mesh.map((p) => p.y)) };
  assert.ok(Math.abs(a - (box.w / 2 + layout.K / 2)) < 1e-9 && Math.abs(b - (box.h / 2 + layout.K / 2)) < 1e-9,
    "half-axes: the mesh box plus K/2");
  const ring = layout.ringIds().map((id) => layout.position(id));
  for (const p of ring) {
    const e = ((p.x - cx) / a) ** 2 + ((p.y - cy) / b) ** 2;
    assert.ok(e >= 1 - 1e-3, "on or outside the ellipse");
    for (const q of mesh) assert.ok(Math.hypot(p.x - q.x, p.y - q.y) >= layout.K / 2 - 1e-9, "clear of the mesh");
  }
  assert.ok(Math.abs(ring[0].x - cx) < 1e-6 && ring[0].y < cy, "first one at the top");
  assert.ok(ring[1].x > cx, "then clockwise on screen (to the right)");
});

test("ring places are spaced evenly by arc length", () => {
  // No mesh: the ring is the bare ellipse, so every place is unmoved.
  const layout = new Layout({ devices: ["p", "q", "r", "s", "t", "u"].map((id) => ({ id })), readings: [] },
    { baseLength: 100 });
  layout.run();
  const ring = layout.ringIds().map((id) => layout.position(id));
  const chords = ring.map((p, i) => Math.hypot(ring[(i + 1) % ring.length].x - p.x, ring[(i + 1) % ring.length].y - p.y));
  assert.ok(Math.max(...chords) - Math.min(...chords) < 1e-3 * Math.max(...chords), chords.join()); // polyline arc
});

test("on the sample the ring adds at most K to the mesh's height", () => {
  const layout = new Layout(sample, { baseLength: l0Of(sample), seed: 1 });
  layout.run();
  assert.ok(layout.ringIds().length >= 1);
  const ys = (ids) => ids.map((id) => layout.position(id).y);
  const meshH = Math.max(...ys(layout.meshIds())) - Math.min(...ys(layout.meshIds()));
  const allH = Math.max(...ys(layout.ids)) - Math.min(...ys(layout.ids));
  assert.ok(allH - meshH <= layout.K + 1e-6, `${allH} vs ${meshH}`);
});

test("pinned devices stay where they are, the others still settle", () => {
  const ids = sample.devices.map((d) => d.id).sort();
  const pinned = new Map([[ids[1], { x: 500, y: -300 }], [ids[5], { x: -200, y: 40 }]]);
  const layout = new Layout(sample, { baseLength: 90, seed: 1, pinned });
  layout.run();
  for (const [id, p] of pinned) {
    assert.deepEqual(layout.position(id), p);
    assert.ok(layout.isPinned(id));
  }
  // Pin after settling, reheat: the pinned device keeps its place, its neighbours move.
  const before = ids.map((id) => layout.position(id));
  layout.pin(ids[10], 900, 900);
  layout.reheat();
  layout.run();
  assert.deepEqual(layout.position(ids[10]), { x: 900, y: 900 });
  assert.ok(ids.some((id, i) => id !== ids[10] && !pinned.has(id) &&
    Math.hypot(layout.position(id).x - before[i].x, layout.position(id).y - before[i].y) > 1));
  layout.unpin(ids[10]);
  assert.equal(layout.isPinned(ids[10]), false);
});

test("LQI 0, no value and readings marked unmeasured are no springs: such devices go to the ring", () => {
  const layout = new Layout({
    devices: ["a", "b", "c", "d"].map((id) => ({ id })),
    readings: [
      { reporter: "a", subject: "b", lqi: 120 }, { reporter: "b", subject: "c", lqi: 0 },
      { reporter: "c", subject: "d", lqi: null }, { reporter: "d", subject: "a", lqi: 80, measured: false },
    ],
  }, { baseLength: 100 });
  assert.equal(layout.rest.length, 1);
  assert.deepEqual(layout.ringIds(), ["c", "d"]);
});

test("duplicate readings keep the better value; self and unknown readings are dropped", () => {
  const layout = new Layout({
    devices: [{ id: "a" }, { id: "b" }],
    readings: [
      { reporter: "a", subject: "b", lqi: 0 }, { reporter: "a", subject: "b", lqi: 180 },
      { reporter: "a", subject: "b", lqi: 20 }, { reporter: "a", subject: "a", lqi: 255 },
      { reporter: "b", subject: "z", lqi: 255 }, null,
    ],
  }, { baseLength: 100 });
  assert.equal(layout.rest.length, 1);
  assert.equal(layout.springLqi[0], 180);
  assert.equal(layout.rest[0], 100 * springFactor(180));
});

test("Barnes-Hut: exact at theta 0, and a forced Barnes-Hut layout still settles faithfully", () => {
  const rnd = seededRandom(5);
  const xs = Float64Array.from({ length: 200 }, () => rnd() * 1000);
  const ys = Float64Array.from({ length: 200 }, () => rnd() * 1000);
  const idx = [...xs.keys()];
  const tree = buildQuadtree(idx, xs, ys);
  for (const i of [0, 17, 199]) {
    let ex = 0; let ey = 0;
    for (const j of idx) {
      if (j === i) continue;
      const dx = xs[i] - xs[j]; const dy = ys[i] - ys[j]; const d2 = dx * dx + dy * dy;
      ex += (dx * 50) / d2; ey += (dy * 50) / d2;
    }
    const [fx, fy] = quadtreeForce(tree, i, xs[i], ys[i], 50, 0);
    assert.ok(Math.abs(fx - ex) < 1e-9 && Math.abs(fy - ey) < 1e-9);
    const [ax, ay] = quadtreeForce(tree, i, xs[i], ys[i], 50, 0.8);
    assert.ok(Math.hypot(ax - ex, ay - ey) < 0.1 * Math.hypot(ex, ey) + 1e-6, "approximation within 10 %");
  }
  const net = syntheticNetwork({ devices: 300, readings: 3000, seed: 7 });
  const layout = new Layout(net, { baseLength: l0Of(net), seed: 1, params: { exactBelow: 0 } });
  layout.run();
  assert.ok(layout.lastMove < SETTLE_MOVE);
  assert.ok(fidelity(layout) <= -0.75);
});
