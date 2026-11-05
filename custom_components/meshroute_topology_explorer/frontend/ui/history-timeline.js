// SPDX-License-Identifier: MIT
// The Timeline tab (spec 9.5, board M36 D1): per direction a band of the route spans ("via X, Y"; a walk that stopped is
// a gap with its reason) and under it the rank of the weakest hop at its receiver over time, one point per record, the
// weakest hop named where it changes. The weakest hop is chosen by rank, never by raw LQI (spec 5.8). Thread has no
// walked route: a note instead of bands. Model pure, drawing as SVG. npm test
import { h, svg } from "./dom.js";
import { directionColors, scale, linePath, timeTicks, tickText, timeText } from "./history-chart.js";

const CHAR = 6.3; // px per character of the 12 px labels, enough to decide what fits

/** What one direction of the timeline shows: bands of consecutive records with the same hop list of THIS direction (a
 *  change of the other direction does not split them), the weakest hop's rank per record, and the notes naming the
 *  weakest hop at the first record of each band and wherever it changes. labelOf(id) gives a device's name. Returns
 *  { bands: [{ from, to, full, gap }] (to = the next band's start; the last ends at its last record), series: [[t,
 *  pct|null]], notes: [{ t, pct, text }] }. */
export function directionModel({ tl, dir, labelOf, t, locale, zone }) {
  const sig = (w) => `${w.ids.join(">")}${w.complete ? "" : `!${w.reason}`}`;
  const bands = [];
  const series = [];
  const notes = [];
  let last = null;
  let key = null;
  tl.points.forEach((p, i) => {
    const w = p[dir];
    if (key !== sig(w)) {
      key = sig(w);
      const full = w.complete ? (w.ids.length > 2 ? t("history.via", { nodes: w.ids.slice(1, -1).map(labelOf).join(", ") }) : t("history.direct"))
        : t("history.gap", { reason: w.reason });
      bands.push({ from: p.t, to: p.t, full, gap: !w.complete });
      last = null; // the weakest hop is named again at the start of every band
    }
    bands[bands.length - 1].to = i + 1 < tl.points.length ? tl.points[i + 1].t : p.t;
    const hop = w.weakest === null || w.weakest === undefined ? null : w.hops[w.weakest];
    series.push([p.t, hop ? hop.rankPct : null]);
    const hopKey = hop ? `${hop.sender}>${hop.hearer}` : null;
    if (hopKey && hopKey !== last) {
      notes.push({ t: p.t, pct: hop.rankPct, text: t("history.weakest_at", { time: timeText(p.t, locale, zone), from: labelOf(hop.sender),
        to: labelOf(hop.hearer), lqi: hop.lqi, pct: hop.rankPct }) });
    }
    if (hopKey) last = hopKey;
  });
  return { bands, series, notes };
}

/** Where the weakest-hop names go, in the chart's coordinates (plot from y 0 to 100, bands above, axis labels below):
 *  greedy left to right, per note the right of its dot above, below, then the left of it above, below; a label that
 *  would touch an already placed one, the data line or leave the plot (left edge, right edge, top, bottom) is skipped, its text stays
 *  in the dot's hover title. Returns [{ text, anchor, x0, x1, y, y0, y1 }] (y = baseline; y0..y1 the text box). Pure. */
export function placeNotes(notes, { x, y, left, right, top = 1, bottom = 99, series = [] }) {
  const placed = [];
  // The data line sampled every 2 px: a label over it would be crossed by it.
  const line = [];
  const pts = series.filter(([, v]) => v !== null).map(([t, v]) => [x(t), y(v)]);
  for (let i = 0; i + 1 < pts.length; i++) {
    const [[ax, ay], [bx, by]] = [pts[i], pts[i + 1]];
    for (let k = 0, n = Math.max(1, Math.ceil(Math.abs(bx - ax) / 2)); k <= n; k++) line.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
  }
  if (pts.length === 1) line.push(pts[0]);
  const onLine = (b) => line.some(([px, py]) => px >= b.x0 - 3 && px <= b.x1 + 3 && py >= b.y0 - 3 && py <= b.y1 + 3);
  const hit = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  for (const n of notes) {
    const [nx, ny] = [x(n.t), y(n.pct)];
    const w = n.text.length * CHAR;
    const spots = [["start", nx + 4, -8], ["start", nx + 4, 16], ["end", nx - 4, -8], ["end", nx - 4, 16]];
    for (const [anchor, ax, dy] of spots) {
      const [x0, x1] = anchor === "start" ? [ax, ax + w] : [ax - w, ax];
      const box = { text: n.text, anchor, x0, x1, y: ny + dy, y0: ny + dy - 10, y1: ny + dy + 3 };
      if (x0 < left || x1 > right || box.y0 < top || box.y1 > bottom || placed.some((o) => hit(o, box)) || onLine(box)) continue;
      placed.push(box);
      break;
    }
  }
  return placed;
}

/** The tab's content. ctx: { t, theme, tl (history.timeline(a, b)), from, to, width, labelOf, walks (a routing table exists), a, b }. */
export function renderTimeline(container, ctx) {
  const { t, tl, from, to, labelOf } = ctx;
  container.replaceChildren();
  if (!ctx.walks) {
    container.append(h("p", { class: "muted", text: t("history.no_route") }));
    return;
  }
  const colors = directionColors(ctx.theme);
  const width = Math.max(300, ctx.width || 600);
  const left = 34;
  const x = scale([from, to], [left, width - 8]);
  const y = scale([0, 100], [92, 6]);
  for (const dir of ["there", "back"]) {
    const [s, e] = dir === "there" ? [ctx.a, ctx.b] : [ctx.b, ctx.a];
    const m = directionModel({ tl, dir, labelOf, t, locale: t.formatLocale, zone: ctx.zone });
    const color = colors[dir];
    const g = svg("svg", { viewBox: `0 0 ${width} 150`, width: "100%", class: "hist-timeline", role: "img",
      "aria-label": `${t(`history.${dir}`)}: ${t("history.direction", { from: labelOf(s), to: labelOf(e) })}` });
    const band = svg("g", { transform: "translate(0 0)" });
    for (const b of m.bands) {
      const [x0, x1] = [Math.max(left, x(b.from)), x(Math.min(b.to, to))];
      const w = Math.max(3, x1 - x0);
      const r = svg("rect", { x: x0, y: 0, width: w, height: 22, rx: 3, class: `band ${dir}${b.gap ? " gap" : ""}`, fill: b.gap ? "none" : color,
        "fill-opacity": 0.22, stroke: color, "stroke-opacity": b.gap ? 0.7 : 0, "stroke-dasharray": b.gap ? "4 3" : "none" });
      const tip = svg("title", {}); tip.textContent = b.full; r.append(tip);
      band.append(r);
      // Always labelled: the full text where it fits, else cut with an ellipsis (the full text is the hover title).
      const room = Math.floor((w - 10) / CHAR);
      if (room >= 3) {
        const tx = svg("text", { x: x0 + 6, y: 15, class: "band-text" });
        tx.textContent = b.full.length <= room ? b.full : `${b.full.slice(0, room - 1)}…`;
        band.append(tx);
      }
    }
    g.append(band);
    const chart = svg("g", { transform: "translate(0 28)" });
    for (const v of [0, 50, 100]) {
      chart.append(svg("line", { x1: left, x2: width - 8, y1: y(v), y2: y(v), class: "grid" }));
      const lb = svg("text", { x: left - 4, y: y(v) + 3, "text-anchor": "end", class: "lbl" }); lb.textContent = `${v} %`; chart.append(lb);
    }
    chart.append(svg("path", { d: linePath(m.series, x, y), fill: "none", stroke: color, "stroke-width": 1.4 }));
    for (const [tt, v] of m.series) if (v !== null) chart.append(svg("circle", { cx: x(tt), cy: y(v), r: 2.2, fill: color, class: "pt" }));
    // Every change of the weakest hop gets a dot; its name is written where it fits (placeNotes), else in the dot's hover.
    const placed = placeNotes(m.notes, { x, y, left, right: width - 8, series: m.series });
    for (const n of m.notes) {
      const dot = svg("circle", { cx: x(n.t), cy: y(n.pct), r: 4, fill: color, class: "note-dot" });
      const tip = svg("title", {}); tip.textContent = n.text; dot.append(tip);
      chart.append(dot);
    }
    for (const p of placed) {
      const tx = svg("text", { x: p.anchor === "start" ? p.x0 : p.x1, y: p.y, "text-anchor": p.anchor, class: "lbl note" });
      tx.textContent = p.text;
      chart.append(tx);
    }
    g.append(chart);
    const axis = svg("g", { transform: "translate(0 128)" });
    for (const k of timeTicks(from, to, Math.max(2, Math.floor(width / 70)))) {
      const tx = svg("text", { x: x(k.t), y: 12, "text-anchor": "middle", class: "lbl" }); tx.textContent = tickText(k, t.formatLocale, ctx.zone); axis.append(tx);
    }
    g.append(axis);
    container.append(h("section", { class: "hist-dir" },
      h("h4", {}, h("span", { class: `dot ${dir}` }), `${t(`history.${dir}`)} `, h("small", { class: "muted", text: t("history.direction", { from: labelOf(s), to: labelOf(e) }) })),
      g, h("p", { class: "small muted", text: t("history.weakest") })));
  }
}
