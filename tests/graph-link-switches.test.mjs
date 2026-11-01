// SPDX-License-Identifier: MIT
// The link class switches (decision by Fabian Schwamborn, 2026-11-01; spec 9.1, 11): which pairs are drawn for each
// combination of Up path / Other routes / Heard only, selection and debug mode overriding them, the legend following,
// the stored values cleaned as untrusted input, and the layout never moving when a switch is flipped.
// node --test "tests/**/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_LINKS, legendEntries, pairDrawn } from "../custom_components/meshroute_topology_explorer/frontend/graph/links.js";
import { buildScene, drawScene } from "../custom_components/meshroute_topology_explorer/frontend/graph/renderer.js";
import { GraphView } from "../custom_components/meshroute_topology_explorer/frontend/graph/graph-view.js";
import { resolveTheme } from "../custom_components/meshroute_topology_explorer/frontend/graph/palette.js";
import { sanitizeLinks, sanitizeSettings, DEFAULTS } from "../custom_components/meshroute_topology_explorer/frontend/ui/settings.js";
import { LINK_CLASSES } from "../custom_components/meshroute_topology_explorer/frontend/ui/links-rows.js";
import { STRINGS } from "../custom_components/meshroute_topology_explorer/frontend/ui/i18n.js";
import { FakeCanvas, fakeEnv, recordingContext, labelWidth } from "./graph-fakes.mjs";

const theme = resolveTheme({});
const dir = (state, lqi = null, rating = null) => ({ state, lqi, rating, source: "table", reason: null });
// c - r1 up path, r1 - r2 route, r2 - r3 heard only.
const NET = {
  devices: ["c", "r1", "r2", "r3"].map((id, i) => ({ id, role: i ? "router" : "coordinator", label: id, available: true })),
  readings: [],
  routes: [
    { owner: "r1", destination: "c", nextHop: "c", status: "Active", stale: false },
    { owner: "r2", destination: "r1", nextHop: "r1", status: "Active", stale: false },
  ],
  pairs: [
    { a: "c", b: "r1", ab: dir("measured", 200, 0.9), ba: dir("measured", 120, 0.5) },
    { a: "r1", b: "r2", ab: dir("measured", 100, 0.5), ba: dir("measured", 100, 0.5) },
    { a: "r2", b: "r3", ab: dir("measured", 60, 0.2), ba: dir("measured", 60, 0.2) },
  ],
};
const POS = { x: [-300, 0, 300, 600], y: [0, 0, 0, 0], pinned: [0, 0, 0, 0], mesh: [1, 1, 1, 1] };

function classesDrawn(links, extra = {}) {
  const scene = buildScene(NET, labelWidth);
  const stats = drawScene(recordingContext({ props: true }), scene, POS, { cam: { k: 1, cx: 150, cy: 0 }, width: 1400,
    height: 800, dpr: 1, labelZoom: 1, debug: false, links, selected: -1, hovered: -1, fps: null, fill: "none",
    ...extra }, theme, labelWidth);
  return stats.classes;
}

test("each combination of switches draws exactly the classes that are on", () => {
  for (let mask = 0; mask < 8; mask++) {
    const links = { up: Boolean(mask & 1), route: Boolean(mask & 2), heard: Boolean(mask & 4) };
    assert.deepEqual(classesDrawn(links), { heard: links.heard ? 1 : 0, route: links.route ? 1 : 0, up: links.up ? 1 : 0 },
      JSON.stringify(links));
  }
  assert.deepEqual(classesDrawn(undefined), { heard: 1, route: 1, up: 1 }, "no switches given: today's picture");
});

test("a selected device and debug mode show everything, switches or not", () => {
  const off = { up: false, route: false, heard: false };
  assert.deepEqual(classesDrawn(off, { debug: true }), { heard: 1, route: 1, up: 1 });
  // r2 (index 2) touches the route pair and the heard pair, but not the up pair.
  assert.deepEqual(classesDrawn(off, { selected: 2 }), { heard: 1, route: 1, up: 0 });
  assert.deepEqual(classesDrawn(off, { hovered: 0 }), { heard: 0, route: 0, up: 1 });
});

test("pairDrawn: the heard-only rule (best per device) still applies when the class is on", () => {
  assert.equal(pairDrawn({ cls: "heard", shown: false }, DEFAULT_LINKS), false);
  assert.equal(pairDrawn({ cls: "heard", shown: true }, DEFAULT_LINKS), true);
  assert.equal(pairDrawn({ cls: "heard", shown: false }, DEFAULT_LINKS, { debug: true }), true);
  assert.equal(pairDrawn({ cls: "up", shown: true }, { ...DEFAULT_LINKS, up: false }), false);
});

test("a class that is switched off leaves the legend, debug mode keeps all", () => {
  const ids = (o) => legendEntries(theme, o).map((e) => e.id);
  assert.deepEqual(ids({ links: { up: true, route: false, heard: false } }).filter((i) => LINK_CLASSES.includes(i)), ["up"]);
  assert.ok(ids({ links: { up: false, route: false, heard: false }, debug: true }).includes("heard"));
  assert.ok(ids().includes("implied") && ids().includes("width"), "the other entries stay");
});

test("stored link switches: booleans kept, anything else falls back to on, the key is in the defaults", () => {
  assert.deepEqual(DEFAULTS.links, { up: true, route: true, heard: true });
  assert.deepEqual(sanitizeLinks({ up: false, route: "no", heard: 0, extra: 1 }), { up: false, route: true, heard: true });
  for (const bad of [null, undefined, 5, "x", [], [false]]) assert.deepEqual(sanitizeLinks(bad), DEFAULT_LINKS);
  assert.deepEqual(sanitizeSettings({ links: { heard: false } }).links, { up: true, route: true, heard: false });
  assert.deepEqual(sanitizeSettings({ links: "off" }).links, DEFAULT_LINKS);
  // round trip through JSON, as the integration stores it
  const links = { up: true, route: false, heard: false };
  assert.deepEqual(sanitizeSettings(JSON.parse(JSON.stringify(sanitizeSettings({ links })))).links, links);
});

test("texts for the switches exist in both languages", () => {
  for (const lang of ["en", "de"]) {
    for (const key of ["options.links", "links.title", "links.density", ...LINK_CLASSES.map((c) => `links.${c}`)]) {
      assert.ok(STRINGS[lang][key] && STRINGS[lang][key].trim(), `${lang} ${key}`);
    }
  }
});

test("flipping switches never moves a device; the legend of the view follows", () => {
  const canvas = new FakeCanvas(800, 600);
  const env = fakeEnv();
  const view = new GraphView(canvas, { env });
  view.setNetwork(NET);
  env.flush();
  const before = JSON.stringify([...view.pos.x, ...view.pos.y]);
  view.setLinks({ up: false, route: false, heard: false });
  env.flush();
  assert.equal(JSON.stringify([...view.pos.x, ...view.pos.y]), before);
  assert.deepEqual(view.legend().map((e) => e.id).filter((i) => LINK_CLASSES.includes(i)), []);
  view.setLinks({ up: true, route: "junk" });
  assert.deepEqual(view.links, DEFAULT_LINKS, "bad values fall back to on");
  assert.equal(JSON.stringify([...view.pos.x, ...view.pos.y]), before);
});
