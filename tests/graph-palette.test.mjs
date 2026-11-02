// SPDX-License-Identifier: MIT
// Tests of the colours (spec 8): theme colours corrected to 3:1, the Okabe–Ito fills for role and power, the fixed
// grey for "no value", with a slash.  node --test "tests/**/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveTheme, receptionColor, parseColor, contrastRatio, MIN_CONTRAST, OKABE_ITO, CATEGORY_FILLS,
  fillColor, lineColorOn, powerCategory, FILLS,
} from "../custom_components/meshroute_topology_explorer/frontend/graph/palette.js";
import { buildScene, drawScene } from "../custom_components/meshroute_topology_explorer/frontend/graph/renderer.js";
import { SLASH } from "../custom_components/meshroute_topology_explorer/frontend/graph/symbols.js";
import { asZigbee, drawnSymbols, recordingContext } from "./graph-fakes.mjs";

test("the grey for 'no value' is a fixed pair, clear of the background and of the neutral grey of the none fill", () => {
  const light = resolveTheme({ background: "#ffffff" });
  const dark = resolveTheme({ background: "#111111" });
  assert.deepEqual([light.node, dark.node], ["#bfbfbf", "#393939"]);
  for (const theme of [light, dark]) {
    assert.ok(contrastRatio(parseColor(theme.node), parseColor(theme.background)) >= 1.5, theme.background);
    assert.notEqual(theme.node, theme.neutral);
  }
});

test("theme colours are corrected to 3:1, unparsable ones fall back to the defaults", () => {
  const theme = resolveTheme({ background: "rgb(250, 250, 250)", accent: "#03a9f4", muted: "#dddddd", foreground: "bogus" });
  for (const key of ["accent", "muted", "outline"]) {
    assert.ok(contrastRatio(parseColor(theme[key]), parseColor(theme.background)) >= MIN_CONTRAST, key);
  }
  assert.equal(theme.foreground, "#212121");
  assert.equal(resolveTheme({ background: "#000" }).dark, true);
});

test("role and power fills: Okabe–Ito colours, 3:1 against light and dark backgrounds, distinct within a fill", () => {
  assert.deepEqual(FILLS, ["none", "role", "power"]);
  for (const background of ["#ffffff", "#fafafa", "#f0f0f0", "#111111", "#1c1c1c", "#303030"]) {
    const theme = resolveTheme({ background });
    for (const fill of ["role", "power"]) {
      const colours = Object.values(theme.categories[fill]);
      assert.equal(new Set(colours).size, colours.length, `${background} ${fill}: distinct`);
      for (const [key, hex] of Object.entries(theme.categories[fill])) {
        assert.ok(contrastRatio(parseColor(hex), parseColor(background)) >= MIN_CONTRAST, `${background} ${fill} ${key}`);
        // Nudged at most a little: the hue family of the published colour survives.
        const source = parseColor(OKABE_ITO[CATEGORY_FILLS[fill][key]]);
        const moved = Math.max(...parseColor(hex).map((v, i) => Math.abs(v - source[i])));
        assert.ok(moved <= 40, `${background} ${fill} ${key} moved ${moved}`);
      }
    }
  }
  // On white the four colours need no correction at all except reddish purple's hair.
  const white = resolveTheme({ background: "#ffffff" });
  assert.equal(white.categories.role.router, OKABE_ITO.bluishGreen);
  assert.equal(white.categories.power.mains, OKABE_ITO.blue);
});

test("fillColor follows the chosen fill; devices without a category stay grey (null)", () => {
  const theme = resolveTheme({});
  const node = { role: "router", rating: 0.5, power: "mains" };
  assert.equal(fillColor(node, "none", theme), theme.neutral, "none: neutral grey, whatever the rating");
  assert.equal(fillColor(node, "role", theme), theme.categories.role.router);
  assert.equal(fillColor(node, "power", theme), theme.categories.power.mains);
  assert.equal(fillColor({ role: "unknown", rating: null, power: null }, "role", theme), null);
  assert.equal(fillColor({ role: "unknown", rating: null, power: null }, "power", theme), null);
  assert.equal(fillColor({ role: "router", rating: null }, "none", theme), theme.neutral);
  assert.equal(resolveTheme({}).neutral, "#c5c8cb");
  assert.equal(resolveTheme({ background: "#111111" }).neutral, "#5c6166");
  assert.equal(powerCategory("Mains (single phase)"), "mains");
  assert.equal(powerCategory("Emergency Mains Constantly Powered"), "mains");
  assert.equal(powerCategory("Battery or Unknown"), "battery");
  assert.equal(powerCategory("DC Source"), "dc");
  assert.equal(powerCategory("Unknown"), null);
  assert.equal(powerCategory(null), null);
});

test("a device without a value under the fill (here: role unknown) is grey with a slash; rated and offline devices have none", () => {
  const network = {
    devices: [
      { id: "a", role: "router", label: "Rated", rating: 0.5 },
      { id: "b", role: "unknown", label: "Unrated", rating: null },
      { id: "c", role: "unknown", label: "Offline", rating: null, available: false },
    ],
    readings: [],
  };
  const scene = buildScene(asZigbee(network), (text) => text.length * 7);
  const ctx = recordingContext();
  const theme = resolveTheme({});
  const pos = { x: [0, 100, 200], y: [0, 0, 0], pinned: [0, 0, 0], mesh: [1, 1, 1] };
  drawScene(ctx, scene, pos, { cam: { k: 1, cx: 100, cy: 0 }, width: 400, height: 200, dpr: 1, labelZoom: 1,
    debug: false, selected: -1, hovered: -1, fps: null, fill: "role" }, theme, (text) => text.length * 7);
  // The slash runs from lower left to upper right across the symbol's background (symbols.js SLASH, grid units).
  const slashes = drawnSymbols(ctx.calls, 1).filter((sym) => sym.calls.some((c, j) => c[0] === "moveTo"
    && c[1] === SLASH[0] && c[2] === SLASH[1] && sym.calls[j + 1][0] === "lineTo" && sym.calls[j + 1][1] === SLASH[2]))
    .map((sym) => Math.round(sym.x));
  assert.deepEqual(slashes.map((x) => x - 200), [0], "only the unrated device (drawn at x = 200) has a slash");
});

test("the none fill draws every available symbol neutral grey with foreground lines and no slash", () => {
  const network = { devices: [
    { id: "a", role: "router", label: "Rated", rating: 0.9 }, { id: "b", role: "router", label: "Unrated", rating: null },
  ], readings: [] };
  for (const background of ["#ffffff", "#111111"]) {
    const scene = buildScene(asZigbee(network), (text) => text.length * 7);
    const ctx = recordingContext({ props: true });
    const theme = resolveTheme({ background });
    const pos = { x: [0, 100], y: [0, 0], pinned: [0, 0], mesh: [1, 1] };
    drawScene(ctx, scene, pos, { cam: { k: 1, cx: 50, cy: 0 }, width: 400, height: 200, dpr: 1, labelZoom: 1,
      debug: false, selected: -1, hovered: -1, fps: null, fill: "none" }, theme, (text) => text.length * 7);
    const symbols = drawnSymbols(ctx.calls, 1);
    assert.equal(symbols.length, 2);
    for (const sym of symbols) {
      const set = (key) => sym.calls.filter((c) => c[0] === "set" && c[1] === key).map((c) => c[2]);
      assert.ok(set("fillStyle").includes(theme.neutral), `${background}: neutral fill`);
      assert.ok(set("strokeStyle").length > 0 && set("strokeStyle").every((v) => v === theme.foreground), `${background}: foreground lines`);
      assert.ok(!sym.calls.some((c) => c[0] === "moveTo" && c[1] === SLASH[0] && c[2] === SLASH[1]), "no slash");
    }
  }
});

test("symbol lines keep 3:1 against every fill the map uses, in light and dark themes", () => {
  // Pictures sit on the fill (spec 8): the lines take the theme's foreground or background, whichever is clearer.
  for (const background of ["#ffffff", "#fafafa", "#111111", "#1c1c1c"]) {
    const theme = resolveTheme({ background });
    const fills = [theme.node, theme.background, ...Object.values(theme.categories).flatMap(Object.values)];
    for (let r = 0; r <= 1.0001; r += 0.01) fills.push(receptionColor(r, theme));
    for (const fill of fills) {
      const line = lineColorOn(fill, theme);
      assert.ok([theme.foreground, theme.background].includes(line));
      assert.ok(contrastRatio(parseColor(line), parseColor(fill)) >= 3, `${background}: ${line} on ${fill}`);
    }
  }
  assert.equal(lineColorOn("#00204d", resolveTheme({})), resolveTheme({}).background, "light lines on navy");
});
