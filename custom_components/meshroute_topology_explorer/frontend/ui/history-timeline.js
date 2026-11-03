// SPDX-License-Identifier: MIT
// The Timeline tab (spec 9.5, board M36 D1): per direction a band of the route spans ("via X, Y"; a walk that stopped is
// a gap with its reason) and under it the rank of the weakest hop at its receiver over time, one point per record, the
// weakest hop named where it changes. The weakest hop is chosen by rank, never by raw LQI (spec 5.8). Thread has no
// walked route: a note instead of bands. Model pure, drawing as SVG. npm test
import { h, svg } from "./dom.js";
import { directionColors, dayText, scale, linePath, timeTicks } from "./history-chart.js";

const CHAR = 6.3; // px per character of the 12 px labels, enough to decide what fits

/** What one direction of the timeline shows over [from, to] on a track of `width` px (x from `left`). labelOf(id) gives a
 *  device's name. Returns { bands: [{ x0, x1, text, full, gap }], series: [[t, pct|null]], dots: [{ x, y }] (in
 *  data terms: t, pct), notes: [{ t, pct, text }] }. */
export function directionModel({ tl, dir, labelOf, t, locale }) {
  const spans = tl.spans;
  const bands = spans.map((s, i) => {
    const w = s[dir];
    const full = w.complete ? (w.ids.length > 2 ? t("history.via", { nodes: w.ids.slice(1, -1).map(labelOf).join(", ") }) : t("history.direct"))
      : t("history.gap", { reason: w.reason });
    return { from: s.from, to: i + 1 < spans.length ? spans[i + 1].from : s.to, full, gap: !w.complete };
  });
  const series = [];
  const notes = [];
  let last = null;
  for (const p of tl.points) {
    const w = p[dir];
    const hop = w.weakest === null || w.weakest === undefined ? null : w.hops[w.weakest];
    series.push([p.t, hop ? hop.rankPct : null]);
    const key = hop ? `${hop.sender}>${hop.hearer}` : null;
    if (key && key !== last) {
      notes.push({ t: p.t, pct: hop.rankPct, text: t("history.weakest_at", { time: dayText(p.t, locale), from: labelOf(hop.sender),
        to: labelOf(hop.hearer), lqi: hop.lqi, pct: hop.rankPct }) });
    }
    if (key) last = key;
  }
  return { bands, series, notes };
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
    const m = directionModel({ tl, dir, labelOf, t, locale: t.formatLocale });
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
      const fits = b.full.length * CHAR < w - 8;
      if (fits) { const tx = svg("text", { x: x0 + 6, y: 15, class: "band-text" }); tx.textContent = b.full; band.append(tx); }
    }
    g.append(band);
    const chart = svg("g", { transform: "translate(0 28)" });
    for (const v of [0, 50, 100]) {
      chart.append(svg("line", { x1: left, x2: width - 8, y1: y(v), y2: y(v), class: "grid" }));
      const lb = svg("text", { x: left - 4, y: y(v) + 3, "text-anchor": "end", class: "lbl" }); lb.textContent = `${v} %`; chart.append(lb);
    }
    chart.append(svg("path", { d: linePath(m.series, x, y), fill: "none", stroke: color, "stroke-width": 1.4 }));
    for (const [tt, v] of m.series) if (v !== null) chart.append(svg("circle", { cx: x(tt), cy: y(v), r: 2.2, fill: color, class: "pt" }));
    // Every change of the weakest hop gets a dot; its name is written where there is room (greedy, left to right).
    let free = left;
    let drawn = 0;
    for (const n of m.notes) {
      const nx = x(n.t);
      chart.append(svg("circle", { cx: nx, cy: y(n.pct), r: 4, fill: color, class: "note-dot" }));
      const w = n.text.length * CHAR;
      const end = nx + w > width - 8;
      const [x0, x1] = end ? [nx - w - 4, nx] : [nx + 4, nx + w + 4];
      if (x0 < free) continue;
      free = x1 + 8;
      const tx = svg("text", { x: end ? nx - 4 : nx + 4, y: y(n.pct) + (drawn % 2 ? 18 : -8), "text-anchor": end ? "end" : "start", class: "lbl note" });
      tx.textContent = n.text;
      chart.append(tx);
      drawn += 1;
    }
    g.append(chart);
    const axis = svg("g", { transform: "translate(0 128)" });
    for (const k of timeTicks(from, to, Math.max(2, Math.floor(width / 70)))) {
      const tx = svg("text", { x: x(k.t), y: 12, "text-anchor": "middle", class: "lbl" }); tx.textContent = dayText(k.t, t.formatLocale); axis.append(tx);
    }
    g.append(axis);
    container.append(h("section", { class: "hist-dir" },
      h("h4", {}, h("span", { class: `dot ${dir}` }), `${t(`history.${dir}`)} `, h("small", { class: "muted", text: t("history.direction", { from: labelOf(s), to: labelOf(e) }) })),
      g, h("p", { class: "small muted", text: t("history.weakest") })));
  }
}
