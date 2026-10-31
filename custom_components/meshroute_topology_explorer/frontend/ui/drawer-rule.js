// SPDX-License-Identifier: MIT
// What the drawer does when the selection changes or the user asks for a tab (spec 9.1, 9.2). Pure: the panel passes
// the drawer's state and carries out the answer. Rules:
// - "Open details on select" applies to selections on the map only. It opens a closed drawer on Details, or follows
//   the selection on the Details tab; it never takes another tab away. Opened this way the drawer is "auto" and the
//   sheet starts collapsed.
// - Clearing the selection closes an auto-opened drawer that still shows Details; a drawer the user opened stays.
// - Selections from a list (Devices, Findings, a device named in Details) leave the drawer as it is.
// - Requests (badge, menu, small legend, right-click, long press, info button) open expanded and are never auto; the
//   header's toggles close the tab again when it is already in view.
// Tested in Node: node --test tests/

const NONE = Object.freeze({ action: "none" });

/** Effective "open details on select": the stored choice, else on for wide panels and off for narrow ones. */
export function openOnSelect(stored, wide) {
  return stored === null || stored === undefined ? Boolean(wide) : Boolean(stored);
}

/** Whether a tab's content is on screen: open, that tab, and not a collapsed sheet. */
export function tabVisible(drawer, tab) {
  return drawer.isOpen && drawer.tab === tab && (drawer.mode === "side" || drawer.expanded);
}

/** After a selection. drawer: { isOpen, tab, auto }; source: "map" | "list" | "chip".
 *  Answer: { action: "open", tab, expanded, auto, focus } | { action: "close" } | { action: "none" }. */
export function afterSelect({ id, source, openOnSelect: open, drawer }) {
  if (source !== "map") return NONE;
  if (id) {
    if (!open || (drawer.isOpen && drawer.tab !== "details")) return NONE;
    return { action: "open", tab: "details", expanded: false, auto: !drawer.isOpen || Boolean(drawer.auto), focus: false };
  }
  return drawer.auto && drawer.isOpen && drawer.tab === "details" ? { action: "close" } : NONE;
}

/** Details asked for explicitly; via: "long-press" | "context-menu" | "key" | "button". Keyboard requests move focus
 *  into the drawer, pointer requests leave it on the map. */
export function detailsRequest(via) {
  return { action: "open", tab: "details", expanded: true, auto: false, focus: via === "key" || via === "button" };
}

/** A tab asked for from the header or the menu. toggle: the header's badge and small legend close the tab again when
 *  it is already in view; menu entries always open. */
export function tabRequest({ tab, drawer, toggle = true }) {
  if (toggle && tabVisible(drawer, tab)) return { action: "close" };
  return { action: "open", tab, expanded: true, auto: false, focus: true };
}
