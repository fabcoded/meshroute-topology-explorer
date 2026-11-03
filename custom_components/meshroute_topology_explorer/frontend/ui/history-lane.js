// SPDX-License-Identifier: MIT
// The Lane tab (spec 9.5, boards M36 and M35): both directions of one lane over a window, as LQI against time on one
// axis (blue "Y hears X", orange "X hears Y"), the dashed line at the clicked record, the areas "after now" and "lane
// not used yet", a hover crosshair with both values, a table alternative; Thread adds an RSSI chart below, never a
// second axis. Above the chart the lane strip: the route the pill belonged to with the lane's two nodes ringed.
// Model pure, drawing as SVG and the legend's symbol swatches. npm test
import { h, svg } from "./dom.js";
import { directionColors, linePath, nearestPoint, scale, timeText, timeTicks, dayText } from "./history-chart.js";
import { symbolSwatch } from "./legend-tab.js";

/** The lane window choices around a clicked record, as [key, half width in seconds]. */
export const LANE_WINDOWS = Object.freeze([["24h", 86400], ["48h", 2 * 86400], ["7d", 7 * 86400], ["30d", 30 * 86400]]);

/** What the chart draws: series (X hears Y orange, Y hears X blue) as [t, value|null] for LQI and RSSI, the regions
 *  without a lane or without records, the clicked time. `lane` = history.lane(...) (X = lane.a, Y = lane.b); now: epoch
 *  seconds; firstRecord: the time of the first loaded record or null. */
export function laneModel({ lane, now, firstRecord }) {
  const lqi = (pts) => pts.map(([t, v]) => [t, v]);
  const rssi = (pts) => pts.map((p) => [p[0], p.length > 2 ? p[2] : null]);
  const used = [lane.firstSeen.aHearsB, lane.firstSeen.bHearsA].filter((v) => v !== null);
  const usedFrom = used.length ? Math.min(...used) : null;
  const regions = [];
  if (now < lane.to) regions.push({ kind: "after_now", from: Math.max(now, lane.from), to: lane.to });
  const dataFrom = firstRecord === null ? lane.to : firstRecord;
  if (dataFrom > lane.from) regions.push({ kind: "none", from: lane.from, to: Math.min(dataFrom, lane.to) });
  const limit = usedFrom === null ? Math.min(now, lane.to) : usedFrom;
  if (limit > Math.max(dataFrom, lane.from)) regions.push({ kind: "not_used", from: Math.max(dataFrom, lane.from), to: Math.min(limit, lane.to) });
  const hasRssi = [...lane.aHearsB, ...lane.bHearsA].some((p) => p.length > 2);
  return { from: lane.from, to: lane.to, orange: lqi(lane.aHearsB), blue: lqi(lane.bHearsA),
    orangeRssi: rssi(lane.aHearsB), blueRssi: rssi(lane.bHearsA), hasRssi, regions, clicked: lane.context ? lane.context.t : null,
    records: lane.aHearsB.length };
}

const AREA_TEXT = { after_now: "history.lane_after_now", not_used: "history.lane_not_used", none: "history.lane_none" };

/** One chart as SVG. kind "lqi" (0..max) or "rssi" (dBm, auto range); width in px. Returns { svg, at(clientX) }. */
function chart(model, { t, theme, width, kind, max, now, clickedText, onHover }) {
  const colors = directionColors(theme);
  const [left, top, bottom] = [34, 8, 22];
  const height = kind === "lqi" ? 170 : 120;
  const series = kind === "lqi" ? [[model.blue, colors.there], [model.orange, colors.back]] : [[model.blueRssi, colors.there], [model.orangeRssi, colors.back]];
  const values = series.flatMap(([pts]) => pts.map((p) => p[1]).filter((v) => v !== null));
  const domain = kind === "lqi" ? [0, max] : [Math.min(-100, ...values) - 5, Math.max(-30, ...values) + 5];
  const x = scale([model.from, model.to], [left, width - 8]);
  const y = scale(domain, [height - bottom, top]);
  const g = svg("svg", { viewBox: `0 0 ${width} ${height}`, width: "100%", class: "hist-chart", role: "img",
    "aria-label": t(kind === "lqi" ? "history.lane_axis_lqi" : "history.lane_axis_rssi") });
  for (const r of model.regions) {
    const rect = svg("rect", { x: x(r.from), y: top, width: Math.max(0, x(r.to) - x(r.from)), height: height - bottom - top, class: `region ${r.kind}` });
    g.append(rect);
    if (kind === "lqi" && x(r.to) - x(r.from) > 60) {
      const tx = svg("text", { x: r.kind === "after_now" ? x(r.to) - 4 : x(r.from) + 4, y: top + 11, class: "lbl",
        "text-anchor": r.kind === "after_now" ? "end" : "start" });
      tx.textContent = t(AREA_TEXT[r.kind]);
      g.append(tx);
    }
  }
  const ticks = kind === "lqi" ? [0, Math.round(max / 2), max] : [Math.round(domain[0]), Math.round((domain[0] + domain[1]) / 2), Math.round(domain[1])];
  for (const v of ticks) {
    g.append(svg("line", { x1: left, x2: width - 8, y1: y(v), y2: y(v), class: "grid" }));
    const lb = svg("text", { x: left - 4, y: y(v) + 3, "text-anchor": "end", class: "lbl" }); lb.textContent = String(v); g.append(lb);
  }
  for (const k of timeTicks(model.from, model.to, Math.max(2, Math.floor(width / 80)))) {
    const lb = svg("text", { x: x(k.t), y: height - 6, "text-anchor": "middle", class: "lbl" });
    lb.textContent = k.day ? dayText(k.t, t.formatLocale) : timeText(k.t, t.formatLocale).split(" ").pop();
    g.append(lb);
  }
  const sparse = model.records < 3;
  for (const [pts, color] of series) {
    if (!sparse) g.append(svg("path", { d: linePath(pts, x, y), fill: "none", stroke: color, "stroke-width": 1.6, class: "line" }));
    for (const [tt, v] of pts) if (v !== null && (sparse || pts.length < 40)) g.append(svg("circle", { cx: x(tt), cy: y(v), r: 2.4, fill: color, class: "pt" }));
  }
  if (now >= model.from && now <= model.to) g.append(svg("line", { x1: x(now), x2: x(now), y1: top, y2: height - bottom, class: "now" }));
  if (model.clicked !== null) {
    g.append(svg("line", { x1: x(model.clicked), x2: x(model.clicked), y1: top, y2: height - bottom, class: "clicked" }));
    if (kind === "lqi" && clickedText) {
      const tx = svg("text", { x: x(model.clicked) + 4, y: height - bottom - 6, class: "lbl" }); tx.textContent = clickedText; g.append(tx);
    }
  }
  const cross = svg("line", { y1: top, y2: height - bottom, class: "cross", visibility: "hidden" });
  g.append(cross);
  const at = (clientX) => {
    const r = g.getBoundingClientRect();
    return model.from + ((((clientX - r.left) * width) / Math.max(1, r.width)) - left) / (width - 8 - left) * (model.to - model.from);
  };
  g.addEventListener("pointermove", (e) => {
    const tt = at(e.clientX);
    const p = nearestPoint(model.blue.length ? model.blue : model.orange, tt);
    if (!p) return;
    cross.setAttribute("x1", x(p[0])); cross.setAttribute("x2", x(p[0])); cross.setAttribute("visibility", "visible");
    onHover(p[0]);
  });
  g.addEventListener("pointerleave", () => { cross.setAttribute("visibility", "hidden"); onHover(null); });
  return g;
}

/** The lane strip: the route's nodes in travel order, the lane's two nodes ringed with the two directions between them
 *  in the chart's colours. ids: the route's node ids (or just the two), lane: [x, y]. */
export function laneStrip({ ids, pair, deviceOf, theme, t }) {
  const colors = directionColors(theme);
  const items = [];
  ids.forEach((id, i) => {
    const device = deviceOf(id);
    const ring = pair.includes(id);
    items.push(h("div", { class: `strip-node${ring ? " ringed" : ""}`, "data-id": id },
      symbolSwatch(device, theme, theme.neutral, { offline: device.available === false }, 32), h("span", { class: "small", text: device.label || id })));
    if (i + 1 < ids.length) {
      const both = pair.includes(id) && pair.includes(ids[i + 1]);
      const a = svg("svg", { width: 44, height: 20, viewBox: "0 0 44 20", "aria-hidden": "true", class: "strip-link" });
      if (both) {
        a.append(svg("path", { d: "M2 6H38M38 6l-5-3.5M38 6l-5 3.5", stroke: colors.there, fill: "none", "stroke-width": 2 }),
          svg("path", { d: "M42 14H6M6 14l5-3.5M6 14l5 3.5", stroke: colors.back, fill: "none", "stroke-width": 2 }));
      } else a.append(svg("path", { d: "M6 10H38M38 10l-5-3.5M38 10l-5 3.5", stroke: theme.muted, fill: "none", "stroke-width": 1, opacity: 0.6 }));
      items.push(a);
    }
  });
  return h("div", { class: "hist-strip", role: "group" }, items);
}

/** The tab. ctx: { t, theme, lane (history.lane), lqiMax, deviceOf, labelOf, now, firstRecord, ids (route nodes), context,
 *  fromRow, clickedText, windowKey, onWindow(key), state ({ table }), zone }. */
export function renderLane(container, ctx) {
  const { t, lane, context } = ctx;
  const model = laneModel({ lane, now: ctx.now, firstRecord: ctx.firstRecord });
  const [x, y] = [lane.a, lane.b]; // X hears Y orange, Y hears X blue
  const colors = directionColors(ctx.theme);
  container.replaceChildren();
  const windows = ctx.fromRow ? [h("span", { class: "seg on static", text: t("history.lane_range_last") })]
    : LANE_WINDOWS.map(([key]) => h("button", { type: "button", class: `seg${ctx.windowKey === key ? " on" : ""}`, "aria-pressed": String(ctx.windowKey === key),
      text: t(`history.lane_range_${key}`), on: { click: () => ctx.onWindow(key) } }));
  const title = h("h3", { class: "hist-lane-title", text: t("history.lane_title", { x: ctx.labelOf(x), y: ctx.labelOf(y) }) });
  const nodes = context && context.ids.length ? context.ids : [x, y];
  const strip = laneStrip({ ids: nodes, pair: [x, y], deviceOf: ctx.deviceOf, theme: ctx.theme, t });
  const from = context ? h("p", { class: "small muted hist-lane-from", text: t("history.lane_from", {
    way: t(context.direction === "there" ? "history.way_there" : "history.way_back"), time: timeText(context.t, t.formatLocale, ctx.zone),
    n: context.hopIndex + 1, count: context.hopCount }) }) : h("p", { class: "small muted hist-lane-from", text: t("history.lane_from_row") });
  const readout = h("div", { class: "small hist-readout", "aria-live": "off" });
  const width = Math.max(300, ctx.width || 600);
  const max = ctx.lqiMax;
  const find = (pts, tt) => { const p = pts.find((q) => q[0] === tt); return p && p[1] !== null ? String(p[1]) : t("history.lane_none"); };
  const hover = (tt) => {
    readout.textContent = tt === null ? "" : t("history.lane_hover", { time: timeText(tt, t.formatLocale, ctx.zone), x: ctx.labelOf(x), y: ctx.labelOf(y),
      a: find(model.orange, tt), b: find(model.blue, tt) });
  };
  const legend = h("div", { class: "hist-legend small" },
    h("span", {}, h("i", { class: "key", style: { background: colors.there } }), t("history.lane_hears", { x: ctx.labelOf(x), y: ctx.labelOf(y) })),
    h("span", {}, h("i", { class: "key", style: { background: colors.back } }), t("history.lane_hears", { x: ctx.labelOf(y), y: ctx.labelOf(x) })));
  const opts = { t, theme: ctx.theme, width, max, now: ctx.now, clickedText: ctx.clickedText, onHover: hover };
  const charts = h("div", { class: "hist-charts" }, chart(model, { ...opts, kind: "lqi" }), model.hasRssi ? chart(model, { ...opts, kind: "rssi" }) : null);
  const table = h("table", { class: "hist-table" }, h("thead", {}, h("tr", {}, h("th", { text: t("history.lane_col_time") }),
    h("th", { text: t("history.lane_hears", { x: ctx.labelOf(y), y: ctx.labelOf(x) }) }), h("th", { text: t("history.lane_hears", { x: ctx.labelOf(x), y: ctx.labelOf(y) }) }))),
  h("tbody", {}, model.blue.map((p, i) => h("tr", {}, h("td", { text: timeText(p[0], t.formatLocale, ctx.zone) }),
    h("td", { text: p[1] === null ? "–" : String(p[1]) }), h("td", { text: model.orange[i][1] === null ? "–" : String(model.orange[i][1]) })))));
  const asTable = ctx.state.table;
  const toggle = h("button", { type: "button", class: "link", text: t(asTable ? "history.lane_chart" : "history.lane_table"),
    on: { click: () => { ctx.state.table = !ctx.state.table; renderLane(container, ctx); } } });
  container.append(h("div", { class: "hist-lane-head" }, h("div", { class: "hist-seg", role: "group" }, windows)), title, strip, from,
    asTable ? h("div", { class: "scroll" }, table) : charts, asTable ? null : readout, asTable ? null : legend, toggle);
}
