// SPDX-License-Identifier: MIT
// Tests of the colours (spec 8): the published cividis values, ratings drawn with 3:1 against light and dark
// backgrounds, theme colours corrected to 3:1, unknown values without colour, the Okabe–Ito fills for role and power,
// the grey for "no value" clear of the scale, with a slash.  node --test "tests/**/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveTheme, ratingColor, parseColor, contrastRatio, cividis, toHex, MIN_CONTRAST, OKABE_ITO, CATEGORY_FILLS,
  fillColor, powerCategory, FILLS, toLab, deltaE,
} from "../custom_components/meshroute_topology_explorer/frontend/graph/palette.js";
import { buildScene, drawScene } from "../custom_components/meshroute_topology_explorer/frontend/graph/renderer.js";
import { recordingContext } from "./graph-fakes.mjs";

test("cividis passes through the 17 published values at t = 0, 1/16, ..., 1", () => {
  const published = ["#00204d", "#002c69", "#05366e", "#2d426c", "#414d6b", "#52596c", "#61646f", "#6f7073",
    "#7c7c78", "#8b8779", "#9b9477", "#aca174", "#bcaf6f", "#cebc68", "#e0cb5e", "#f2da50", "#ffea46"];
  published.forEach((hex, i) => assert.equal(toHex(cividis(i / 16)), hex));
  const lum = (t) => contrastRatio(cividis(t), [0, 0, 0]);
  for (let t = 0; t < 1; t += 0.01) assert.ok(lum(t + 0.01) > lum(t), "lightness rises throughout");
});

test("every rating colour reaches 3:1 against common light and dark backgrounds", (t) => {
  for (const background of ["#ffffff", "#fafafa", "#f0f0f0", "#111111", "#1c1c1c", "#303030"]) {
    const theme = resolveTheme({ background });
    assert.equal(theme.lineRange.casing, false, background);
    t.diagnostic && t.diagnostic(`${background}: cividis ${theme.lineRange.lo}..${theme.lineRange.hi}`);
    for (let r = 0; r <= 1.0001; r += 0.01) {
      assert.ok(contrastRatio(parseColor(ratingColor(r, theme)), parseColor(background)) >= MIN_CONTRAST, `${background} ${r}`);
    }
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

test("unknown ratings have no colour; higher ratings are lighter on light and on dark themes", () => {
  for (const theme of [resolveTheme({}), resolveTheme({ background: "#111111" })]) {
    for (const v of [null, undefined, NaN, "0.5"]) assert.equal(ratingColor(v, theme), null);
    const lum = (r) => contrastRatio(parseColor(ratingColor(r, theme)), [0, 0, 0]);
    assert.ok(lum(1) > lum(0.5) && lum(0.5) > lum(0));
  }
});

test("role and power fills: Okabe–Ito colours, 3:1 against light and dark backgrounds, distinct within a fill", () => {
  assert.deepEqual(FILLS, ["reception", "role", "power"]);
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
  assert.equal(fillColor(node, "reception", theme), ratingColor(0.5, theme));
  assert.equal(fillColor(node, "role", theme), theme.categories.role.router);
  assert.equal(fillColor(node, "power", theme), theme.categories.power.mains);
  assert.equal(fillColor({ role: "unknown", rating: null, power: null }, "role", theme), null);
  assert.equal(fillColor({ role: "unknown", rating: null, power: null }, "power", theme), null);
  assert.equal(fillColor({ role: "router", rating: null }, "reception", theme), null);
  assert.equal(powerCategory("Mains (single phase)"), "mains");
  assert.equal(powerCategory("Emergency Mains Constantly Powered"), "mains");
  assert.equal(powerCategory("Battery or Unknown"), "battery");
  assert.equal(powerCategory("DC Source"), "dc");
  assert.equal(powerCategory("Unknown"), null);
  assert.equal(powerCategory(null), null);
});

test("the grey for 'no value' stays clear of the rating scale and the background in every theme", (t) => {
  for (const background of ["#ffffff", "#fafafa", "#f0f0f0", "#111111", "#1c1c1c", "#303030"]) {
    const theme = resolveTheme({ background });
    const grey = parseColor(theme.node);
    const { lo, hi } = theme.lineRange;
    let toScale = Infinity;
    for (let x = lo; x <= hi + 1e-9; x += 0.005) toScale = Math.min(toScale, deltaE(grey, cividis(x)));
    const toBackground = deltaE(grey, parseColor(background));
    t.diagnostic && t.diagnostic(`${background}: grey ${theme.node}, ΔE to the scale ${toScale.toFixed(1)}, to the background ${toBackground.toFixed(1)}`);
    assert.ok(toScale >= 15 && toBackground >= 15, `${background}: ${toScale} / ${toBackground}`);
    // Outside the scale's lightness, on the background's side.
    const L = toLab(grey)[0];
    const scaleL = [toLab(cividis(lo))[0], toLab(cividis(hi))[0]];
    assert.ok(theme.dark ? L < Math.min(...scaleL) : L > Math.max(...scaleL), `${background}: L* ${L}`);
  }
  // The greys this replaces sat inside the scale (the review's finding): dark #707070 within 2 ΔE of a rating colour.
  const dark = resolveTheme({ background: "#111111" });
  let old = Infinity;
  for (let x = dark.lineRange.lo; x <= dark.lineRange.hi; x += 0.005) old = Math.min(old, deltaE([112, 112, 112], cividis(x)));
  assert.ok(old < 2);
});

test("a device without a value under the fill is grey with a slash; rated and offline devices have none", () => {
  const network = {
    devices: [
      { id: "a", role: "router", label: "Rated", rating: 0.5 },
      { id: "b", role: "router", label: "Unrated", rating: null },
      { id: "c", role: "router", label: "Offline", rating: null, available: false },
    ],
    readings: [],
  };
  const scene = buildScene(network, (text) => text.length * 7);
  const ctx = recordingContext();
  const theme = resolveTheme({});
  const pos = { x: [0, 100, 200], y: [0, 0, 0], pinned: [0, 0, 0], mesh: [1, 1, 1] };
  drawScene(ctx, scene, pos, { cam: { k: 1, cx: 100, cy: 0 }, width: 400, height: 200, dpr: 1, labelZoom: 1,
    debug: false, selected: -1, hovered: -1, fps: null, fill: "reception" }, theme, (text) => text.length * 7);
  // A slash runs from lower left to upper right inside the marker: moveTo(x - q, y + q), lineTo(x + q, y - q).
  const slashes = [];
  ctx.calls.forEach((c, j) => {
    const next = ctx.calls[j + 1];
    if (c[0] === "moveTo" && next && next[0] === "lineTo" && next[1] - c[1] > 0
      && Math.abs((next[1] - c[1]) - (c[2] - next[2])) < 1e-9) slashes.push(Math.round((c[1] + next[1]) / 2));
  });
  assert.deepEqual(slashes.map((x) => x - 200), [0], "only the unrated device (drawn at x = 200) has a slash");
});
