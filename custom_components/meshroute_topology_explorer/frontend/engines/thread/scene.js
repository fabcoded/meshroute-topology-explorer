// SPDX-License-Identifier: MIT
// What a Thread map draws (spec 3.2, 4.6, 7.1; engines cut, section 2): Thread data names neighbours and parents, not
// routes, so there are no views and no paths. The overview draws every lane with a class, parent links solid
// ("parent", the end device's lane to its parent above the parent's lane back) and measured neighbours dashed
// ("neighbour"); debug mode every lane. A click shows the device's own lanes with their values and the glyph of each
// own direction without a reading: no band, no unknown ends. The shared renderer (graph/renderer.js) strokes the looks.
// Pure. node --test tests/
import { classifyLanes } from "./lanes.js";

/** Counters of the drawn lanes per class (graph/renderer.js drawScene stats). */
export const CLASSES = Object.freeze(["neighbour", "parent"]);

/** The look of a lane of class `cls` ("parent", "neighbour" or null); rank orders the drawing, the end device's lane to
 *  its parent on top. */
function look(cls, toParent = false) {
  if (cls === "parent") return { cls, stroke: "solid", rank: toParent ? 4 : 3, assumed: false, predicted: false };
  if (cls === "neighbour") return { cls, stroke: "dashed", rank: 1, assumed: false, predicted: false };
  return { cls: null, stroke: "faint", rank: 0, assumed: false, predicted: false };
}

/** Pairs and lanes from the network (shared renderer, buildScene): the meaning of each lane is { toParent,
 *  fromParent }. */
export function lanes(network) {
  const c = classifyLanes(network);
  return { pairs: c.pairs, lanes: c.lanes.map(({ pair, sender, hearer, dir, toParent, fromParent }) =>
    ({ pair, sender, hearer, dir, meaning: { toParent, fromParent } })) };
}

/** The class of every lane, once per scene (idempotent): parent where it is a parent link, neighbour where the
 *  direction was measured, else none. */
export function classify(scene) {
  if (scene.classes) return scene;
  scene.classes = scene.lanes.map((l) => (l.toParent || l.fromParent ? "parent"
    : l.dir && l.dir.state === "measured" ? "neighbour" : null));
  scene.lookCache = new Map();
  return scene;
}

/** Cache key of the engine's view: only debug mode changes what a Thread map draws. */
export function viewKey(view) {
  return view && view.debug ? "debug" : "plain";
}

/** Per lane its look in the overview, or null: every lane with a class; in debug mode every lane. */
export function overview(scene, view) {
  classify(scene);
  const key = viewKey(view);
  if (!scene.lookCache.has(key)) {
    const debug = key === "debug";
    scene.lookCache.set(key, scene.lanes.map((l, i) => (debug || scene.classes[i]
      ? look(scene.classes[i], l.toParent) : null)));
  }
  return scene.lookCache.get(key);
}

/** The focus of device i: its own lanes, each with its class and value, and the glyph of each own direction without
 *  a reading (the renderer draws them on click). { hops: [{ s, h, dir, cls, stroke, rank, assumed, predicted }], ends: [], glyphs: [{ s, h,
 *  dir }], nodes: Set (i and its partners), band: null }. */
export function focus(scene, i) {
  classify(scene);
  const hops = [];
  const glyphs = [];
  const nodes = new Set([i]);
  for (const pair of scene.pairs) {
    if (pair.a !== i && pair.b !== i) continue;
    nodes.add(pair.a);
    nodes.add(pair.b);
    for (const li of pair.lanes) {
      const lane = scene.lanes[li];
      if (scene.classes[li]) hops.push({ s: lane.s, h: lane.h, dir: lane.dir, ...look(scene.classes[li], lane.toParent) });
      else glyphs.push({ s: lane.s, h: lane.h, dir: lane.dir });
    }
  }
  return { hops, ends: [], glyphs, nodes, band: null };
}
