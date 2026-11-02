// SPDX-License-Identifier: MIT
// What the two panels do when the selection changes or the user asks for a tab (spec 9.1, 9.2; design by Fabian
// Schwamborn, 2026-11-01). Pure: the panel passes both panels' state and carries out the answer, a list of steps
// { panel: "left" | "right", action: "open" | "close", tab, expanded, auto, focus } in order. Rules:
// - "Details on click" (openOnSelect) applies to a click on a device on the map or in the Devices list: it opens the
//   left panel on that device's Details. It never takes Findings away: a click on the map while the left panel shows
//   Findings leaves it there, and a finding or a device named in Details selects without switching. On narrow screens
//   it never pushes the right sheet away either (one sheet at a time). Opened by a click on the map the panel is
//   "auto" and the sheet starts collapsed to one line.
// - Clearing the selection on the map closes an auto-opened left panel that still shows Details.
// - Requests (the map's buttons, right-click, long press, the menu key) open expanded and are never auto; a button
//   closes its panel again when that tab is already in view.
// - On narrow screens only one sheet is open: opening one closes the other.
// Tested in Node: npm test

/** Effective "open details on select": the stored choice, else on for wide panels and off for narrow ones. */
export function openOnSelect(stored, wide) {
  return stored === null || stored === undefined ? Boolean(wide) : Boolean(stored);
}

/** Whether a tab's content is on screen: open, that tab, and not a collapsed sheet. */
export function tabVisible(drawer, tab) {
  return drawer.isOpen && drawer.tab === tab && (drawer.mode === "side" || drawer.expanded);
}

/** The step that closes the other sheet on narrow screens, if it is open. */
function makeRoom(panel, state) {
  const other = panel === "left" ? "right" : "left";
  return !state.wide && state[other].isOpen ? [{ panel: other, action: "close" }] : [];
}

/** After a selection. source: "map" | "devices" (the Devices list) | "findings" | "details" (a device named there).
 *  state: { wide, left: { isOpen, tab, auto, expanded }, right: { isOpen } }. Answer: a list of steps (often empty). */
export function afterSelect({ id, source, openOnSelect: open, state }) {
  const left = state.left;
  if (!id) {
    return source === "map" && left.auto && left.isOpen && left.tab === "details" ? [{ panel: "left", action: "close" }] : [];
  }
  if (!open) return [];
  if (source === "devices") {
    // The list's own click: on to the device's Details; focus follows if it was in the list (the panel decides).
    return [{ panel: "left", action: "open", tab: "details", expanded: true, auto: false, focus: "panel" }];
  }
  if (source !== "map") return [];
  if (left.isOpen && left.tab === "findings") return [];
  if (!state.wide && state.right.isOpen) return [];
  return [{ panel: "left", action: "open", tab: "details", expanded: false, auto: !left.isOpen || Boolean(left.auto),
    focus: false }];
}

/** Details asked for explicitly; via: "long-press" | "context-menu" | "key". Keyboard requests move focus into the
 *  panel, pointer requests leave it on the map. */
export function detailsRequest(via, state) {
  return [...makeRoom("left", state),
    { panel: "left", action: "open", tab: "details", expanded: true, auto: false, focus: via === "key" ? "tab" : false }];
}

/** A tab asked for by a button on the map: "Devices" (left, devices), "View" (right, view), "Legend" (right,
 *  legend). toggle: close the panel when that tab is already in view. */
export function tabRequest({ panel, tab, state, toggle = true }) {
  if (toggle && tabVisible(state[panel], tab)) return [{ panel, action: "close" }];
  return [...makeRoom(panel, state), { panel, action: "open", tab, expanded: true, auto: false, focus: "tab" }];
}
