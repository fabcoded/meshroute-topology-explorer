// SPDX-License-Identifier: MIT
// The 48 h sparkline of a "Heard by · hears" row in Details (spec 9.2, board M35): one grey series, the last point a
// dot, and the "48 h min–max" text. Model pure, drawing as SVG. npm test
import { svg } from "./dom.js";
import { linePath, scale } from "./history-chart.js";

/** Sparkline of points [[t, value|null]]: { path, dot: { x, y } | null, min, max, n } or null without a value. Fewer
 *  than 3 values draw points only (no path). */
export function sparkModel(points, width = 72, height = 18) {
  const have = points.filter(([, v]) => v !== null && v !== undefined);
  if (!have.length) return null;
  const values = have.map(([, v]) => v);
  const [min, max] = [Math.min(...values), Math.max(...values)];
  const x = scale([points[0][0], points[points.length - 1][0] || points[0][0] + 1], [2, width - 3]);
  const y = scale(min === max ? [min - 1, max + 1] : [min, max], [height - 3, 3]);
  const last = have[have.length - 1];
  return { path: have.length >= 3 ? linePath(points, x, y) : "", dots: have.length < 3 ? have.map(([t, v]) => ({ x: x(t), y: y(v) })) : [],
    dot: { x: x(last[0]), y: y(last[1]) }, min, max, n: have.length, width, height };
}

/** The sparkline's SVG (decorative: the row's text carries the numbers). */
export function sparkline(model) {
  const el = svg("svg", { width: model.width, height: model.height, viewBox: `0 0 ${model.width} ${model.height}`, class: "spark", "aria-hidden": "true" });
  if (model.path) el.append(svg("path", { d: model.path, fill: "none", stroke: "currentColor", "stroke-width": 1.2, opacity: 0.7 }));
  for (const d of model.dots) el.append(svg("circle", { cx: d.x, cy: d.y, r: 1.6, fill: "currentColor", opacity: 0.7 }));
  el.append(svg("circle", { cx: model.dot.x, cy: model.dot.y, r: 2.2, fill: "currentColor" }));
  return el;
}
