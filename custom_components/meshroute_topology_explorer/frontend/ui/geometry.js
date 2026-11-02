// SPDX-License-Identifier: MIT
// Where the two panels sit and how much of the map they cover (spec 9.1; design by Fabian Schwamborn, 2026-11-01):
// the left panel (Devices, Findings, Details) and the right panel (View, Legend) are side panels on wide screens and
// bottom sheets on narrow ones, collapsed to one line or expanded. The covered part goes to GraphView.setInsets(),
// which pans the map so the selected device stays clear of it. Also where the floating controls and the banners go.
// Pure functions, no DOM. Tested in Node: npm test

/** The panel is "wide" from this width on (CSS pixels of the panel, not the window: Home Assistant's sidebar takes
 *  its share). A side panel of 320 px then still leaves 400 px of map. Own choice. */
export const WIDE_MIN = 720;
/** Width of a side panel: 36 % of the panel, within 320..384 px. Own choice: room for a reading table; at most 384 px
 *  as on the boards (design by Fabian Schwamborn, 2026-11-01, M2 to M7). */
export const SIDE_MIN = 320;
export const SIDE_MAX = 384;
const SIDE_SHARE = 0.36;
/** Height of the collapsed sheet: one line of 48 px (a comfortable touch row) and a little room around it. */
export const SHEET_COLLAPSED = 56;
/** The expanded sheet takes 55 % of the map, at least 240 px, and always leaves 120 px of map above it. Own choice. */
const SHEET_SHARE = 0.55;
const SHEET_MIN = 240;
export const MAP_KEEP = 120;

const NONE = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });

export function isWide(width) {
  return width >= WIDE_MIN;
}

/** Geometry of one panel inside a map area of width × height; side: "left" or "right" (where it sits on wide screens):
 *  { mode: "side" | "sheet", size (width of the side panel or height of the sheet), insets } */
export function drawerGeometry({ width, height, open, expanded, side = "right" }) {
  if (isWide(width)) {
    const size = Math.round(Math.max(SIDE_MIN, Math.min(SIDE_MAX, width * SIDE_SHARE)));
    return { mode: "side", size, insets: open ? { ...NONE, [side === "left" ? "left" : "right"]: size } : { ...NONE } };
  }
  const full = Math.round(Math.max(SHEET_MIN, height * SHEET_SHARE));
  const size = expanded ? Math.max(SHEET_COLLAPSED, Math.min(full, height - MAP_KEEP)) : SHEET_COLLAPSED;
  return { mode: "sheet", size, insets: open ? { ...NONE, bottom: size } : { ...NONE } };
}

/** The part of the map both panels cover together: side by side on wide screens; on narrow ones only one sheet is
 *  open at a time (the panel makes sure), so the larger bottom wins. */
export function combinedInsets(a, b) {
  return { top: 0, left: a.left + b.left, right: a.right + b.right, bottom: Math.max(a.bottom, b.bottom) };
}

/** Floating controls on the map (decision by Fabian Schwamborn, 2026-10-31; spec 9.1): gap to the edges and between
 *  groups, and the smallest target. Own choice within WCAG 2.2 2.5.8 (24 px). */
export const FLOAT_GAP = 12;
export const FLOAT_TARGET = 44;
/** Banners sit between the two top groups when that leaves at least this much, else below them. Own choice: room for
 *  the "incomplete" banner's two short sentences in two lines. */
export const BAND_MIN = 280;

/** Where things float on a map of width × height with the panels' insets: the left group ("Devices" and the switch
 *  "Details on click") top left, the right group ("View", "Legend") top right, the zoom group bottom right, and the
 *  band for banners. left, right: the measured { width, height } of the two groups ({ 0, 0 } while hidden, as when
 *  their panel is open on a wide screen). The band lies between the groups at the top where that leaves BAND_MIN,
 *  else below the taller group across the free width. All values are CSS pixels from the map's edges. */
export function floatingLayout({ width, height, insets = {}, left = { width: 0, height: 0 }, right = { width: 0, height: 0 } }) {
  const ins = { ...NONE, ...insets };
  const g = FLOAT_GAP;
  const edgeLeft = ins.left + g;
  const edgeRight = ins.right + g;
  const betweenLeft = edgeLeft + (left.width ? left.width + g : 0);
  const betweenRight = edgeRight + (right.width ? right.width + g : 0);
  const between = width - betweenLeft - betweenRight >= BAND_MIN;
  const below = g + Math.max(left.height, right.height) + (left.height || right.height ? 8 : 0);
  return {
    wide: isWide(width),
    left: { left: edgeLeft, top: g },
    right: { right: edgeRight, top: g },
    zoom: { right: edgeRight, bottom: ins.bottom + g },
    band: between ? { top: g, left: betweenLeft, right: betweenRight, maxHeight: height - ins.bottom - 2 * g }
      : { top: below, left: edgeLeft, right: edgeRight, maxHeight: height - ins.bottom - below - g },
  };
}
