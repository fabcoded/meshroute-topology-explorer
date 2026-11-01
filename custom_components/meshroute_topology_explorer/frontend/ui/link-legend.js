// SPDX-License-Identifier: MIT
// The links part of the legend, built from what the graph says it draws (GraphView.legend(), graph/links.js
// legendEntries): the three colour-free classes (up path solid, other active route dotted, heard only dashed grey),
// the implied lane, the width steps, the glyphs "–" and "?", the selection's band, its path hops and unknown end, and
// the scale of the user's reception colours while paths are coloured. The samples use the entries' own stroke styles,
// so legend and map cannot drift apart; the words come from i18n by entry id.
// linkLegendRows is pure (tested in Node); the sample drawings run in the browser.
import { h, svg } from "./dom.js";

/** Rows for the legend: each entry of the graph with its words as `label` (an entry's own `text` is its glyph). An
 *  entry the panel has no words for keeps its id as label, so nothing the map draws goes unexplained silently. */
export function linkLegendRows(entries, t) {
  return entries.map((e) => {
    const key = `legend.link.${e.id}`;
    return { ...e, label: t.has(key) ? t(key) : e.id };
  });
}

/** A lane as the map strokes it: width, dash, cap and colour of the entry's style, with its arrowhead. */
export function laneSample(style, length = 36) {
  const height = 12;
  const y = height / 2;
  const el = svg("svg", { viewBox: `0 0 ${length} ${height}`, width: length, height, "aria-hidden": "true", class: "lane-sample" });
  const end = style.head ? length - 6 : length - 1;
  const attrs = { d: `M1 ${y}H${end}`, stroke: style.color, "stroke-width": style.width, "stroke-linecap": style.cap || "butt", fill: "none" };
  if (style.dash && style.dash.length) attrs["stroke-dasharray"] = style.dash.join(" ");
  el.append(svg("path", attrs));
  if (style.head) el.append(svg("path", { d: `M${length - 7} ${y - 3.5}L${length - 1} ${y}L${length - 7} ${y + 3.5}Z`, fill: style.color }));
  return el;
}

/** The three lane widths stacked (thin, middle, thick), in the foreground colour: side by side they would read as a
 *  dashed lane. */
function widthSample(widths, color) {
  const el = svg("svg", { viewBox: "0 0 36 16", width: 36, height: 16, "aria-hidden": "true", class: "lane-sample" });
  widths.forEach((w, i) => el.append(svg("path", { d: `M4 ${3 + i * 5}H32`, stroke: color, "stroke-width": w })));
  return el;
}

function bandSample(entry) {
  const el = svg("svg", { viewBox: "0 0 36 12", width: 36, height: 12, "aria-hidden": "true", class: "lane-sample" });
  el.append(svg("path", { d: "M2 6H34", stroke: entry.color, "stroke-opacity": entry.alpha, "stroke-width": entry.width,
    "stroke-linecap": "round" }));
  return el;
}

/** An incomplete path's end: the dashed stem and its "?". */
function stemSample(entry) {
  const el = svg("svg", { viewBox: "0 0 36 12", width: 36, height: 12, "aria-hidden": "true", class: "lane-sample" });
  el.append(svg("path", { d: "M1 6H22", stroke: entry.color, "stroke-width": entry.width, "stroke-dasharray": entry.dash.join(" "),
    fill: "none" }));
  const q = svg("text", { x: 30, y: 10, "text-anchor": "middle", "font-size": 12, fill: entry.color });
  q.textContent = entry.text;
  el.append(q);
  return el;
}

/** The reception scale: its colours from weakest (left) to strongest (right) as a bar of short strokes. */
function scaleSample(entry) {
  const el = svg("svg", { viewBox: "0 0 36 12", width: 36, height: 12, "aria-hidden": "true", class: "lane-sample" });
  const step = 34 / entry.colors.length;
  entry.colors.forEach((c, i) => el.append(svg("path", { d: `M${1 + i * step} 6H${1 + (i + 1) * step}`, stroke: c,
    "stroke-width": 4 })));
  return el;
}

/** The drawing for one row. */
function sampleFor(row, entries) {
  if (row.kind === "lane") return laneSample(row.style);
  if (row.kind === "width") {
    const up = entries.find((e) => e.id === "up");
    return widthSample(up ? up.widths : [1, 2, 3], up ? up.style.color : "currentColor");
  }
  if (row.kind === "glyph") return h("span", { class: "glyph-sample", style: { color: row.color }, "aria-hidden": "true", text: row.text });
  if (row.kind === "band") return bandSample(row);
  if (row.kind === "stem") return stemSample(row);
  if (row.kind === "scale") return scaleSample(row);
  return h("span", { class: "glyph-sample" });
}

/** A list of rows with samples. */
export function linkLegendList(entries, t) {
  return h("ul", { class: "swatches" }, linkLegendRows(entries, t).map((row) =>
    h("li", {}, sampleFor(row, entries), h("span", { text: row.label }))));
}
