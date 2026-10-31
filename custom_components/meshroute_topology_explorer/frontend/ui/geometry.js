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
