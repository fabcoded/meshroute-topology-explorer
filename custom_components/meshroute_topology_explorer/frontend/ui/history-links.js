// SPDX-License-Identifier: MIT
// The entries to the path history window from Details (spec 9.2, 9.5): the "History" button next to the device name and
// the small "history ↗" link on a path line. Both open the regular pair window; they exist for administrators only
// (ctx.history.open is null otherwise) and where a partner exists. Runs in the browser.
import { h } from "./dom.js";
import { defaultPartner } from "./history-partners.js";
import { historyCaps } from "../engines/index.js";

const nameOf = (network, id) => (network.devices.find((d) => d.id === id) || {}).label || id;

/** The "History" button for device `id`, or null: the window with the coordinator / strongest border router, or for
 *  one of those itself with its strongest neighbour (history-partners.js defaultPartner). ctx: the Details context. */
export function historyButton(ctx, id) {
  const open = ctx.history && ctx.history.open;
  const partner = open ? partnerOf(ctx, id) : null;
  if (!partner) return null;
  const title = ctx.t("history.pill_title", { a: nameOf(ctx.network, id), b: nameOf(ctx.network, partner) });
  return h("button", { type: "button", class: "button history-button", title, text: ctx.t("history.button"),
    on: { click: (e) => open(id, partner, e.currentTarget) } });
}

/** The partner of a path line's own device: see defaultPartner. */
export const partnerOf = (ctx, id) => {
  const caps = historyCaps(ctx.network);
  return defaultPartner(ctx.network, id, caps.anchorRole, caps.historyless);
};

/** A "history ↗" link for the pair a, b (a path line's ends); null without a window to open or without a partner. */
export function historyLink(ctx, a, b) {
  const open = ctx.history && ctx.history.open;
  if (!open || !b || a === b) return null;
  return h("button", { type: "button", class: "link history-link", text: ctx.t("history.path_link"),
    title: ctx.t("history.pill_title", { a: nameOf(ctx.network, a), b: nameOf(ctx.network, b) }),
    on: { click: (e) => open(a, b, e.currentTarget) } });
}
