// SPDX-License-Identifier: MIT
// Prototype behind dev/links.html (not shipped): the sample network on the quality view's layout (computed once at
// D = 1 with seed 1, as the panel does), drawn in one of eight ways that show both directions of a pair and how well
// each direction is evidenced; option 8 is the default Fabian Schwamborn chose after options 1-7 (used links green).
// Evidence per pair: "both" (a reading in each direction), "one" (a reading in one direction only), "implied" (no
// reading, but an active route's next hop or a parent proves the link). A reading "R hears S" belongs to R, the
// reporter (spec 4.3). See dev/links.html for serving and the query keys.

import { Layout, baseLength } from "../custom_components/meshroute_topology_explorer/frontend/graph/layout.js";
import {
  buildScene, hitTest, markerRadius, valueText, NODE_DIAMETER,
} from "../custom_components/meshroute_topology_explorer/frontend/graph/renderer.js";
import {
  LIGHT, DARK, OKABE_ITO, resolveTheme, ratingColor, fillColor, ensureContrast, parseColor, toHex, luminance,
  contrastRatio,
} from "../custom_components/meshroute_topology_explorer/frontend/graph/palette.js";
import {
  bounds, fitCamera, toScreen, zoomAt, panBy,
} from "../custom_components/meshroute_topology_explorer/frontend/graph/camera.js";
import { buildNetwork, upPath } from "../custom_components/meshroute_topology_explorer/frontend/model/index.js";

const q = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const canvas = $("map");
const ctx = canvas.getContext("2d");
const S = {
  option: Math.min(8, Math.max(1, Number(q.get("option")) || 1)), implied: q.get("implied") === "1",
  all: q.get("all") === "1", selected: -1, pair: null, cam: null, moved: false, w: 0, h: 0, dpr: 1,
  path: [], faded: new Set(),
};
let theme; let net; let scene; let ev; let pos; let sx; let sy;

const DASHED = [4, 4];
const DOTTED = [1.5, 4];
const LINE_HEIGHT = 14;
/** Option 8: contrast of the four strength steps against the background; 3.2:1 keeps a margin over WCAG's 3:1. */
const STEPS = [3.2, 4.5, 6.5, 9];

// ---- data -----------------------------------------------------------------------------------------------------------

const widths = new Map();
const measure = (text) => {
  if (!widths.has(text)) { ctx.font = theme.font; widths.set(text, ctx.measureText(text).width); }
  return widths.get(text);
};
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const rating = (rd) => (rd ? num(rd.rating) : null);
/** Colour of a rating, or the muted grey for "no rating" (no reading, or LQI 0). */
const colorOf = (r) => (r === null ? theme.muted : ratingColor(r, theme));
/** The reading "x hears the other end of p", or null. */
const hears = (p, x) => (x === p.a ? p.ab : p.ba);
const other = (p, x) => (x === p.a ? p.b : p.a);
const byRating = (r, s) => (rating(s) ?? -1) - (rating(r) ?? -1);
const better = (p) => [p.ab, p.ba].filter(Boolean).sort(byRating)[0] || null;
/** Worse of the known readings; a missing direction is unknown, not worse, so a one-sided pair keeps its reading. */
const worse = (p) => [p.ab, p.ba].filter(Boolean).sort(byRating).pop() || null;
const isFocus = (p) => S.selected >= 0 && (p.a === S.selected || p.b === S.selected);
/** Text for a direction without a reading: "–" if the reporter has a table that does not list the other end (it may
 *  be full: several routers of the sample list exactly 16), "?" if the reporter has no table at all. */
const missingText = (reporter) => (ev.table[reporter] ? "–" : "?");
const valueOf = (p, reporter) => {
  const rd = hears(p, reporter);
  return rd ? valueText(rd.lqi, "0?") : missingText(reporter);
};

/** Strength step 0..3 of a reading (the quarter of its rating), null without a rating (no reading, or LQI 0). */
const stepOf = (rd) => {
  const r = rating(rd);
  return r === null ? null : Math.min(3, Math.floor(r * 4));
};
/** Used: on an up path or an active route's next hop, or an end device's parent link. Up path hops are route next hops
 *  or parent links, so this is every pair an active, current route or a parent proves. */
const isUsed = (p) => p.via.size > 0;
const pathOf = (i) => upPath(net, scene.nodes[i].id);

/** Evidence pairs from the scene's reading pairs plus links proven by routes and parents. */
function evidence() {
  const n = scene.nodes.length;
  const dev = new Map(net.devices.map((d) => [d.id, d]));
  const table = scene.nodes.map((node) => Boolean(dev.get(node.id) && dev.get(node.id).hasTable));
  const entries = scene.nodes.map((node) => net.readings.filter((r) => r.reporter === node.id).length);
  const key = (a, b) => Math.min(a, b) * n + Math.max(a, b);
  const byKey = new Map();
  const add = (a, b, ab, ba, best) => byKey.set(key(a, b), { a, b, ab, ba, best, via: new Set() });
  for (const p of scene.pairs) add(p.a, p.b, p.ab || null, p.ba || null, p.best);
  const prove = (x, y, why) => {
    const a = scene.index.get(x);
    const b = scene.index.get(y);
    if (a === undefined || b === undefined || a === b) return;
    if (!byKey.has(key(a, b))) add(Math.min(a, b), Math.max(a, b), null, null, false);
    byKey.get(key(a, b)).via.add(why);
  };
  // Stale routes (from an unavailable device's table) and inactive ones prove nothing, as for paths (spec 4.4, 5.1).
  for (const r of net.routes) if (!r.stale && /^active$/i.test(r.status)) prove(r.owner, r.nextHop, "route");
  for (const d of net.devices) if (d.parent) prove(d.id, d.parent, "parent");
  const pairs = [...byKey.values()].sort((p, s) => p.a - s.a || p.b - s.b);
  const count = { both: 0, one: 0, implied: 0, oneTable: 0 };
  for (const p of pairs) {
    p.cls = p.ab && p.ba ? "both" : p.ab || p.ba ? "one" : "implied";
    count[p.cls]++;
    if (p.cls === "one" && table[p.ab ? p.b : p.a]) count.oneTable++;
  }
  count.none = (n * (n - 1)) / 2 - pairs.length;
  const neighbours = scene.nodes.map(() => []);
  for (const p of pairs) { neighbours[p.a].push(p); neighbours[p.b].push(p); }
  return { pairs, table, entries, neighbours, count, pairOf: (a, b) => byKey.get(key(a, b)) || null };
}

/** Pairs drawn now: each device's 3 best (spec 7.1) or all, every pair of the selection, implied ones on request.
 *  Every option draws the same pairs, so the pictures differ only in how a pair is drawn. */
const shownPairs = () => ev.pairs.filter((p) =>
  (p.cls !== "implied" || S.implied) && (S.all || p.best || p.cls === "implied" || isFocus(p)));

// ---- primitives (they take a context, so the legend swatches use the same code) -------------------------------------

function seg(c, x0, y0, x1, y1, stroke, width, dash = [], alpha = 1) {
  c.globalAlpha = alpha;
  c.setLineDash(dash);
  c.lineCap = dash === DOTTED ? "round" : "butt";
  c.lineWidth = width;
  c.strokeStyle = stroke;
  c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
  c.globalAlpha = 1;
  c.setLineDash([]);
}

function arrow(c, x, y, ux, uy, fill) {
  c.fillStyle = fill;
  c.beginPath();
  c.moveTo(x + ux * 4, y + uy * 4);
  c.lineTo(x - ux * 3 - uy * 3.5, y - uy * 3 + ux * 3.5);
  c.lineTo(x - ux * 3 + uy * 3.5, y - uy * 3 - ux * 3.5);
  c.closePath();
  c.fill();
}

/** A right triangle from its tip (x0, y0) to a base of width w at (x1, y1), on the right of the way tip -> base. */
function wedge(c, x0, y0, x1, y1, w, fill) {
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  const nx = -(y1 - y0) / len;
  const ny = (x1 - x0) / len;
  c.fillStyle = fill;
  c.beginPath();
  c.moveTo(x0 + nx * 0.5, y0 + ny * 0.5);
  c.lineTo(x1 + nx * 0.5, y1 + ny * 0.5);
  c.lineTo(x1 + nx * (0.5 + w), y1 + ny * (0.5 + w));
  c.closePath();
  c.fill();
}

/** Quadratic arc from (x0, y0) to (x1, y1) bulging b pixels to the right of its way. Returns at(t): the point and
 *  unit tangent at t, for an arrowhead or a value. */
function arc(c, x0, y0, x1, y1, b, stroke, width, dash) {
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  const cx = (x0 + x1) / 2 - ((y1 - y0) / len) * b;
  const cy = (y0 + y1) / 2 + ((x1 - x0) / len) * b;
  c.setLineDash(dash);
  c.lineWidth = width;
  c.strokeStyle = stroke;
  c.beginPath(); c.moveTo(x0, y0); c.quadraticCurveTo(cx, cy, x1, y1); c.stroke();
  c.setLineDash([]);
  return (t) => {
    const u = 1 - t;
    const tx = 2 * u * (cx - x0) + 2 * t * (x1 - cx);
    const ty = 2 * u * (cy - y0) + 2 * t * (y1 - cy);
    const tl = Math.hypot(tx, ty) || 1;
    const x = u * u * x0 + 2 * u * t * cx + t * t * x1;
    return { x, y: u * u * y0 + 2 * u * t * cy + t * t * y1, ux: tx / tl, uy: ty / tl };
  };
}

/** Screen geometry from device i to device j; (nx, ny) is the right-hand normal of that way (y points down). */
function way(i, j) {
  const dx = sx[j] - sx[i];
  const dy = sy[j] - sy[i];
  const len = Math.hypot(dx, dy);
  if (len < 1) return null;
  return { x0: sx[i], y0: sy[i], x1: sx[j], y1: sy[j], dx, dy, len, ux: dx / len, uy: dy / len,
    nx: -dy / len, ny: dx / len };
}

/** Value of a reporter's reading in the reporter's half, about 24 px from the middle, beside the line: near the
 *  middle the values of a hub's many pairs spread out instead of piling up around the hub. */
function textNear(texts, p, reporter, side = 9) {
  const g = way(reporter, other(p, reporter));
  if (!g || g.len < 40) return;
  const t = 0.5 - Math.min(0.24, 24 / g.len);
  texts.push({ text: valueOf(p, reporter), x: g.x0 + g.dx * t + g.nx * side, y: g.y0 + g.dy * t + g.ny * side });
}

function impliedLine(p, focus, texts) {
  const g = way(p.a, p.b);
  if (!g) return;
  seg(ctx, g.x0, g.y0, g.x1, g.y1, theme.muted, focus ? 2.5 : 1.5, DOTTED);
  if (focus) texts.push({ text: [...p.via].join(" + "), x: g.x0 + g.dx / 2 + g.nx * 9, y: g.y0 + g.dy / 2 + g.ny * 9 });
}

/** Draw every shown pair with fn(p, focus): plain pairs first, the selection's on top; implied ones dotted. */
function eachPair(pairs, texts, fn) {
  for (const focus of [false, true]) {
    for (const p of pairs) {
      if (isFocus(p) !== focus) continue;
      if (p.cls === "implied") impliedLine(p, focus, texts); else fn(p, focus);
    }
  }
}

// ---- the seven options ----------------------------------------------------------------------------------------------

/** 1: today's view (spec 7.1): one line per pair by the better rating; the selection's pairs as two lanes. */
function baseline(pairs, texts) {
  eachPair(pairs, texts, (p, focus) => {
    const g = way(p.a, p.b);
    if (!g) return;
    if (!focus) {
      const r = rating(better(p));
      seg(ctx, g.x0, g.y0, g.x1, g.y1, colorOf(r), r === null ? 1 : 1 + r * 1.5, r === null ? DASHED : []);
      return;
    }
    // Each reading "R hears S" travels S -> R, on the right of that way, with its value beside it.
    for (const [from, to] of [[p.b, p.a], [p.a, p.b]]) {
      const h = way(from, to);
      const rd = hears(p, to);
      const r = rating(rd);
      const [ox, oy] = [h.nx * 3, h.ny * 3];
      seg(ctx, h.x0 + ox, h.y0 + oy, h.x1 + ox, h.y1 + oy, colorOf(r), 2, r === null ? DASHED : []);
      if (h.len >= 24) arrow(ctx, h.x0 + ox + h.dx * 0.6, h.y0 + oy + h.dy * 0.6, h.ux, h.uy, colorOf(r));
      const text = rd ? valueText(rd.lqi, "0?") : "?";
      if (h.len >= 48) texts.push({ text, x: h.x0 + h.dx / 2 + ox * 3.5, y: h.y0 + h.dy / 2 + oy * 3.5 });
    }
  });
}

/** The two halves of a pair, fn(end, x0, y0, x1, y1) per half; a small break marks the middle, where two similar
 *  colours would otherwise run into each other. */
function eachHalf(p, fn) {
  const g = way(p.a, p.b);
  if (!g) return;
  const gap = Math.min(2, g.len / 8) / g.len;
  for (const [end, t0, t1] of [[p.a, 0, 0.5 - gap], [p.b, 0.5 + gap, 1]]) {
    fn(end, g.x0 + g.dx * t0, g.y0 + g.dy * t0, g.x0 + g.dx * t1, g.y0 + g.dy * t1);
  }
}

/** 2: two halves per pair; the half at each end shows what that end hears, a missing half is dashed grey. */
function halves(pairs, texts) {
  eachPair(pairs, texts, (p, focus) => eachHalf(p, (end, x0, y0, x1, y1) => {
    const r = rating(hears(p, end));
    const width = r === null ? (focus ? 2 : 1) : focus ? 3 : 1 + r * 1.5;
    seg(ctx, x0, y0, x1, y1, colorOf(r), width, r === null ? DASHED : []);
    if (focus) textNear(texts, p, end);
  }));
}

/** 3: one wedge per reading, wide at the device that hears, width by rating (tapered edges after Holten and van Wijk
 *  2009). The two wedges of a pair lie on opposite sides of the centre line, so they never cover each other. */
function wedges(pairs, texts) {
  eachPair(pairs, texts, (p, focus) => {
    for (const rep of [p.a, p.b]) {
      const rd = hears(p, rep);
      const g = rd && way(other(p, rep), rep); // tip at the subject, base at the reporter
      if (g) {
        const r = rating(rd);
        wedge(ctx, g.x0, g.y0, g.x1, g.y1, focus ? 3 + (r ?? 0) * 6 : 1.5 + (r ?? 0) * 4.5, colorOf(r));
      }
      // The value sits on the side of the reporter's own wedge (left of reporter -> subject), beyond its width.
      if (focus) textNear(texts, p, rep, -15);
    }
  });
}

/** 4: line style is the evidence (solid both ways, half dashed one way, dotted implied), colour the worse reading. */
function evidenceStyle(pairs, texts) {
  eachPair(pairs, texts, (p, focus) => {
    const g = way(p.a, p.b);
    if (!g) return;
    const r = rating(worse(p));
    const width = focus ? 3 : 1 + (r ?? 0) * 1.5;
    const [mx, my] = [g.x0 + g.dx / 2, g.y0 + g.dy / 2];
    // One way only: solid on the half of the device that reported, dashed on the half of the one that did not.
    seg(ctx, g.x0, g.y0, mx, my, colorOf(r), width, p.ab ? [] : DASHED);
    seg(ctx, mx, my, g.x1, g.y1, colorOf(r), width, p.ba ? [] : DASHED);
    if (focus) { textNear(texts, p, p.a); textNear(texts, p, p.b); }
  });
}

/** The two arcs of a pair of the selection s: "in" (s hears x, travelling x -> s) and "out" (x hears s, travelling
 *  s -> x), each bulging right of its way, with an arrowhead and the value at its apex. paint(reading) gives
 *  { color, width, dash }. */
function arcPair(p, s, texts, paint) {
  const x = other(p, s);
  for (const [from, to] of [[x, s], [s, x]]) {
    const g = way(from, to);
    if (!g) continue;
    const rd = hears(p, to);
    const { color, width, dash } = paint(rd);
    const at = arc(ctx, g.x0, g.y0, g.x1, g.y1, Math.max(8, Math.min(22, g.len * 0.15)), color, width, dash);
    if (rd && g.len >= 36) { const a = at(0.75); arrow(ctx, a.x, a.y, a.ux, a.uy, color); }
    const mid = at(0.5);
    if (g.len >= 40) texts.push({ text: valueOf(p, to), x: mid.x + g.nx * 8, y: mid.y + g.ny * 8 });
  }
}

/** 5: calm grey lines; the selection fans out into arcs: into it what it hears, out of it who hears it. */
function fan(pairs, texts) {
  const s = S.selected;
  for (const p of pairs) {
    const g = !isFocus(p) && way(p.a, p.b);
    if (g) seg(ctx, g.x0, g.y0, g.x1, g.y1, theme.muted, 1, p.cls === "implied" ? DOTTED : [], s >= 0 ? 0.3 : 0.6);
  }
  const paint = (rd) => {
    const r = rating(rd);
    return { color: colorOf(r), width: rd ? 2.5 : 1.5, dash: r === null ? [3, 3] : [] };
  };
  for (const p of pairs) {
    if (!isFocus(p)) continue;
    if (p.cls === "implied") impliedLine(p, true, texts); else arcPair(p, s, texts, paint);
  }
}

/** 6: the map as today plus a highlight for the pair picked in the matrix. */
function matrixMap(pairs, texts) {
  const g = S.pair && way(S.pair.a, S.pair.b);
  if (g) seg(ctx, g.x0, g.y0, g.x1, g.y1, theme.accent, 10, [], 0.3);
  baseline(pairs, texts);
}

/** 7, after the markers: a ring per device with a table, its arcs the shares of two-sided, one-sided and implied
 *  pairs (all of them, not only those drawn). Devices without a table get none: their side is always unknown. */
function rings() {
  for (let i = 0; i < scene.nodes.length; i++) {
    if (!ev.table[i]) continue;
    const c = { both: 0, one: 0, implied: 0 };
    for (const p of ev.neighbours[i]) if (p.cls !== "implied" || S.implied) c[p.cls]++;
    const total = c.both + c.one + c.implied;
    if (!total) continue;
    const R = markerRadius(scene.nodes[i].role, S.cam.k) + 4.5;
    const parts = [["both", theme.foreground, 2], ["one", theme.one, 4], ["implied", theme.muted, 2]]
      .filter(([k]) => c[k]);
    const gap = parts.length > 1 ? 0.25 : 0;
    let a = -Math.PI / 2;
    for (const [k, col, width] of parts) {
      const span = (2 * Math.PI * c[k]) / total;
      ctx.beginPath();
      ctx.arc(sx[i], sy[i], R, a + gap / 2, a + Math.max(span - gap / 2, gap / 2 + 0.05));
      ctx.lineWidth = width;
      ctx.strokeStyle = col;
      ctx.stroke();
      a += span;
    }
  }
}

/** Option 8 paint of one half or arc: used links green, unused grey, both in the equal-contrast steps of the theme
 *  (darker on light themes, lighter on dark ones) and wider with strength; without a rating dashed in the weakest
 *  step. strong: on the selection's up path. */
function paint8(p, rd, strong) {
  const k = stepOf(rd);
  const used = isUsed(p);
  const width = (used ? 2 : 1) + (k ?? 0) * (used ? 0.5 : 0.3) + (strong ? 1.5 : 0) - (k === null ? 0.5 : 0);
  return { color: (used ? theme.green : theme.grey)[k ?? 0], width, dash: k === null ? DASHED : [] };
}

/** 8, the default Fabian Schwamborn chose (2026-10-31): used links always, green; unused ones grey under the line
 *  filter (3 best per device, or all); both as half-lines. With a selection: its up path to the coordinator on a
 *  green band with each hop's values, its pairs as the arcs of option 5, everything else dimmed. */
function usedLinks(pairs, texts) {
  const s = S.selected;
  const onPath = new Set(S.path.slice(1).map((j, n) => ev.pairOf(S.path[n], j)).filter(Boolean));
  for (const p of onPath) {
    const g = way(p.a, p.b);
    if (g) seg(ctx, g.x0, g.y0, g.x1, g.y1, theme.green[1], 11, [], 0.3);
  }
  const plain = [...pairs.filter((p) => !isUsed(p)), ...ev.pairs.filter(isUsed)].filter((p) => !isFocus(p));
  for (const p of plain) {
    const path = onPath.has(p);
    const dim = s >= 0 && !path; // dimmed: thin and faint, a backdrop for the selection rather than a picture
    eachHalf(p, (end, x0, y0, x1, y1) => {
      const { color, width, dash } = paint8(p, hears(p, end), path);
      seg(ctx, x0, y0, x1, y1, color, dim ? Math.min(width, 1.5) : width, dash, dim ? 0.15 : 1);
      if (path) textNear(texts, p, end);
    });
  }
  if (s >= 0) for (const p of ev.neighbours[s]) arcPair(p, s, texts, (rd) => paint8(p, rd, onPath.has(p)));
}

// ---- legends --------------------------------------------------------------------------------------------------------

/** Legend swatches are 40 x 14 CSS pixels; m is the middle line. */
const W = 40;
const m = 7;
const line = (col, width, dash = []) => (c) => seg(c, 2, m, W - 2, m, col(), width, dash);
const SCALE = [(c) => {
  for (let x = 0; x < W; x++) { c.fillStyle = ratingColor(x / (W - 1), theme); c.fillRect(x, 2, 1, 10); }
}, "rating: weakest → strongest of what the reporter hears"];
const IMPLIED = [line(() => theme.muted, 1.5, DOTTED), "implied: no reading, a route or parent proves it"];
const MISSING = [null, "– its table does not list the other (may be full) · ? it has no table"];
/** Four equal-contrast steps side by side. */
const ramp = (colors) => (c) => colors().forEach((col, i) => { c.fillStyle = col; c.fillRect(i * 10, 2, 10, 10); });
const LEGENDS = {
  1: [SCALE, [line(() => ratingColor(0.8, theme), 2.2), "one line per pair, better rating"],
    [(c) => {
      seg(c, 2, m - 3, W - 2, m - 3, ratingColor(0.8, theme), 2);
      arrow(c, W * 0.6, m - 3, 1, 0, ratingColor(0.8, theme));
      seg(c, W - 2, m + 3, 2, m + 3, theme.muted, 2, DASHED);
    }, "selection: a lane per direction of travel, ? no reading"]],
  2: [SCALE, [(c) => {
    seg(c, 2, m, W / 2 - 2, m, ratingColor(0.9, theme), 2.5);
    seg(c, W / 2 + 2, m, W - 2, m, ratingColor(0.2, theme), 1.3);
  }, "each half: what the device at that end hears"],
  [(c) => {
    seg(c, 2, m, W / 2 - 2, m, ratingColor(0.7, theme), 2);
    seg(c, W / 2 + 2, m, W - 2, m, theme.muted, 1, DASHED);
  }, "dashed grey half: that end has no reading"], MISSING],
  3: [SCALE, [(c) => wedge(c, W - 2, m, 2, m, 6, ratingColor(0.8, theme)),
    "wedge: wide at the device that hears, width by rating"],
  [(c) => {
    wedge(c, W - 2, m, 2, m, 5, ratingColor(0.7, theme));
    wedge(c, 2, m, W - 2, m, 2.5, ratingColor(0.3, theme));
  },
    "two wedges: heard both ways; one wedge: one way known"], MISSING],
  4: [SCALE, [line(() => ratingColor(0.6, theme), 2), "solid: heard both ways, colour of the worse"],
    [(c) => {
      seg(c, 2, m, W / 2, m, ratingColor(0.6, theme), 2);
      seg(c, W / 2, m, W - 2, m, ratingColor(0.6, theme), 2, DASHED);
    }, "half dashed: one way only, dashed at the end without a reading"], IMPLIED, MISSING],
  5: [[line(() => theme.muted, 1), "grey: links (calm until something is selected)"], SCALE,
    [(c) => {
      arc(c, W - 2, 11, 2, 11, 7, ratingColor(0.8, theme), 2.5, []);
      arrow(c, 7, 8, -1, 0.3, ratingColor(0.8, theme));
    }, "arc with arrow into the selection: it hears; out of it: it is heard"],
    [(c) => arc(c, 2, 3, W - 2, 3, 7, theme.muted, 1.5, [3, 3]), "dashed arc: no reading"], MISSING],
  6: [SCALE,
    [(c) => { c.fillStyle = ratingColor(0.7, theme); c.fillRect(W / 2 - 6, 1, 12, 12); }, "cell: row hears column"],
    [(c) => { c.strokeStyle = theme.muted; c.lineWidth = 1; c.strokeRect(W / 2 - 6, 1.5, 12, 11); },
      "empty: row's table does not list column"],
    [(c) => { for (let x = -6; x < 12; x += 4) seg(c, W / 2 - 6 + x, 13, W / 2 + 6 + x, 1, theme.muted, 1); },
      "hatched: row has no table"], [null, "• implied (route or parent), no reading"]],
  7: [SCALE, [line(() => ratingColor(0.8, theme), 2.2), "lines as today"],
    [(c) => {
      c.lineWidth = 2; c.strokeStyle = theme.foreground; c.beginPath(); c.arc(W / 2, m, 5, -1.4, 2.8); c.stroke();
      c.lineWidth = 4; c.strokeStyle = theme.one; c.beginPath(); c.arc(W / 2, m, 5, 3.0, 4.6); c.stroke();
    }, "ring: share of pairs heard both ways (thin, text colour) and one way (thick, vermillion)"],
    [null, "grey arc: implied · no ring: no table"]],
  8: [[ramp(() => theme.green), "used (up path, route next hop, parent), always drawn: weakest → strongest of what " +
    "that end hears"], [ramp(() => theme.grey), "unused: the same steps in grey"],
  [(c) => {
    seg(c, 2, m, W / 2 - 2, m, theme.green[2], 3);
    seg(c, W / 2 + 2, m, W - 2, m, theme.green[0], 1.5, DASHED);
  }, "dashed half: that end has no reading"], MISSING,
  [(c) => { seg(c, 2, m, W - 2, m, theme.green[1], 11, [], 0.3); seg(c, 2, m, W - 2, m, theme.green[3], 3.5); },
    "selection: its path to the coordinator; its pairs as arcs (in: it hears, out: it is heard)"]],
};

function renderLegend() {
  const box = $("legend");
  box.replaceChildren();
  const items = [...LEGENDS[S.option]];
  if (S.implied && S.option !== 4 && S.option !== 8) items.push(IMPLIED); // option 8 draws them anyway, as used
  const dpr = window.devicePixelRatio || 1;
  for (const [drawSwatch, text] of items) {
    const span = document.createElement("span");
    if (drawSwatch) {
      const c = document.createElement("canvas");
      c.width = W * dpr; c.height = 14 * dpr;
      c.style.width = `${W}px`; c.style.height = "14px";
      const cc = c.getContext("2d");
      cc.scale(dpr, dpr);
      drawSwatch(cc);
      span.append(c);
    }
    span.append(document.createTextNode(text));
    box.append(span);
  }
}

// ---- matrix (option 6) ----------------------------------------------------------------------------------------------

/** One direction of a pair as a sentence, for the cell's title and the status line. */
function cellText(r, c) {
  const p = ev.pairOf(r, c);
  const rd = p && hears(p, r);
  const name = (i) => scene.nodes[i].label;
  if (rd) {
    const rt = rating(rd);
    return `${name(r)} hears ${name(c)}: LQI ${valueText(rd.lqi, "0 (uncertain)")}` +
      (rt === null ? ", not rated" : `, rating ${Math.round(rt * 100)} %`);
  }
  if (!ev.table[r]) return `${name(r)} has no table: unknown whether it hears ${name(c)}`;
  const proof = p && p.via.size ? `; ${[...p.via].join(" + ")} proves the link` : "";
  return `${name(c)} is not in ${name(r)}'s table (${ev.entries[r]} entries)${proof}`;
}

const pairStatus = (a, b) => status(`${cellText(a, b)}. ${cellText(b, a)}.`);

function renderMatrix() {
  const side = $("side");
  side.hidden = S.option !== 6;
  if (side.hidden) return;
  side.replaceChildren();
  const note = document.createElement("p");
  side.append(note);
  if (S.selected < 0) { note.textContent = "Select a device: its neighbourhood appears here as a matrix."; return; }
  const s = S.selected;
  const rank = { both: 0, one: 1, implied: 2 };
  const lqi = (p) => num(hears(p, s) && hears(p, s).lqi) ?? -1;
  const list = ev.neighbours[s].filter((p) => p.cls !== "implied" || S.implied)
    .sort((p, t) => rank[p.cls] - rank[t.cls] || lqi(t) - lqi(p) || other(p, s) - other(t, s));
  const ids = [s, ...list.map((p) => other(p, s))];
  note.textContent = `Rows hear columns. ${scene.nodes[s].label} and its ${ids.length - 1} neighbours; ` +
    "two-sided first, then one-sided, then implied.";
  const table = document.createElement("table");
  const head = table.createTHead().insertRow();
  head.append(document.createElement("th"));
  const header = (i) => {
    const th = document.createElement("th");
    th.textContent = scene.nodes[i].label;
    if (i === s) th.className = "sel";
    return th;
  };
  for (const c of ids) head.append(header(c));
  const body = table.createTBody();
  for (const r of ids) {
    const row = body.insertRow();
    row.append(header(r));
    for (const c of ids) {
      const td = row.insertCell();
      if (r === c) { td.className = "self"; continue; }
      const p = ev.pairOf(r, c);
      const rd = p && hears(p, r);
      if (rd) td.style.background = colorOf(rating(rd));
      else if (!ev.table[r]) td.className = "notable";
      else if (p && p.via.size) td.textContent = "•";
      if (S.pair && p === S.pair) td.classList.add("hit");
      td.title = cellText(r, c);
      td.setAttribute("aria-label", td.title);
      td.addEventListener("click", () => {
        S.pair = p || null;
        pairStatus(r, c);
        renderMatrix();
        draw();
      });
    }
  }
  side.append(table);
}

// ---- drawing --------------------------------------------------------------------------------------------------------

function shape(c, role, x, y, r) {
  c.beginPath();
  if (role === "coordinator") c.rect(x - r, y - r, 2 * r, 2 * r); else c.arc(x, y, r, 0, 2 * Math.PI);
}

/** Markers as in the panel (spec 8): grey filled by reception, slash without a value, dashed outline outside the mesh,
 *  hollow when offline; the selection (and a picked pair's ends) get an accent ring. */
function drawNodes(near) {
  const n = scene.nodes.length;
  const order = [...Array(n).keys()]
    .sort((i, j) => (near.has(i) - near.has(j)) || (i === S.selected) - (j === S.selected));
  for (const i of order) {
    const node = scene.nodes[i];
    const r = markerRadius(node.role, S.cam.k);
    const alpha = S.faded.has(i) ? 0.35 : 1;
    ctx.globalAlpha = alpha;
    shape(ctx, node.role, sx[i], sy[i], r);
    const fill = node.available ? fillColor(node, "reception", theme) : null;
    ctx.fillStyle = node.available ? fill || theme.node : theme.background;
    ctx.fill();
    ctx.setLineDash(pos.mesh[i] ? [] : [3, 2]);
    ctx.lineWidth = i === S.selected ? 2.5 : 1.5;
    ctx.strokeStyle = theme.outline;
    ctx.stroke();
    ctx.setLineDash([]);
    if (node.available && !fill) {
      seg(ctx, sx[i] - r * 0.6, sy[i] + r * 0.6, sx[i] + r * 0.6, sy[i] - r * 0.6, theme.outline, 1.5, [], alpha);
    }
    ctx.globalAlpha = 1;
    if (i === S.selected || (S.pair && (S.pair.a === i || S.pair.b === i))) {
      shape(ctx, node.role, sx[i], sy[i], r + (S.option === 7 ? 9 : 4)); // option 7: outside its ring
      ctx.lineWidth = 2.5;
      ctx.setLineDash(i === S.selected ? [] : [3, 3]);
      ctx.strokeStyle = theme.accent;
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

function halo(text, x, y) {
  ctx.lineWidth = 3;
  ctx.strokeStyle = theme.background;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = theme.foreground;
  ctx.fillText(text, x, y);
}

/** Labels and values, most important first, each only where it covers nothing already placed. */
function drawTexts(near, texts) {
  const boxes = scene.nodes.map((node, i) => {
    const r = markerRadius(node.role, S.cam.k) + 1;
    return { x: sx[i] - r, y: sy[i] - r, w: 2 * r, h: 2 * r, owner: i };
  });
  // A label may touch its own marker; everything else must stay clear.
  const free = (b) => !boxes.some((o) => !(b.owner !== undefined && o.owner === b.owner) &&
    b.x < o.x + o.w && o.x < b.x + b.w && b.y < o.y + o.h && o.y < b.y + b.h);
  ctx.font = theme.font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const label = (i, forced) => {
    if (S.faded.has(i) && !forced) return;
    const node = scene.nodes[i];
    const w = measure(node.label) + 4;
    const r = markerRadius(node.role, S.cam.k) + (S.option === 7 ? 7 : 0);
    const h2 = LINE_HEIGHT / 2;
    const spots = [[sx[i], sy[i] + r + 3 + h2], [sx[i], sy[i] - r - 3 - h2],
      [sx[i] + r + 4 + w / 2, sy[i]], [sx[i] - r - 4 - w / 2, sy[i]]];
    let spot = spots.find(([x, y]) => free({ x: x - w / 2, y: y - h2, w, h: LINE_HEIGHT, owner: i }));
    if (!spot && !forced) return;
    spot = spot || spots[0];
    boxes.push({ x: spot[0] - w / 2, y: spot[1] - h2, w, h: LINE_HEIGHT });
    halo(node.label, spot[0], spot[1]);
  };
  const n = scene.nodes.length;
  const first = [...Array(n).keys()].filter((i) => i === S.selected || scene.nodes[i].role === "coordinator");
  for (const i of first) label(i, true);
  for (const i of near) if (!first.includes(i)) label(i, false);
  for (const t of texts) {
    const w = measure(t.text) + 4;
    const b = { x: t.x - w / 2, y: t.y - LINE_HEIGHT / 2, w, h: LINE_HEIGHT };
    if (!free(b)) continue;
    boxes.push(b);
    halo(t.text, t.x, t.y);
  }
  for (let i = 0; i < n; i++) if (!first.includes(i) && !near.has(i)) label(i, false);
}

const DRAW = { 1: baseline, 2: halves, 3: wedges, 4: evidenceStyle, 5: fan, 6: matrixMap, 7: baseline, 8: usedLinks };

function draw() {
  if (!pos || !S.w) return;
  ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, S.w, S.h);
  const n = scene.nodes.length;
  sx = new Float64Array(n);
  sy = new Float64Array(n);
  for (let i = 0; i < n; i++) [sx[i], sy[i]] = toScreen(S.cam, pos.x[i], pos.y[i], S.w, S.h);
  const near = new Set();
  if (S.selected >= 0) {
    near.add(S.selected);
    for (const p of ev.neighbours[S.selected]) if (p.cls !== "implied" || S.implied) near.add(other(p, S.selected));
  }
  if (S.pair) { near.add(S.pair.a); near.add(S.pair.b); }
  // Option 8: the selection's up path joins its neighbourhood; the rest of the map is dimmed.
  S.path = S.option === 8 && S.selected >= 0 ? pathOf(S.selected).ids.map((id) => scene.index.get(id)) : [];
  for (const i of S.path) near.add(i);
  S.faded = new Set(S.option === 8 && S.selected >= 0 ? [...Array(n).keys()].filter((i) => !near.has(i)) : []);
  const texts = [];
  DRAW[S.option](shownPairs(), texts);
  drawNodes(near);
  if (S.option === 7) rings();
  drawTexts(near, texts);
}

// ---- view, input, status --------------------------------------------------------------------------------------------

/** The panel's working scale (spec 9.3): median nearest-neighbour distance of the mesh equals the mean label width. */
function workingZoom() {
  const mesh = [...Array(scene.nodes.length).keys()].filter((i) => pos.mesh[i]);
  const nearest = mesh.map((i) => Math.min(...mesh.filter((j) => j !== i)
    .map((j) => Math.hypot(pos.x[j] - pos.x[i], pos.y[j] - pos.y[i])))).sort((a, b) => a - b);
  const mean = scene.labels.reduce((sum, l) => sum + measure(l), 0) / scene.labels.length;
  return mean / nearest[nearest.length >> 1];
}

/** Fit everything, or with reveal=1 centre the selection at the working scale (times zoom=, for screenshots). */
function fit() {
  const all = fitCamera(bounds(pos.x, pos.y), S.w, S.h, 56);
  if (q.get("reveal") === "1" && S.selected >= 0) {
    const k = Math.max(all.k, workingZoom()) * (Number(q.get("zoom")) || 1);
    S.cam = { k, cx: pos.x[S.selected], cy: pos.y[S.selected] };
  } else {
    S.cam = all;
  }
}

function resize() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  S.w = w; S.h = h; S.dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(w * S.dpr);
  canvas.height = Math.round(h * S.dpr);
  if (pos && !S.moved) fit();
  draw();
}

function status(text) { $("status").textContent = text; }

function summary() {
  const c = ev.count;
  const used = ev.pairs.filter(isUsed).length;
  const grey = shownPairs().filter((p) => !isUsed(p)).length;
  const drawn = S.option === 8 ? `${used} used (green), ${grey} of ${ev.pairs.length - used} unused (grey)`
    : shownPairs().length;
  let text = `${scene.nodes.length} devices. Pairs: both ways ${c.both}, one way ${c.one} (other end has a table ` +
    `${c.oneTable}, has none ${c.one - c.oneTable}), implied ${c.implied}, none ${c.none}. Drawn: ${drawn}.`;
  if (S.option === 8 && S.selected >= 0) {
    const up = pathOf(S.selected);
    const names = up.ids.map((id) => scene.nodes[scene.index.get(id)].label).join(" → ");
    text = `Up path: ${names} (${up.complete ? "complete" : "incomplete"}). ${text}`;
  }
  if (S.selected >= 0) {
    const s = S.selected;
    const k = (cls) => ev.neighbours[s].filter((p) => p.cls === cls).length;
    const iOnly = ev.neighbours[s].filter((p) => p.cls === "one" && hears(p, s)).length;
    const table = ev.table[s] ? `${ev.entries[s]} table entries` : "no table";
    text = `${scene.nodes[s].label} (${table}): both ways ${k("both")}, one way ${k("one")} (only it hears ` +
      `${iOnly}, only the other hears it ${k("one") - iOnly}), implied ${k("implied")}. ${text}`;
  }
  status(text);
}

/** base moved towards black or white until its contrast against bg reaches target (WCAG 2.2 contrast ratio), so a
 *  step carries the same weight on light and dark themes: darker than the base on a light background, lighter on a
 *  dark one, or the other way where the base is already past the target. */
function atContrast(base, bg, target) {
  const away = luminance(bg) > 0.18 ? [0, 0, 0] : [255, 255, 255];
  const toward = away[0] ? [0, 0, 0] : [255, 255, 255];
  const at = (t) => base.map((v, i) => Math.round(v + ((t >= 0 ? away : toward)[i] - v) * Math.abs(t)));
  let lo = -1;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (contrastRatio(at(mid), bg) >= target) hi = mid; else lo = mid;
  }
  return at(hi);
}

function setTheme(dark) {
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  theme = resolveTheme(dark ? DARK : LIGHT);
  const bg = parseColor(theme.background);
  theme.one = toHex(ensureContrast(parseColor(OKABE_ITO.vermillion), bg));
  theme.green = STEPS.map((c) => toHex(atContrast(parseColor(OKABE_ITO.bluishGreen), bg, c)));
  theme.grey = STEPS.map((c) => toHex(atContrast([128, 128, 128], bg, c)));
  widths.clear();
}

function refresh() {
  renderLegend();
  renderMatrix();
  summary();
  draw();
}

const findNode = (label) => scene.nodes.findIndex((node) => node.label === label || node.id === label);

// One gesture model as in the panel (spec 9.3), reduced: a press that moves less than 8 px selects, more pans.
let press = null;
canvas.addEventListener("pointerdown", (e) => {
  press = { x: e.offsetX, y: e.offsetY, moved: false };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", (e) => {
  if (!press) return;
  const [dx, dy] = [e.offsetX - press.x, e.offsetY - press.y];
  if (!press.moved && Math.hypot(dx, dy) < 8) return;
  press = { x: e.offsetX, y: e.offsetY, moved: true };
  S.moved = true;
  S.cam = panBy(S.cam, dx, dy);
  draw();
});
canvas.addEventListener("pointerup", (e) => {
  if (press && !press.moved) {
    S.selected = hitTest(scene, sx, sy, S.cam.k, e.offsetX, e.offsetY);
    S.pair = null;
    refresh();
  }
  press = null;
});
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  S.moved = true;
  S.cam = zoomAt(S.cam, 1.2 ** (-e.deltaY / 100), e.offsetX, e.offsetY, S.w, S.h, 0.05, 50);
  draw();
}, { passive: false });
canvas.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { S.selected = -1; S.pair = null; refresh(); }
});

$("option").value = String(S.option);
$("implied").checked = S.implied;
$("all").checked = S.all;
$("dark").checked = q.get("theme") === "dark";
$("option").addEventListener("change", (e) => { S.option = Number(e.target.value); refresh(); });
$("implied").addEventListener("change", (e) => { S.implied = e.target.checked; refresh(); });
$("all").addEventListener("change", (e) => { S.all = e.target.checked; refresh(); });
$("dark").addEventListener("change", (e) => { setTheme(e.target.checked); refresh(); });

async function start() {
  setTheme($("dark").checked);
  const capture = await (await fetch("../tests/fixtures/zha-sample.json")).json();
  const r = capture.responses || capture;
  net = buildNetwork(r["zha/devices"], { deviceRegistry: r["config/device_registry/list"],
    areaRegistry: r["config/area_registry/list"], configEntries: r["config_entries/get"] });
  scene = buildScene(net, measure);
  ev = evidence();
  // The panel's layout: L0 from the display labels, D = 1, seed 1, run until settled (spec 7.1).
  const layout = new Layout(net, { baseLength: baseLength(scene.labels, measure, NODE_DIAMETER), density: 1, seed: 1 });
  layout.run();
  pos = { x: [], y: [], mesh: [] };
  scene.nodes.forEach((node, i) => {
    const j = layout.index.get(node.id);
    [pos.x[i], pos.y[i], pos.mesh[i]] = [layout.x[j], layout.y[j], layout.mesh[j]];
  });
  S.selected = findNode(q.get("select"));
  const pair = (q.get("pair") || "").split(",").map(findNode);
  if (pair.length === 2 && pair[0] >= 0 && pair[1] >= 0) S.pair = ev.pairOf(pair[0], pair[1]);
  new ResizeObserver(resize).observe(canvas); // also redraws when the matrix panel opens or closes
  refresh();
  resize();
  if (S.pair) pairStatus(S.pair.a, S.pair.b);
}

start().catch((err) => status(`Could not load the sample: ${err}`));
