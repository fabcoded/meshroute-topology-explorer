// SPDX-License-Identifier: MIT
// The controls on the map (design by Fabian Schwamborn, 2026-11-01; spec 9.1) and the legend built from the graph's own
// entries: places with and without the panels, banners between or below the top groups, the links rows in both
// languages.
// node --test "tests/**/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { floatingLayout, drawerGeometry, combinedInsets, FLOAT_GAP, BAND_MIN, SHEET_COLLAPSED } from "../custom_components/meshroute_topology_explorer/frontend/ui/geometry.js";
import { linkLegendRows } from "../custom_components/meshroute_topology_explorer/frontend/ui/link-legend.js";
import { legendEntries } from "../custom_components/meshroute_topology_explorer/frontend/graph/links.js";
import { resolveTheme } from "../custom_components/meshroute_topology_explorer/frontend/graph/palette.js";
import { translator } from "../custom_components/meshroute_topology_explorer/frontend/ui/i18n.js";

test("wide panels: Devices top left, View top right, banners between them at the top", () => {
  const left = { width: 150, height: 100 };
  const right = { width: 130, height: 100 };
  const f = floatingLayout({ width: 1400, height: 800, left, right });
  assert.equal(f.wide, true);
  assert.deepEqual(f.left, { left: FLOAT_GAP, top: FLOAT_GAP });
  assert.deepEqual(f.right, { right: FLOAT_GAP, top: FLOAT_GAP });
  assert.deepEqual(f.zoom, { right: FLOAT_GAP, bottom: FLOAT_GAP });
  assert.equal(f.band.top, FLOAT_GAP, "between the groups");
  assert.equal(f.band.left, FLOAT_GAP + 150 + FLOAT_GAP);
  assert.equal(f.band.right, FLOAT_GAP + 130 + FLOAT_GAP);
  assert.ok(1400 - f.band.left - f.band.right >= BAND_MIN);
});

test("a side panel moves the zoom group and the band by its width; a sheet lifts the zoom group", () => {
  const side = drawerGeometry({ width: 1400, height: 800, open: true, side: "right" });
  assert.deepEqual(side.insets, { top: 0, right: side.size, bottom: 0, left: 0 });
  const leftSide = drawerGeometry({ width: 1400, height: 800, open: true, side: "left" });
  assert.deepEqual(leftSide.insets, { top: 0, right: 0, bottom: 0, left: leftSide.size });
  const both = combinedInsets(side.insets, leftSide.insets);
  assert.deepEqual(both, { top: 0, right: side.size, bottom: 0, left: leftSide.size });
  // Both panels open: their corners' groups are hidden (size 0), the band spans what is left.
  const f = floatingLayout({ width: 1400, height: 800, insets: both });
  assert.equal(f.zoom.right, side.size + FLOAT_GAP);
  assert.equal(f.band.left, leftSide.size + FLOAT_GAP);
  assert.equal(f.band.right, side.size + FLOAT_GAP);
  const sheet = drawerGeometry({ width: 390, height: 700, open: true, expanded: false, side: "left" });
  assert.deepEqual(sheet.insets, { top: 0, right: 0, bottom: SHEET_COLLAPSED, left: 0 }, "on narrow screens both are sheets");
  const g = floatingLayout({ width: 390, height: 700, insets: sheet.insets, left: { width: 180, height: 100 }, right: { width: 110, height: 100 } });
  assert.equal(g.zoom.bottom, sheet.size + FLOAT_GAP);
  assert.equal(g.right.right, FLOAT_GAP, "the sheet leaves the top alone");
});

test("narrow panels: no room between the groups, so banners go below them across the width", () => {
  const f = floatingLayout({ width: 390, height: 700, left: { width: 180, height: 100 }, right: { width: 110, height: 100 } });
  assert.equal(f.wide, false);
  assert.equal(f.band.left, FLOAT_GAP);
  assert.equal(f.band.right, FLOAT_GAP);
  assert.equal(f.band.top, FLOAT_GAP + 100 + 8);
  assert.ok(f.band.maxHeight > 0 && f.band.maxHeight < 700);
});

test("the links legend is built from the graph's entries, with words for every entry in English and German", () => {
  for (const background of ["#ffffff", "#111111"]) {
    for (const lang of ["en", "de"]) {
      const t = translator(lang);
      // Debug mode: every entry the graph can name, so every one needs words.
      const entries = legendEntries(resolveTheme({ background }), { debug: true, colored: true });
      const rows = linkLegendRows(entries, t);
      assert.deepEqual(rows.map((r) => r.id), entries.map((e) => e.id), "every entry, in the graph's order");
      for (const row of rows) {
        assert.ok(row.label && row.label !== row.id && !/\{\w+\}/.test(row.label), `${lang} ${row.id}`);
      }
      const lanes = rows.filter((r) => r.kind === "lane");
      assert.deepEqual(lanes.map((r) => r.id), ["coordinator", "assumed", "route", "discovery", "heard", "implied"]);
      assert.ok(lanes.every((r) => r.style && typeof r.style.width === "number"), "samples use the graph's own strokes");
      assert.deepEqual(rows.filter((r) => r.note).map((r) => [r.id, r.note]),
        [["coordinator", t("legend.stages", { a: 1, b: 3 })], ["assumed", t("legend.stages", { a: 1, b: 3 })],
          ["route", t("legend.stages", { a: 2, b: 3 })], ["discovery", t("legend.stage_computed", { n: 3 })],
          ["heard", t("legend.option_heard")]], "a class names its views or option");
      const scale = rows.find((r) => r.id === "reception");
      assert.ok(scale && scale.kind === "scale" && scale.colors.length === 5 && !/\{/.test(scale.label), `${lang} scale`);
      assert.equal(rows.find((r) => r.id === "rx").label, t("legend.rx"));
    }
  }
  const t = translator("de");
  const rows = linkLegendRows(legendEntries(resolveTheme({}), { heard: true }), t);
  assert.deepEqual(rows.map((r) => r.label), ["Hin- und Rückweg mit dem Koordinator", "Rückweg angenommen (Source Route)",
    "Weg zu einem anderen Gerät", "einer der günstigsten Wege nach den LQI der Tabellen", "nur gehört", "Band: der Weg des ausgewählten Geräts zum Koordinator", t("legend.link.not-listed"),
    t("legend.link.no-table"), "Empfang beim Empfänger, ein Viertel vor ihm"]);
  assert.deepEqual(rows.slice(2, 5).map((r) => `${r.label} ${r.note}`), ["Weg zu einem anderen Gerät (Ansichten 2 und 3)",
    "einer der günstigsten Wege nach den LQI der Tabellen (berechnet, Ansicht 3)",
    "nur gehört (Option \"zusätzlich gehörte Nachbarn\", braucht eine Auswahl)"]);
  const notListed = rows.find((r) => r.id === "not-listed");
  assert.equal(notListed.text, "–", "the glyph stays the graph's own");
  assert.equal(rows.find((r) => r.id === "no-table").text, "?");
  const unknown = linkLegendRows([{ id: "future", kind: "lane", style: { width: 1 } }], t);
  assert.equal(unknown[0].label, "future", "an entry without words keeps its id instead of vanishing");
});

test("the none fill and the arrows' reception are named in both languages", () => {
  assert.equal(translator("en")("fill.none"), "None");
  assert.equal(translator("de")("fill.none"), "keine", "German option words in lower case (board M2)");
  assert.deepEqual(["dense", "medium", "spread"].map((d) => translator("de")(`density.${d}`)), ["dicht", "mittel", "weit"]);
  assert.equal(translator("en")("legend.fill_none"), "Fill: none");
  assert.equal(translator("de")("legend.fill_none"), "Füllung: keine");
  assert.match(translator("en")("legend.rx"), /reception at the arrowhead/);
  assert.equal(translator("de")("legend.rx"), "Empfang beim Empfänger, ein Viertel vor ihm");
  assert.equal(translator("en")("fill.reception"), "fill.reception", "the removed fill has no words left");
  assert.equal(translator("de")("lane.parent"), "Parent");
});
