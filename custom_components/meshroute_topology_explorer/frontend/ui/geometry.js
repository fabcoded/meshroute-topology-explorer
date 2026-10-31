// SPDX-License-Identifier: MIT
// Where the drawer sits and how much of the map it covers (spec 9.1): a side panel on wide screens, a bottom sheet on
// narrow ones, collapsed to one line or expanded. The covered part goes to GraphView.setInsets(), which pans the map
// so the selected device stays clear of the drawer. Pure functions, no DOM. Tested in Node: node --test tests/

/** The panel is "wide" from this width on (CSS pixels of the panel, not the window: Home Assistant's sidebar takes
 *  its share). A side drawer of 320 px then still leaves 400 px of map. Own choice. */
export const WIDE_MIN = 720;
/** Width of the side drawer: 36 % of the panel, within 320..400 px. Own choice: room for a reading table. */
export const SIDE_MIN = 320;
export const SIDE_MAX = 400;
const SIDE_SHARE = 0.36;
/** Height of the collapsed sheet: one line of 48 px (a comfortable touch row) and a little room around it. */
export const SHEET_COLLAPSED = 56;
/** The expanded sheet takes 55 % of the map, at least 240 px, and always leaves 120 px of map above it. Own choice. */
const SHEET_SHARE = 0.55;
const SHEET_MIN = 240;
export const MAP_KEEP = 120;

export function isWide(width) {
  return width >= WIDE_MIN;
}

/** Geometry of the drawer inside a map area of width × height:
 *  { mode: "side" | "sheet", size (width of the side panel or height of the sheet), insets } */
export function drawerGeometry({ width, height, open, expanded }) {
  const none = { top: 0, right: 0, bottom: 0, left: 0 };
  if (isWide(width)) {
    const size = Math.round(Math.max(SIDE_MIN, Math.min(SIDE_MAX, width * SIDE_SHARE)));
    return { mode: "side", size, insets: open ? { ...none, right: size } : none };
  }
  const full = Math.round(Math.max(SHEET_MIN, height * SHEET_SHARE));
  const size = expanded ? Math.max(SHEET_COLLAPSED, Math.min(full, height - MAP_KEEP)) : SHEET_COLLAPSED;
  return { mode: "sheet", size, insets: open ? { ...none, bottom: size } : none };
}

/** Floating groups on the map (decision by Fabian Schwamborn, 2026-10-31; spec 9.1): gap to the edges and between
 *  groups, and the smallest target. Own choice within WCAG 2.2 2.5.8 (24 px). */
export const FLOAT_GAP = 12;
export const FLOAT_TARGET = 44;

/** Where the floating groups sit in a map of width × height with the drawer's insets: the title pill top left, the
 *  options group top right (labelled rows on wide panels, one row of icons on narrow ones), the zoom group bottom
 *  right, the legend bottom left, and the band for banners and the selection chip below the title pill. Groups on the
 *  drawer's side move by its inset, so they never sit under it. options: measured { width, height } of the options
 *  group (rows mode), so the band stops left of it. All values are CSS pixels from the map's edges. */
export function floatingLayout({ width, height, insets = {}, options = { width: 0, height: 0 } }) {
  const ins = { top: 0, right: 0, bottom: 0, left: 0, ...insets };
  const wide = isWide(width);
  const g = FLOAT_GAP;
  const right = ins.right + g;
  const bottom = ins.bottom + g;
  // The zoom group is one target wide; the legend may grow up to it, keeping a gap.
  const legendMax = Math.max(FLOAT_TARGET * 3, width - ins.right - 3 * g - FLOAT_TARGET);
  return {
    wide,
    title: { left: g, top: g },
    options: { mode: wide ? "rows" : "icons", right, top: g },
    zoom: { right, bottom },
    legend: { left: g, bottom, maxWidth: legendMax, maxHeight: Math.max(FLOAT_TARGET, height - ins.bottom - 2 * g - FLOAT_TARGET - g) },
    // Banners and (on wide panels) the chip: below the title pill; on wide panels left of the tall options group, on
    // narrow ones below the row of icons, across the width.
    band: { top: g + FLOAT_TARGET + 8, left: g, right: wide ? right + options.width + g : right },
    chip: wide ? { place: "band" } : { place: "bottom", left: g, bottom },
  };
}
