// SPDX-License-Identifier: MIT
// The Route tab's drawing and controls (spec 9.5; boards M36 D4, D5): the Metro-Map or Mesh of ui/history-route.js on
// a canvas with the map's own symbols, lanes and pills (graph/symbols.js, graph/renderer.js drawLane and drawPill),
// the switch Metro-Map | Mesh, and the shared time slider with play and the record ticks. Runs in the browser.
import { h, svg } from "./dom.js";
import { drawLane, drawPill } from "../graph/renderer.js";
import { drawSymbol, symbolLayers, symbolParts } from "../graph/symbols.js";
import { directionColors, dayText, timeTicks, scale } from "./history-chart.js";
import { metroLayout, meshLayout, nearestIndex } from "./history-route.js";

const GHOST_ALPHA = 0.45;
const HEIGHT = 250;

/** Draw a layout. sel: { dir, sender, hearer } of the clicked pill (ringed with its two nodes) or null. deviceOf(id):
 *  the device for a station's symbol. Returns the clickable pills [{ item, x, y, w, h }]. */
export function drawRoute(ctx, layout, { theme, dpr, width, height, deviceOf, sel, mode, measure }) {
  const colors = directionColors(theme);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.font = theme.font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const size = layout.size;
  if (mode === "metro") {
    ctx.setLineDash([2, 3]);
    ctx.strokeStyle = theme.muted;
    ctx.lineWidth = 1;
    for (const v of layout.verticals) { ctx.beginPath(); ctx.moveTo(v.x, v.y0 + size / 2); ctx.lineTo(v.x, v.y1 - size / 2); ctx.stroke(); }
    ctx.setLineDash([]);
    ctx.textAlign = "left";
    for (const dir of ["there", "back"]) { ctx.fillStyle = colors[dir]; ctx.fillText(dir, 4, layout.rows[dir] - size); }
    ctx.textAlign = "center";
  }
  const arrow = (x, y, ux, uy, color) => { // arrowhead of a curve's end
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - ux * 8 - uy * 4, y - uy * 8 + ux * 4);
    ctx.lineTo(x - ux * 8 + uy * 4, y - uy * 8 - ux * 4);
    ctx.fill();
  };
  // Ghosts under everything: faded, dashed, no date (a route can change several times in a range).
  for (const it of layout.links.filter((l) => l.ghost)) {
    const color = colors[it.dir];
    ctx.globalAlpha = GHOST_ALPHA;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    ctx.setLineDash([6, 3]);
    if (it.curve) {
      const c = it.curve;
      ctx.beginPath(); ctx.moveTo(c.x0, c.y0); ctx.quadraticCurveTo(c.cx, c.cy, c.x1, c.y1); ctx.stroke();
      ctx.setLineDash([]);
      const [dx, dy] = [c.x1 - c.cx, c.y1 - c.cy];
      const d = Math.hypot(dx, dy) || 1;
      arrow(c.x1, c.y1, dx / d, dy / d, color);
    } else if (it.lane) {
      ctx.fillStyle = color;
      drawLane(ctx, it.lane, { width: 1.4, head: true });
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }
  for (const it of layout.links.filter((l) => !l.ghost && l.lane)) {
    const color = it.weakest ? colors.weak : colors[it.dir];
    ctx.globalAlpha = it.kind === "neighbour" ? 0.55 : 1;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.setLineDash(it.kind === "neighbour" ? [4, 3] : []);
    ctx.lineWidth = it.weakest ? 3 : it.kind === "neighbour" ? 1 : 1.8;
    drawLane(ctx, it.lane, { width: ctx.lineWidth, head: true });
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }
  const ringed = (s) => sel && (s.id === sel.sender || s.id === sel.hearer) && (mode === "mesh" || s.dir === sel.dir);
  ctx.font = theme.font;
  for (const s of layout.stations) {
    const device = deviceOf(s.id);
    ctx.globalAlpha = s.ghost ? GHOST_ALPHA : 1;
    drawSymbol(ctx, symbolLayers(symbolParts(device), {}), s.x, s.y, size, dpr,
      { fill: device.available === false ? theme.background : theme.node, stroke: theme.foreground, slash: false });
    if (ringed(s)) {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.roundRect(s.x - size / 2 - 3, s.y - size / 2 - 3, size + 6, size + 6, 8); ctx.stroke();
    }
    ctx.fillStyle = theme.foreground;
    ctx.textAlign = "center";
    const above = mode === "metro" && s.dir === "there";
    ctx.fillText(String(device.label || s.id).slice(0, 22), s.x, s.y + (above ? -size / 2 - 9 : size / 2 + 10));
    ctx.globalAlpha = 1;
  }
  const hits = [];
  for (const it of layout.links.filter((l) => l.pill)) {
    const picked = sel && sel.dir === it.dir && sel.sender === it.sender && sel.hearer === it.hearer;
    const color = it.weakest ? colors.weak : colors[it.dir];
    drawPill(ctx, { ...it.pill, color: picked ? theme.accent : color, alpha: it.ghost ? GHOST_ALPHA : 1,
      line: picked ? 3 : it.weakest ? 2.2 : 1, dash: it.ghost ? [3, 2] : null }, theme);
    hits.push({ item: it, x: it.pill.x, y: it.pill.y, w: it.pill.w + 4, h: it.pill.h + 4 });
  }
  return hits;
}

/** The pill under a point, or null (ghosts too). */
export function pillAt(hits, x, y) {
  return hits.find((p) => Math.abs(x - p.x) <= p.w / 2 && Math.abs(y - p.y) <= p.h / 2) || null;
}

/** Slider model: record ticks by time over [from, to] on a track of `width` px and date labels. */
export function sliderModel({ points, from, to, width, locale }) {
  const x = scale([from, to], [10, width - 10]);
  return { ticks: points.map((p, i) => ({ x: x(p.t), index: i })),
    labels: timeTicks(from, to, Math.max(2, Math.floor(width / 70))).map((k) => ({ x: x(k.t), text: dayText(k.t, locale) })), x };
}

/** The Route tab. ctx: { t, theme(), tl, from, to, getRoute(index), deviceOf, positionOf, state ({ mode, index, sel,
 *  playing }), onPill(item), onChange(), timers }. Returns { el, redraw(), hits(), destroy() }. */
export function createRouteView(ctx) {
  const { t, state, timers = globalThis } = ctx;
  const canvas = h("canvas", { class: "hist-canvas", "aria-label": t("history.tab_route") });
  const frame = h("div", { class: "hist-canvas-frame" }, canvas);
  const sliderBox = h("div", { class: "hist-slider" });
  let hitList = [];
  let timer = null;
  const measure = (s) => { const g = canvas.getContext("2d"); g.font = ctx.theme().font.replace(/(\d+(?:\.\d+)?)px/, "11.5px"); return g.measureText(s).width; };
  const stop = () => { if (timer !== null) { timers.clearInterval(timer); timer = null; } state.playing = false; };
  const switchButton = (mode) => h("button", { type: "button", class: `seg${state.mode === mode ? " on" : ""}`, "aria-pressed": String(state.mode === mode),
    text: t(mode === "metro" ? "history.metro" : "history.mesh"), on: { click: () => { state.mode = mode; redraw(); } } });

  function redraw() {
    const route = ctx.getRoute(state.index);
    const width = Math.max(280, frame.clientWidth || 600);
    const height = state.mode === "metro" ? HEIGHT : 300;
    const dpr = globalThis.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const theme = ctx.theme();
    if (route) {
      const layout = state.mode === "metro" ? metroLayout({ route, width, height, measure })
        : meshLayout({ route, positionOf: ctx.positionOf, width, height, measure });
      hitList = drawRoute(canvas.getContext("2d"), layout, { theme, dpr, width, height, deviceOf: ctx.deviceOf, sel: state.sel,
        mode: state.mode, measure });
    } else hitList = [];
    switchBox.replaceChildren(switchButton("metro"), switchButton("mesh"));
    drawSlider(width);
  }

  function drawSlider(width) {
    const model = sliderModel({ points: ctx.tl.points, from: ctx.from, to: ctx.to, width, locale: t.formatLocale });
    const current = ctx.tl.points[state.index];
    const thumb = current ? model.x(current.t) : 10;
    const track = svg("svg", { width, height: 44, role: "slider", tabindex: 0, "aria-label": t("history.slider"), "aria-valuemin": 0,
      "aria-valuemax": Math.max(0, ctx.tl.points.length - 1), "aria-valuenow": state.index, class: "hist-track" });
    track.append(svg("line", { x1: 10, x2: width - 10, y1: 14, y2: 14, class: "axis" }));
    for (const k of model.ticks) track.append(svg("line", { x1: k.x, x2: k.x, y1: 9, y2: 19, class: "tick" }));
    track.append(svg("circle", { cx: thumb, cy: 14, r: 7, class: "thumb" }));
    for (const l of model.labels) { const el = svg("text", { x: l.x, y: 38, "text-anchor": "middle", class: "lbl" }); el.textContent = l.text; track.append(el); }
    const pick = (e) => {
      const r = track.getBoundingClientRect();
      const frac = (e.clientX - r.left - 10) / Math.max(1, r.width - 20);
      const i = nearestIndex(ctx.tl.points, ctx.from + frac * (ctx.to - ctx.from));
      if (i >= 0 && i !== state.index) { state.index = i; redraw(); ctx.onChange(); }
    };
    track.addEventListener("pointerdown", (e) => { stop(); pick(e); track.setPointerCapture?.(e.pointerId); track.dragging = true; });
    track.addEventListener("pointermove", (e) => { if (track.dragging) pick(e); });
    track.addEventListener("pointerup", () => { track.dragging = false; });
    track.addEventListener("keydown", (e) => {
      const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      stop();
      state.index = Math.max(0, Math.min(ctx.tl.points.length - 1, state.index + d));
      redraw(); ctx.onChange();
    });
    const play = h("button", { type: "button", class: "icon-button", "aria-label": t(state.playing ? "history.pause" : "history.play"),
      title: t(state.playing ? "history.pause" : "history.play"), text: state.playing ? "❚❚" : "▶", on: { click: toggle } });
    const caption = h("div", { class: "small muted hist-record", text: current ? ctx.recordText(current.t) : "" });
    sliderBox.replaceChildren(h("div", { class: "hist-slider-row" }, play, track), caption);
  }

  function toggle() {
    if (state.playing) { stop(); redraw(); return; }
    if (state.index >= ctx.tl.points.length - 1) state.index = 0;
    state.playing = true;
    timer = timers.setInterval(() => {
      if (state.index >= ctx.tl.points.length - 1) { stop(); redraw(); return; }
      state.index += 1;
      redraw(); ctx.onChange();
    }, 700);
    redraw();
  }

  canvas.addEventListener("click", (e) => {
    const r = canvas.getBoundingClientRect();
    const hit = pillAt(hitList, e.clientX - r.left, e.clientY - r.top);
    if (hit) { stop(); ctx.onPill(hit.item); }
  });
  canvas.addEventListener("pointermove", (e) => {
    const r = canvas.getBoundingClientRect();
    canvas.style.cursor = pillAt(hitList, e.clientX - r.left, e.clientY - r.top) ? "pointer" : "";
  });
  const switchBox = h("div", { class: "hist-switch", role: "group", "aria-label": t("history.view") });
  const el = h("div", { class: "hist-route" }, switchBox, frame, sliderBox, h("p", { class: "small muted", text: t("history.pill_hint") }));
  return { el, redraw, hits: () => hitList, destroy: stop };
}
