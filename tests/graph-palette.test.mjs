// SPDX-License-Identifier: MIT
// Tests of the colours (spec 8): the published cividis values, ratings drawn with 3:1 against light and dark
// backgrounds, theme colours corrected to 3:1, unknown values without colour.  node --test "tests/**/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveTheme, ratingColor, parseColor, contrastRatio, cividis, toHex, MIN_CONTRAST,
} from "../custom_components/meshroute_topology_explorer/frontend/graph/palette.js";

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
