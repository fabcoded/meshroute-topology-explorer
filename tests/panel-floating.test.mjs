// SPDX-License-Identifier: MIT
// The floating groups on the map (decision by Fabian Schwamborn, 2026-10-31; spec 9.1) and the legend built from the
// graph's own entries: places with and without the drawer, the narrow collapse, the links rows in both languages.
// node --test "tests/**/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { floatingLayout, drawerGeometry, FLOAT_GAP, FLOAT_TARGET } from "../custom_components/meshroute_topology_explorer/frontend/ui/geometry.js";
import { linkLegendRows, SHORT_IDS } from "../custom_components/meshroute_topology_explorer/frontend/ui/link-legend.js";
import { legendEntries } from "../custom_components/meshroute_topology_explorer/frontend/graph/links.js";
import { resolveTheme } from "../custom_components/meshroute_topology_explorer/frontend/graph/palette.js";
import { translator } from "../custom_components/meshroute_topology_explorer/frontend/ui/i18n.js";

test("wide panels: labelled rows top right, the band below the title stops left of them", () => {
  const f = floatingLayout({ width: 1400, height: 800, options: { width: 180, height: 180 } });
  assert.equal(f.wide, true);
  assert.equal(f.options.mode, "rows");
  assert.deepEqual(f.title, { left: FLOAT_GAP, top: FLOAT_GAP });
  assert.deepEqual(f.options, { mode: "rows", right: FLOAT_GAP, top: FLOAT_GAP });
  assert.deepEqual(f.zoom, { right: FLOAT_GAP, bottom: FLOAT_GAP });
  assert.equal(f.band.top, FLOAT_GAP + FLOAT_TARGET + 8, "banners start below the title pill");
  assert.equal(f.band.right, FLOAT_GAP + 180 + FLOAT_GAP, "and end left of the options group");
  assert.deepEqual(f.chip, { place: "band" });
});

test("the side drawer pushes the right-hand groups by its width; the sheet lifts the bottom ones", () => {
  const side = drawerGeometry({ width: 1400, height: 800, open: true });
  const f = floatingLayout({ width: 1400, height: 800, insets: side.insets, options: { width: 180, height: 180 } });
  assert.equal(f.options.right, side.size + FLOAT_GAP);
  assert.equal(f.zoom.right, side.size + FLOAT_GAP);
  assert.equal(f.zoom.bottom, FLOAT_GAP);
  assert.equal(f.legend.bottom, FLOAT_GAP);
  assert.ok(f.legend.maxWidth <= 1400 - side.size - 2 * FLOAT_GAP - FLOAT_TARGET, "the legend leaves room for the zoom group");
  const sheet = drawerGeometry({ width: 390, height: 700, open: true, expanded: false });
  const g = floatingLayout({ width: 390, height: 700, insets: sheet.insets, options: { width: 176, height: 44 } });
  assert.equal(g.zoom.bottom, sheet.size + FLOAT_GAP);
  assert.equal(g.legend.bottom, sheet.size + FLOAT_GAP);
  assert.equal(g.chip.bottom, sheet.size + FLOAT_GAP);
  assert.equal(g.options.right, FLOAT_GAP, "the sheet leaves the top alone");
});

test("narrow panels: the options collapse to a row of icons, banners go below it, the chip goes to the bottom", () => {
  const f = floatingLayout({ width: 390, height: 700, options: { width: 176, height: 44 } });
  assert.equal(f.wide, false);
  assert.equal(f.options.mode, "icons");
  assert.equal(f.band.right, FLOAT_GAP, "below the row of icons the band spans the width");
  assert.equal(f.band.top, FLOAT_GAP + FLOAT_TARGET + 8);
  assert.deepEqual(f.chip, { place: "bottom", left: FLOAT_GAP, bottom: FLOAT_GAP });
  assert.ok(f.legend.maxWidth >= 3 * FLOAT_TARGET);
  assert.ok(f.legend.maxHeight >= FLOAT_TARGET && f.legend.maxHeight < 700);
});

test("the links legend is built from the graph's entries, with words for every entry in English and German", () => {
  for (const background of ["#ffffff", "#111111"]) {
    const entries = legendEntries(resolveTheme({ background }));
    for (const lang of ["en", "de"]) {
      const t = translator(lang);
      const rows = linkLegendRows(entries, t);
      assert.deepEqual(rows.map((r) => r.id), entries.map((e) => e.id), "every entry, in the graph's order");
      for (const row of rows) {
        assert.ok(row.label && row.label !== row.id && !/\{\w+\}/.test(row.label), `${lang} ${row.id}`);
      }
      const lanes = rows.filter((r) => r.kind === "lane");
      assert.deepEqual(lanes.map((r) => r.id), ["up", "route", "heard", "implied", "path", "path-implied"]);
      assert.ok(lanes.every((r) => r.style && typeof r.style.width === "number"), "samples use the graph's own strokes");
      const short = linkLegendRows(entries, t, { short: true });
      assert.deepEqual(short.map((r) => r.id), [...SHORT_IDS]);
      // With colour by reception on, the scale joins both legends, in words in both languages.
      const colored = legendEntries(resolveTheme({ background }), { colored: true });
      const scale = linkLegendRows(colored, t, { short: true }).find((r) => r.id === "reception");
      assert.ok(scale && scale.kind === "scale" && scale.colors.length === 5 && !/\{/.test(scale.label), `${lang} scale`);
      assert.ok(linkLegendRows(colored, t).some((r) => r.id === "reception" && r.label !== "reception"));
    }
  }
  const t = translator("en");
  const rows = linkLegendRows(legendEntries(resolveTheme({})), t);
  const notListed = rows.find((r) => r.id === "not-listed");
  assert.equal(notListed.text, "–", "the glyph stays the graph's own");
  assert.match(notListed.label, /does not list the sender/);
  assert.equal(rows.find((r) => r.id === "no-table").text, "?");
  const unknown = linkLegendRows([{ id: "future", kind: "lane", style: { width: 1 } }], t);
  assert.equal(unknown[0].label, "future", "an entry without words keeps its id instead of vanishing");
});

test("the none fill and the arrows' reception are named in both languages", () => {
  assert.equal(translator("en")("fill.none"), "None");
  assert.equal(translator("de")("fill.none"), "Keine");
  assert.equal(translator("en")("legend.fill_none"), "Fill: none");
  assert.equal(translator("de")("legend.fill_none"), "Füllung: keine");
  assert.match(translator("en")("legend.links_value"), /number at an arrow is the LQI at the hearer/);
  assert.match(translator("de")("legend.links_value"), /Zahl am Pfeil ist der LQI beim Hörer/);
  assert.match(translator("en")("legend.none"), /Reception is shown at the arrows/);
  assert.match(translator("de")("legend.none"), /Empfang steht an den Pfeilen/);
  assert.equal(translator("en")("fill.reception"), "fill.reception", "the removed fill has no words left");
  assert.equal(translator("de")("lane.parent"), "Parent");
});
