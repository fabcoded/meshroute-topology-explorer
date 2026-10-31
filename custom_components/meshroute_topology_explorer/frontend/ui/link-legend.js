// SPDX-License-Identifier: MIT
// The links part of the legend, built from what the graph says it draws (GraphView.legend(), graph/links.js
// legendEntries): the three colour-free classes (up path solid, other active route dotted, heard only dashed grey),
// the implied lane, the width steps, the glyphs "–" and "?" and the selection's band. The samples use the entries'
// own stroke styles, so legend and map cannot drift apart; the words come from i18n by entry id.
// linkLegendRows is pure (tested in Node); the sample drawings run in the browser.
import { h, svg } from "./dom.js";

/** Classes shown in the small legend on the map. */
export const SHORT_IDS = Object.freeze(["up", "route", "heard"]);

/** Rows for the legend: each entry of the graph with its words as `label` (an entry's own `text` is its glyph);
 *  short: only the three classes, with short names. An entry the panel has no words for keeps its id as label, so
 *  nothing the map draws goes unexplained silently. */
export function linkLegendRows(entries, t, { short = false } = {}) {
  const list = short ? entries.filter((e) => SHORT_IDS.includes(e.id)) : entries;
  return list.map((e) => {
    const key = short ? `legend.link_short.${e.id}` : `legend.link.${e.id}`;
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

/** The drawing for one row. */
function sampleFor(row, entries) {
  if (row.kind === "lane") return laneSample(row.style);
  if (row.kind === "width") {
    const up = entries.find((e) => e.id === "up");
    return widthSample(up ? up.widths : [1, 2, 3], up ? up.style.color : "currentColor");
  }
  if (row.kind === "glyph") return h("span", { class: "glyph-sample", style: { color: row.color }, "aria-hidden": "true", text: row.text });
  if (row.kind === "band") return bandSample(row);
  return h("span", { class: "glyph-sample" });
}

/** A list of rows with samples. */
export function linkLegendList(entries, t, { short = false } = {}) {
  return h("ul", { class: short ? "swatches compact" : "swatches" }, linkLegendRows(entries, t, { short }).map((row) =>
    h("li", {}, sampleFor(row, entries), h("span", { text: row.label }))));
}
