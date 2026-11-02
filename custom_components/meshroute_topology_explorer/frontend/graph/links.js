// SPDX-License-Identifier: MIT
// How the quality view draws links (spec 7.1, 8): every pair as two lanes, one per direction (sender -> hearer), each on the right of its own direction
// of travel, with an arrowhead at the hearer, shortened to the symbols' contours; a value beside a lane, the dashed
// stem of an unknown end, the band under a selection's way, the dimming of what is out of focus. Line styles are
// looks (solid, dash-dot, dashed, faint) and carry no colour of their own; a weight (strong, regular, thin) and the
// lane's own rating set the width; opt-in, rated lanes are coloured by reception, red to green. What a lane means, and
// which look and weight it gets, is the network engine's (engines/<type>/lanes.js and scene.js).
// Pure functions: geometry and stroke styles.
// npm test

import { SYMBOL_SIZE, contourExit } from "./symbols.js";
import { receptionColor } from "./palette.js";

/** Distance of a lane from the pair's centre line at zoom 1, CSS pixels; grows with the symbols, lanes stay at least
 *  2 px apart. */
export const LANE_OFFSET = 3;
/** Room between a lane's end (or its arrowhead's tip) and the symbol's contour, CSS pixels: the tip stays readable
 *  against the frame. Own choice. */
export const LANE_GAP = 1;
/** The selected device's up path: a band in the foreground colour under its lanes (kept because in the stage "all" it tells the way to the coordinator apart). */
export const BAND = Object.freeze({ alpha: 0.18, width: 7 });
/** Opacity of everything that does not touch the selection or the device under the pointer. */
export const DIM = 0.2;
/** The value pill in a lane (decision 2026-11-02, spec 7.1): its height and text padding, CSS pixels; its centre sits
 *  min(share of the lane, `diameters` symbol diameters) from the arrowhead's tip, so long lanes keep the value near
 *  the hearer. A lane shorter than minLane, or one where the pill would touch the arrowhead (tip clearance) or the
 *  sender's end, puts it at the lane's middle instead. */
export const VALUE = Object.freeze({ share: 0.25, diameters: 4, minLane: 60, height: 16, font: 11.5, pad: 12, tip: 10, end: 2 });
/** An incomplete path's end: a dashed stem this long at zoom 1 (CSS pixels, grows with the symbols, at most this share
 *  of the way to the goal), then "?". Own choice: long enough to point, short enough not to read as a link. */
export const STEM = Object.freeze({ length: 30, share: 0.45, width: 1.5, dash: Object.freeze([3, 3]) });
/** Rating limits of the three lane widths. */
export const WIDTH_STEPS = Object.freeze([1 / 3, 2 / 3]);
/** Stroke looks of a lane: a look, not a meaning; each engine maps its own lane classes to
 *  them (Zigbee: by evidence, spec 7.1): solid, dash-dot, dash-dot in the lighter grey, dashed, and the faint dotted
 *  grey of a lane without traffic or reading. */
export const STROKES = Object.freeze(["solid", "dashdot", "dashdot-muted", "dashed", "faint"]);
/** Lane widths per weight and width step (CSS pixels); the engine gives each lane its weight (Zigbee: by role, the way
 *  to the coordinator strong). Own choice. */
export const WIDTHS = Object.freeze({
  strong: Object.freeze([1.5, 2.25, 3]),
  regular: Object.freeze([1, 1.25, 1.6]),
  thin: Object.freeze([0.75, 1, 1.4]),
  faint: Object.freeze([1, 1, 1]),
});
/** Dash patterns (CSS pixels), spec 7.1: dash-dot and dashed. */
export const DASH = Object.freeze({ dashdot: Object.freeze([6, 3, 1.5, 3]), dashed: Object.freeze([6, 3]) });

/** Width step 0..2 of a rating (0..1); an unrated reading gets the thinnest. */
export function widthStep(rating) {
  if (typeof rating !== "number" || !Number.isFinite(rating)) return 0;
  return rating < WIDTH_STEPS[0] ? 0 : rating < WIDTH_STEPS[1] ? 1 : 2;
}

/** Stroke style of a lane: { color, width, dash, cap, head }, from its look (STROKES; null counts as "faint": thin
 *  dotted grey, no head) and weight (WIDTHS). The look sets the dash; the weight and the lane's own rating (0..1) set
 *  the width. state "unknown" (a hop nothing proves) keeps the look's dash in grey at the weight's thinnest width.
 *  colored: "colour by reception" is on, so a rated solid, dash-dot or dashed lane takes its rating's colour
 *  (palette.js receptionColor); dash and width stay, so the look still reads without colour. Dash-dot in the lighter
 *  grey is never coloured (a computed hop never looks like a reported one). */
export function laneStyle(stroke, rating, theme, { colored = false, state = "measured", weight } = {}) {
  if (!stroke || stroke === "faint") {
    return { color: theme.muted, width: WIDTHS.faint[0], dash: [0.01, 3], cap: "round", head: false };
  }
  const unknown = state === "unknown";
  const width = WIDTHS[weight][unknown ? 0 : widthStep(rating)];
  const tint = (fallback) => (unknown ? theme.muted : (colored && receptionColor(rating, theme)) || fallback);
  if (stroke === "dashdot-muted") return { color: theme.muted, width, dash: [...DASH.dashdot], cap: "butt", head: true };
  if (stroke === "solid") return { color: tint(theme.foreground), width, dash: [], cap: "butt", head: true };
  if (stroke === "dashdot") return { color: tint(theme.foreground), width, dash: [...DASH.dashdot], cap: "butt", head: true };
  return { color: tint(theme.muted), width, dash: [...DASH.dashed], cap: "butt", head: true };
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

/** Size { w, h } of the pill around a value text of width textWidth. */
export function pillSize(textWidth) {
  return { w: Math.max(VALUE.height, textWidth + VALUE.pad), h: VALUE.height };
}

/** Pill centre at distance d back from the lane's arrowhead tip, on the lane's line. */
export function pillCentre(lane, d) {
  return [lane.x1 - lane.ux * d, lane.y1 - lane.uy * d];
}

/** Distances from the tip where a w x h pill may sit on the lane, best first: min(share of the lane, diameters x
 *  symbol size) on a lane of at least VALUE.minLane, then the middle. A place counts only if the pill (its extent
 *  along the lane, the box being upright) stays clear of the arrowhead and of the lane's start. Empty: no room. */
export function pillDistances(lane, size, w, h) {
  const along = w * Math.abs(lane.ux) + h * Math.abs(lane.uy);
  const fits = (d) => d - along / 2 >= VALUE.tip && d + along / 2 <= lane.len - VALUE.end;
  const out = [];
  if (lane.len >= VALUE.minLane) {
    const d = Math.min(lane.len * VALUE.share, VALUE.diameters * size);
    if (fits(d)) out.push(d);
  }
  const middle = lane.len / 2;
  if (fits(middle) && !out.some((d) => Math.abs(d - middle) < 1)) out.push(middle);
  return out;
}

/** The dashed stem of an incomplete path from the device where its walk stopped towards its goal (screen positions),
 *  on the right of that direction like a lane: { x0, y0, x1, y1, gx, gy } with (gx, gy) the place of its "?", or
 *  null when the two sit on each other. */
export function stemGeometry(x1, y1, x2, y2, size, offset) {
  const lane = laneGeometry(x1, y1, x2, y2, size, size, offset);
  if (!lane) return null;
  const len = Math.max(4, Math.min((STEM.length * size) / SYMBOL_SIZE, lane.len * STEM.share));
  const ex = lane.x0 + lane.ux * len;
  const ey = lane.y0 + lane.uy * len;
  return { x0: lane.x0, y0: lane.y0, x1: ex, y1: ey, gx: ex + lane.ux * 6, gy: ey + lane.uy * 6, ux: lane.ux,
    uy: lane.uy };
}
