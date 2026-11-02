// SPDX-License-Identifier: MIT
// The links part of the legend (spec 9.1), built from what the network's engine says its map draws (GraphView.legend(),
// engines/*/lanes.js legendEntries): Zigbee's strokes by evidence whatever the view (read solid, assumed or derived
// dash-dot, computed dash-dot in grey, heard only dashed grey, each with the views or option that draw it) and the
// width by role, Thread's parent and neighbour lanes; the band under a selected device's way up, in debug mode also
// the lane without traffic or reading, the width steps and the unknown end, the glyphs "–" and "?" where the stage draws them, "RX:" at the hearer, and the scale of the reception colours
// while paths are coloured. The samples use the entries' own stroke styles, so legend and map cannot drift apart; the
// words come from i18n by entry id.
// linkLegendRows is pure (tested in Node); the sample drawings run in the browser.
import { h, svg } from "./dom.js";

/** Rows for the legend: each entry of the graph with its words as `label` and, for a class that belongs to a stage or option,
 *  that as `note` (an entry's own `text` is its glyph). An entry the panel has no words for keeps its id as label, so
 *  nothing the map draws goes unexplained silently. */
export function linkLegendRows(entries, t) {
  return entries.map((e) => {
    // "RX:" rows are keyed by their id ("rx" -> legend.rx), every other row under legend.link.
    const key = e.kind === "rx" ? `legend.${e.id.replaceAll("-", "_")}` : `legend.link.${e.id}`;
    const row = { ...e, label: t.has(key) ? t(key) : e.id };
    // A computed class says so in the same brackets as its stage: "(computed, stage 2)".
    if (e.option) row.note = t(`legend.option_${e.option}`);
    if (Array.isArray(e.stage)) row.note = t("legend.stages", { a: e.stage[0], b: e.stage[1] });
    else if (e.stage) row.note = t(e.computed ? "legend.stage_computed" : "legend.stage", { n: e.stage });
    return row;
  });
}

/** A lane as the map strokes it: width, dash, cap and colour of the entry's style, with its arrowhead (40 × 10 as on
 *  spec 9.1). */
export function laneSample(style, length = 40) {
  const height = 10;
  const y = height / 2;
  const el = svg("svg", { viewBox: `0 0 ${length} ${height}`, width: length, height, "aria-hidden": "true", class: "lane-sample" });
  const end = style.head ? length - 7 : length - 1;
  const attrs = { d: `M1 ${y}H${end}`, stroke: style.color, "stroke-width": style.width, "stroke-linecap": style.cap || "butt", fill: "none" };
  if (style.dash && style.dash.length) attrs["stroke-dasharray"] = style.dash.join(" ");
  el.append(svg("path", attrs));
  if (style.head) {
    const d = `M${length - 9} ${y - 4}L${length - 1} ${y}L${length - 9} ${y + 4}Z`;
    el.append(svg("path", { d, fill: style.color }));
  }
  return el;
}

/** The three lane widths stacked (thin, middle, thick), in the foreground colour: side by side they would read as a
 *  dashed lane. */
function widthSample(widths, color) {
  const el = svg("svg", { viewBox: "0 0 40 16", width: 40, height: 16, "aria-hidden": "true", class: "lane-sample" });
  widths.forEach((w, i) => el.append(svg("path", { d: `M2 ${3 + i * 5}H38`, stroke: color, "stroke-width": w })));
  return el;
}

/** The selected device's way up: a wide translucent band. */
function bandSample(entry) {
  const el = svg("svg", { viewBox: "0 0 40 12", width: 40, height: 12, "aria-hidden": "true", class: "lane-sample" });
  el.append(svg("path", { d: "M3 6H37", stroke: entry.color, "stroke-opacity": entry.alpha, "stroke-width": entry.width,
    "stroke-linecap": "round" }));
  return el;
}

/** An incomplete path's end: the dashed stem and its "?". */
function stemSample(entry) {
  const el = svg("svg", { viewBox: "0 0 40 12", width: 40, height: 12, "aria-hidden": "true", class: "lane-sample" });
  el.append(svg("path", { d: "M1 6H24", stroke: entry.color, "stroke-width": entry.width,
    "stroke-dasharray": entry.dash.join(" "), fill: "none" }));
  const q = svg("text", { x: 33, y: 10, "text-anchor": "middle", "font-size": 12, fill: entry.color });
  q.textContent = entry.text;
  el.append(q);
  return el;
}

/** The reception scale as a bar from weakest (left) to strongest (right), 40 × 6 (spec 9.1). */
function scaleSample(entry) {
  return h("span", { class: "scale-sample", "aria-hidden": "true",
    style: { background: `linear-gradient(90deg, ${entry.colors.join(", ")})` } });
}

/** "RX:" over a value, as the map writes it beside a lane (the row's own sample value). */
function rxSample(t, value) {
  return h("span", { class: "rx-sample", "aria-hidden": "true" }, h("span", { class: "muted", text: t("lane.rx") }),
    h("strong", { text: value }));
}

/** The drawing for one row. */
function sampleFor(row, t) {
  if (row.kind === "lane") return laneSample(row.style);
  if (row.kind === "width") return widthSample(row.widths, row.color);
  if (row.kind === "glyph") return h("span", { class: "glyph-sample", style: { color: row.color }, "aria-hidden": "true", text: row.text });
  if (row.kind === "band") return bandSample(row);
  if (row.kind === "stem") return stemSample(row);
  if (row.kind === "scale") return scaleSample(row);
  if (row.kind === "rx") return rxSample(t, row.sample);
  return h("span", { class: "glyph-sample" });
}

/** A list of rows with samples. */
export function linkLegendList(entries, t) {
  return h("ul", { class: "legend-rows" }, linkLegendRows(entries, t).map((row) =>
    h("li", {}, sampleFor(row, t),
      h("span", {}, row.label, row.note ? h("span", { class: "muted", text: ` ${row.note}` }) : null))));
}
