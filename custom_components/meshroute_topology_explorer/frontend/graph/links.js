// SPDX-License-Identifier: MIT
// How the quality view draws links (spec 7.1, 8; decision by Fabian Schwamborn, 2026-10-31): every pair as two lanes,
// one per direction (sender -> hearer), each on the right of its own direction of travel, with an arrowhead at the
// hearer. Pairs fall into three colour-free classes, told apart by dash: up path (solid), other active route
// (dotted), heard only (dashed, grey); lane width follows the lane's own rating. A direction without a reading has no
// lane but a glyph: "–" when the hearer's table does not list the sender, "?" when there is no table to ask.
// Pure functions: classification from the data model's pairs, routes and up paths; geometry; styles; legend data.
// node --test tests/

import { computePairs } from "../model/pairs.js";
import { upPath } from "../model/paths.js";
import { isActive } from "../model/normalize.js";
import { contourExit } from "./symbols.js";

/** Classes in drawing order: the more a link carries, the later (higher) it is drawn. */
export const CLASSES = Object.freeze(["heard", "route", "up"]);
/** Heard-only pairs shown by default per device: its best by the pair's better rating (decision 2026-10-31). */
export const BEST_HEARD = 3;
/** Class switches (spec 9.1): which classes the overview draws. Selection and debug mode override them. */
export const DEFAULT_LINKS = Object.freeze({ up: true, route: true, heard: true });

/** Whether a pair is drawn: debug mode and pairs touching the selection or hover always; otherwise its class must be
 *  switched on, and a heard-only pair must also be among its devices' best (pair.shown). Drawing only: the layout
 *  never looks at this, so toggling cannot move a device. */
export function pairDrawn(pair, links, { debug = false, touched = false } = {}) {
  if (debug || touched) return true;
  return Boolean((links || DEFAULT_LINKS)[pair.cls]) && Boolean(pair.shown);
}

/** Distance of a lane from the pair's centre line at zoom 1, CSS pixels; grows with the symbols, lanes stay at least
 *  2 px apart. */
export const LANE_OFFSET = 3;
/** Room between a lane's end (or its arrowhead's tip) and the symbol's contour, CSS pixels: the tip stays readable
 *  against the frame. Own choice. */
export const LANE_GAP = 1;
/** The selected device's up path: a band in the foreground colour under its lanes. */
export const BAND = Object.freeze({ alpha: 0.18, width: 7 });
/** Opacity of everything that does not touch the selection or the device under the pointer. */
export const DIM = 0.2;
/** Rating limits of the three lane widths. */
export const WIDTH_STEPS = Object.freeze([1 / 3, 2 / 3]);
/** Lane widths per class and width step (CSS pixels): up path strongest, heard only thinnest. Own choice. */
export const WIDTHS = Object.freeze({
  up: Object.freeze([1.5, 2.25, 3]),
  route: Object.freeze([1.25, 1.75, 2.25]),
  heard: Object.freeze([0.75, 1, 1.4]),
  implied: Object.freeze([1, 1, 1]),
});

/** Width step 0..2 of a rating (0..1); an unrated reading gets the thinnest. */
export function widthStep(rating) {
  if (typeof rating !== "number" || !Number.isFinite(rating)) return 0;
  return rating < WIDTH_STEPS[0] ? 0 : rating < WIDTH_STEPS[1] ? 1 : 2;
}

/** Stroke style of a lane: { color, width, dash, cap, head }. Dash patterns are relative to the width, so dots stay
 *  round. Implied directions (a route or parent link proves them, no reading) are thin dotted grey without a head. */
export function laneStyle(cls, state, rating, theme) {
  if (state === "implied") {
    return { color: theme.muted, width: WIDTHS.implied[0], dash: [0.01, 3], cap: "round", head: false };
  }
  const width = WIDTHS[cls][widthStep(rating)];
  if (cls === "up") return { color: theme.foreground, width, dash: [], cap: "butt", head: true };
  if (cls === "route") return { color: theme.foreground, width, dash: [0.01, width + 3], cap: "round", head: true };
  return { color: theme.muted, width, dash: [5, 3.5], cap: "butt", head: true };
}

/** Glyph for a direction without a reading (spec 4.3 reasons): "–" when the hearer has a table that does not list the
 *  sender (full, nearly full, with space, capacity unknown); "?" when there is no table to ask (end device, missing or
 *  stale table) or the table says LQI 0 (unmeasured or very weak). */
export function unknownGlyph(reason) {
  const listedNot = /^(table (full|nearly full|has space)|capacity unknown)/;
  return typeof reason === "string" && listedNot.test(reason) ? "–" : "?";
}

const pairKey = (x, y) => (x < y ? `${x}|${y}` : `${y}|${x}`);

/** Pairs of a network with their class, and every device's up path. Uses the model's pairs when the network carries
 *  them (buildNetwork does); otherwise computes them from devices, readings and routes, treating a reading without a
 *  `measured` flag as measured when its LQI is above 0. Returns { pairs: [{ a, b, ab, ba, cls }], upPaths: Map }. */
export function classifyPairs(network) {
  const devices = (network.devices || []).filter((d) => d && typeof d.id === "string")
    .map((d) => (typeof d.available === "boolean" ? d : { ...d, available: d.available !== false }));
  const known = new Set(devices.map((d) => d.id));
  const routes = (Array.isArray(network.routes) ? network.routes : [])
    .filter((r) => r && known.has(r.owner) && known.has(r.nextHop) && known.has(r.destination));
  const net = { ...network, devices, routes };
  let pairs = network.pairs;
  if (!Array.isArray(pairs)) {
    const readings = (network.readings || [])
      .filter((r) => r && known.has(r.reporter) && known.has(r.subject) && r.reporter !== r.subject)
      .map((r) => ({ ...r,
        measured: typeof r.measured === "boolean" ? r.measured : typeof r.lqi === "number" && r.lqi > 0 }));
    pairs = computePairs({ devices, readings, routes });
  }
  const upPaths = new Map();
  const up = new Set();
  for (const d of devices) {
    const { ids } = upPath(net, d.id);
    upPaths.set(d.id, ids);
    for (let i = 0; i + 1 < ids.length; i++) up.add(pairKey(ids[i], ids[i + 1]));
  }
  const routed = new Set();
  for (const r of routes) {
    if (!r.stale && isActive(r.status) && r.owner !== r.nextHop) routed.add(pairKey(r.owner, r.nextHop));
  }
  const classed = pairs.filter((p) => known.has(p.a) && known.has(p.b)).map((p) => {
    const k = pairKey(p.a, p.b);
    return { ...p, cls: up.has(k) ? "up" : routed.has(k) ? "route" : "heard" };
  });
  return { pairs: classed, upPaths };
}

/** Geometry of one lane from sender (x1, y1) to hearer (x2, y2) on screen: shifted by `offset` to the right of the
 *  direction of travel (y points down, so the right-hand normal of (ux, uy) is (-uy, ux)) and shortened to the
 *  symbols' contours (rounded squares of sizes s1, s2, symbols.js) plus LANE_GAP. Returns { x0, y0, x1, y1, ux, uy,
 *  nx, ny, mx, my, len } or null if the symbols leave no room. (mx, my) is the middle of the lane. */
export function laneGeometry(x1, y1, x2, y2, s1, s2, offset) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const d = Math.hypot(dx, dy);
  if (!(d > 0)) return null;
  const ux = dx / d;
  const uy = dy / d;
  const nx = -uy;
  const ny = ux;
  // The shifted line leaves the sender's contour going forwards and meets the hearer's coming in, i.e. leaving it
  // backwards; both measured from the foot of the line beside each centre.
  const a = contourExit(nx * offset, ny * offset, ux, uy, s1) + LANE_GAP;
  const b = contourExit(nx * offset, ny * offset, -ux, -uy, s2) + LANE_GAP;
  const len = d - a - b;
  if (len < 4) return null;
  const x0 = x1 + ux * a + nx * offset;
  const y0 = y1 + uy * a + ny * offset;
  const x1e = x0 + ux * len;
  const y1e = y0 + uy * len;
  return { x0, y0, x1: x1e, y1: y1e, ux, uy, nx, ny, mx: (x0 + x1e) / 2, my: (y0 + y1e) / 2, len };
}

/** Centre for a text of size w × h beside a lane, on its right side at its middle, clear of the stroke. */
export function textBeside(lane, w, h, gap = 2) {
  const reach = Math.abs(lane.nx) * (w / 2) + Math.abs(lane.ny) * (h / 2) + gap;
  return [lane.mx + lane.nx * reach, lane.my + lane.ny * reach];
}

/** What the legend explains, for the panel to draw with its own words (ids are stable keys for translations):
 *  the switched-on classes (all in debug mode) and the implied lane with their stroke samples, the width steps, the two glyphs and the band. */
export function legendEntries(theme, { links = DEFAULT_LINKS, debug = false } = {}) {
  const sample = (cls, state, rating) => laneStyle(cls, state, rating, theme);
  const all = [
    { id: "up", kind: "lane", style: sample("up", "measured", 1), widths: [...WIDTHS.up] },
    { id: "route", kind: "lane", style: sample("route", "measured", 1), widths: [...WIDTHS.route] },
    { id: "heard", kind: "lane", style: sample("heard", "measured", 1), widths: [...WIDTHS.heard] },
    { id: "implied", kind: "lane", style: sample("up", "implied", null) },
    { id: "width", kind: "width", steps: [...WIDTH_STEPS] },
    { id: "not-listed", kind: "glyph", text: "–", color: theme.muted },
    { id: "no-table", kind: "glyph", text: "?", color: theme.muted },
    { id: "up-path", kind: "band", color: theme.foreground, alpha: BAND.alpha, width: BAND.width },
  ];
  // A switched-off class leaves the legend (debug mode draws all, so it keeps all).
  return all.filter((e) => debug || !CLASSES.includes(e.id) || links[e.id]);
}
