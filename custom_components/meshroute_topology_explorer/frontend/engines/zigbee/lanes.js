// SPDX-License-Identifier: MIT
// What a Zigbee lane says (spec 4.3, 7.1, 8; boards M7, M11): the value under "RX:" (the raw LQI at the hearer,
// "Parent" or "Route" where only they imply the direction), the glyph of a direction without a reading, and the legend
// rows of every path class with the view or option that draws it. Drawn by the shared renderer through the engine
// (engines/index.js); the strokes are the shared looks of graph/links.js. Pure. node --test tests/
import { BAND, STEM, WIDTH_STEPS, WIDTHS, laneStyle } from "../../graph/links.js";
import { receptionColor } from "../../graph/palette.js";

/** Glyph for a direction without a reading (spec 4.3 reasons): "–" when the hearer has a table that does not list the
 *  sender (full, nearly full, with space, capacity unknown); "?" when there is no table to ask (end device, missing or
 *  stale table) or the table says LQI 0 (unmeasured or very weak). */
export function unknownGlyph(reason) {
  const listedNot = /^(table (full|nearly full|has space)|capacity unknown)/;
  return typeof reason === "string" && listedNot.test(reason) ? "–" : "?";
}

/** Text for a reading's value on a lane, raw LQI: "0 (uncertain)" for 0 (spec 3.1; the panel passes its translation),
 *  "?" for no value or no entry. */
export function valueText(lqi, uncertain = "0 (uncertain)") {
  if (lqi === 0) return uncertain;
  return typeof lqi === "number" && lqi > 0 ? String(lqi) : "?";
}

/** The value of a lane (a direction's evidence, data model 4.3): the raw LQI at the hearer, "Parent" or "Route" where
 *  only a parent link or a route implies it; without a reading the legend's glyph (unknownGlyph: "–" where the
 *  hearer's table was read and does not list the sender, "?" where there is no table to ask; decision by the main
 *  session, 2026-11-01). Texts: the panel's words. */
export function laneValue(dir, texts) {
  if (dir && dir.state === "implied") return dir.source === "parent" ? texts.parent : texts.route;
  const text = valueText(dir ? dir.lqi : null, texts.uncertain);
  return text === "?" ? unknownGlyph(dir && dir.reason) : text;
}

/** What the legend explains, for the panel to draw with its own words (ids are stable keys for translations; board
 *  M7): every path class whatever the view (decision by Fabian Schwamborn, 2026-11-01), each with its stroke sample:
 *  there and back with the coordinator (up and down share one row) and the assumed return path (views 1 and 3), paths
 *  to other devices (views 2 and 3) and the computed route discovery (view 3, marked computed), heard (the option,
 *  needs a selection); the band under a selected device's way up; the glyphs for directions without a reading where
 *  the option draws them (on click, debug); debug mode adds the lane without traffic or reading, the width steps and
 *  the unknown end; "RX:" at the hearer with a sample value, and with colored the reception scale. */
export function legendEntries(theme, { debug = false, colored = false, heard = false } = {}) {
  const sample = (stroke) => laneStyle(stroke, 1, theme);
  const glyphs = debug || heard;
  return [
    // The views that draw each class (owner proposal 2026-11-01): up and down in 1 and 3, routes in 2 and 3.
    { id: "coordinator", kind: "lane", style: sample("solid"), stage: [1, 3] },
    { id: "assumed", kind: "lane", style: sample("dotted"), stage: [1, 3] },
    { id: "route", kind: "lane", style: sample("dashdot"), stage: [2, 3] },
    { id: "discovery", kind: "lane", style: sample("dashdot-muted"), stage: 3, computed: true },
    { id: "heard", kind: "lane", style: sample("dashed"), option: "heard" },
    { id: "up-path", kind: "band", color: theme.foreground, alpha: BAND.alpha, width: BAND.width },
    ...(debug ? [{ id: "implied", kind: "lane", style: laneStyle("faint", null, theme) },
      { id: "width", kind: "width", steps: [...WIDTH_STEPS], widths: [...WIDTHS.solid], color: theme.foreground }] : []),
    ...(glyphs ? [{ id: "not-listed", kind: "glyph", text: "–", color: theme.muted },
      { id: "no-table", kind: "glyph", text: "?", color: theme.muted }] : []),
    ...(debug ? [{ id: "path-end", kind: "stem", color: theme.foreground, width: STEM.width, dash: [...STEM.dash],
      text: "?" }] : []),
    { id: "rx", kind: "rx", sample: "103" },
    ...(colored ? [{ id: "reception", kind: "scale",
      colors: [0, 0.25, 0.5, 0.75, 1].map((r) => receptionColor(r, theme)) }] : []),
  ];
}
