// SPDX-License-Identifier: MIT
// Tests of the colours (spec 8): lines keep 3:1 against light and dark backgrounds, theme colours are corrected to
// 3:1, unknown values have no colour.  node --test "tests/**/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveTheme, lqiColor, ratingColor, parseColor, contrastRatio, cividis, MIN_CONTRAST,
} from "../custom_components/meshroute_topology_explorer/frontend/graph/palette.js";

test("every line colour reaches 3:1 against common light and dark backgrounds", () => {
  for (const background of ["#ffffff", "#fafafa", "#f0f0f0", "#111111", "#1c1c1c", "#303030"]) {
    const theme = resolveTheme({ background });
    assert.equal(theme.lineRange.casing, false, background);
    for (let lqi = 1; lqi <= 255; lqi++) {
      assert.ok(contrastRatio(parseColor(lqiColor(lqi, theme)), parseColor(background)) >= MIN_CONTRAST, `${background} ${lqi}`);
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

test("unknown readings and ratings have no colour; the sequence darkens to lighten monotonically", () => {
  const theme = resolveTheme({});
  for (const v of [0, null, undefined, NaN]) assert.equal(lqiColor(v, theme), null);
  assert.equal(ratingColor(null), null);
  assert.equal(ratingColor(0), "#00224e");
  const lum = (t) => contrastRatio(cividis(t), [0, 0, 0]);
  for (let t = 0; t < 1; t += 0.05) assert.ok(lum(t + 0.05) > lum(t));
});
