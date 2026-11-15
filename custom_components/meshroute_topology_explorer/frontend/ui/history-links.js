// SPDX-License-Identifier: MIT
// The entries to the path history window from Details (spec 9.2, 9.5): the "History to gateway" button next to the device
// name and the small "history ↗" link on a path line. Both open the regular pair window; they exist for administrators
// only (ctx.history.open is null otherwise) and where a partner exists. Runs in the browser.
import { h } from "./dom.js";
import { anchorsFor } from "./history-partners.js";
import { historyCaps } from "../engines/index.js";

const nameOf = (network, id) => (network.devices.find((d) => d.id === id) || {}).label || id;

/** The "History to gateway" button for device `id` (#24), or null where the engine names no partner (its history
 *  caps' gateway: Zigbee the coordinator, Thread the border router of a complete route or the only one). The tooltip
 *  names the partner; the accessible name keeps the visible label in front (WCAG 2.5.3). ctx: the Details context. */
export function historyButton(ctx, id) {
  const open = ctx.history && ctx.history.open;
  const partner = open ? historyCaps(ctx.network).gateway(ctx.network, id) : null;
  if (!partner) return null;
  const text = ctx.t("history.gateway_button");
  const title = ctx.t("history.badge_title", { name: nameOf(ctx.network, partner) });
  return h("button", { type: "button", class: "button history-button", title, "aria-label": `${text}: ${title}`, text,
    on: { click: (e) => open(id, partner, e.currentTarget) } });
}

/** The other end of a path line that names none (Zigbee's up and down paths): the first anchor of the partner menu
 *  that has a history (anchorsFor: the coordinator; of several the best linked), as before #24, which decided the
 *  button only. A coordinator has no up or down path, so the anchor case of the old button rule never applies here. */
export function partnerOf(ctx, id) {
  const caps = historyCaps(ctx.network);
  const byId = new Map(ctx.network.devices.map((d) => [d.id, d]));
  return anchorsFor(ctx.network, id, caps.anchorRole).find((x) => !caps.historyless(byId.get(x))) ?? null;
}

/** A "history ↗" link for the pair a, b (a path line's ends); null without a window to open or without a partner. */
export function historyLink(ctx, a, b) {
  const open = ctx.history && ctx.history.open;
  if (!open || !b || a === b) return null;
  return h("button", { type: "button", class: "link history-link", text: ctx.t("history.path_link"),
    title: ctx.t("history.pill_title", { a: nameOf(ctx.network, a), b: nameOf(ctx.network, b) }),
    on: { click: (e) => open(a, b, e.currentTarget) } });
}
