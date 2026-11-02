// SPDX-License-Identifier: MIT
// Tests of the quality-view layout (spec 7.1, 12): spring curve, determinism, fidelity on the sample in every
// density (one base layout drawn at base x D), speed on a synthetic network, the unknown ring, pinning, Barnes-Hut.
// node --test "tests/**/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  Layout, DENSITY, SETTLE_MOVE, springFactor, baseLength, seededRandom,
} from "../custom_components/meshroute_topology_explorer/frontend/graph/layout.js";
import { buildQuadtree, quadtreeForce } from "../custom_components/meshroute_topology_explorer/frontend/graph/quadtree.js";
import { displayLabels } from "../custom_components/meshroute_topology_explorer/frontend/graph/labels.js";
import { NODE_DIAMETER } from "../custom_components/meshroute_topology_explorer/frontend/graph/renderer.js";
import { buildNetwork } from "../custom_components/meshroute_topology_explorer/frontend/engines/zigbee/model.js";
import { syntheticNetwork } from "./synthetic-network.mjs";
import { fidelity, spearman } from "./fidelity.mjs";
import { labelWidth as measure } from "./graph-fakes.mjs";
import { springQuality as quality } from "../custom_components/meshroute_topology_explorer/frontend/engines/zigbee/lanes.js";

const responses = JSON.parse(readFileSync(new URL("./fixtures/zha-sample.json", import.meta.url), "utf8")).responses;
const sample = buildNetwork(responses["zha/devices"], { deviceRegistry: responses["config/device_registry/list"],
  areaRegistry: responses["config/area_registry/list"], configEntries: responses["config_entries/get"] });
const l0Of = (network) => baseLength(displayLabels(network.devices, measure), measure, NODE_DIAMETER);
const report = (t, msg) => (t.diagnostic ? t.diagnostic(msg) : console.log(msg));

test("spring factor follows f(q) = 1 + 5 (1 - q)^2; LQI 0 or no value has none", () => {
  // The layout takes a quality 0..1 from the engine (engines cut step 6c); Zigbee's is LQI / 255.
  assert.equal(springFactor(quality({ lqi: 255 })), 1);
  assert.equal(springFactor(0.5), 1 + 5 * 0.25);
  assert.ok(Math.abs(springFactor(quality({ lqi: 1 })) - (1 + 5 * (254 / 255) ** 2)) < 1e-12);
  for (const unknown of [0, null, undefined, NaN, "157", -3]) assert.equal(springFactor(unknown), null, "no spring");
  for (const unknown of [0, null, undefined, NaN, "157", -3]) assert.equal(quality({ lqi: unknown }), null, "no spring");
  for (let v = 1; v < 255; v++) {
    assert.ok(springFactor(quality({ lqi: v })) > springFactor(quality({ lqi: v + 1 })), "strictly falling");
  }
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
  const a = new Layout(sample, { quality, baseLength: 90, seed: 3 });
  a.run();
  const rnd = seededRandom(99);
  const shuffle = (list) => list.map((v) => [rnd(), v]).sort((p, q) => p[0] - q[0]).map((p) => p[1]);
  const b = new Layout({ ...sample, devices: shuffle(sample.devices), readings: shuffle(sample.readings) },
    { quality, baseLength: 90, seed: 3 });
  b.run();
  assert.deepEqual([...a.x], [...b.x]);
  assert.deepEqual([...a.y], [...b.y]);
  const c = new Layout(sample, { quality, baseLength: 90, seed: 4 });
  c.run();
  assert.notDeepEqual([...a.x], [...c.x]);
});

test("fidelity on the sample: rank correlation of drawn length and LQI <= -0.75 in every density (seed 1)", (t) => {
  // The map computes one layout in base units (D = 1) and draws it at base x D (spec 7.1): every density shows the
  // same proportions, so the correlation is the same in each.
  const l0 = l0Of(sample);
  const layout = new Layout(sample, { quality, baseLength: l0, density: 1, seed: 1 });
  layout.run();
  assert.ok(layout.lastMove < SETTLE_MOVE, "settled by movement, not by the step budget");
  assert.ok(layout.temperature > SETTLE_MOVE, "by balance: the cooling cap was not what stopped it");
  const known = layout.springLengths().filter((x) => x.quality !== null);
  const rhos = Object.entries(DENSITY).map(([name, d]) => {
    const rho = spearman(known.map((x) => x.length * d), known.map((x) => x.quality));
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
  // The target is computing time (spec 12). Measured in a child process with V8's --single-threaded flag
  // (tests/layout-time.mjs; decision of the main session, 2026-11-01, brief eng1), as for a click: in this process the
  // CPU time also counted the compiler's and garbage collector's helper threads, and beside the other suites on a
  // loaded machine it once exceeded 5 s (2026-11-01). Best of three runs of the same deterministic layout.
  const out = execFileSync(process.execPath, ["--single-threaded", fileURLToPath(new URL("./layout-time.mjs", import.meta.url))],
    { encoding: "utf8" });
  const r = JSON.parse(out);
  assert.equal(r.devices, 300);
  assert.equal(r.readings, 3000);
  // About 0.9 to 1.2 s here alone (2026-11-01, Node 18 under WSL, brief eng1); the limit is spec 12's.
  report(t, `synthetic 300/3000: settled in ${r.ms} ms CPU (${r.wallMs} ms wall), ${r.steps} steps, ` +
    `largest last move ${r.lastMove.toFixed(3)}, fidelity ${r.fidelity.toFixed(3)}`);
  assert.ok(r.lastMove < SETTLE_MOVE, "settled by movement, not by the step budget");
  assert.ok(r.temperature > SETTLE_MOVE, "by balance: the cooling cap was not what stopped it");
  assert.ok(r.ms < 5000, `${r.ms} ms CPU`);
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
  const layout = new Layout(net, { quality, baseLength: 80, seed: 2 });
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
    { quality, baseLength: 100 });
  layout.run();
  const ring = layout.ringIds().map((id) => layout.position(id));
  const chords = ring.map((p, i) => Math.hypot(ring[(i + 1) % ring.length].x - p.x, ring[(i + 1) % ring.length].y - p.y));
  assert.ok(Math.max(...chords) - Math.min(...chords) < 1e-3 * Math.max(...chords), chords.join()); // polyline arc
});

test("on the sample the ring adds at most K to the mesh's height", () => {
  const layout = new Layout(sample, { quality, baseLength: l0Of(sample), seed: 1 });
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
  const layout = new Layout(sample, { quality, baseLength: 90, seed: 1, pinned });
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
  }, { quality, baseLength: 100 });
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
  }, { quality, baseLength: 100 });
  assert.equal(layout.rest.length, 1);
  assert.equal(layout.springQuality[0], 180 / 255);
  assert.equal(layout.rest[0], 100 * springFactor(180 / 255));
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
  const layout = new Layout(net, { quality, baseLength: l0Of(net), seed: 1, params: { exactBelow: 0 } });
  layout.run();
  assert.ok(layout.lastMove < SETTLE_MOVE);
  assert.ok(fidelity(layout) <= -0.75);
});
