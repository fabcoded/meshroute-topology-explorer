// SPDX-License-Identifier: MIT
// The small "Direct link" card a click on a reception pill opens at the pill (spec 9.5, board M37b B): both directions of
// the pill's lane, each with its value now and a 48 h sparkline, and two buttons into the regular pair window (Direct
// link tab, Route tab). It never touches the map selection; one card at a time (the host owns it). Runs in the browser.
import { h } from "./dom.js";
import { sparkModel, sparkline } from "./history-sparkline.js";
import { settingsLink } from "./status-pill.js";
import { INTEGRATION_PATH } from "./ha-links.js";

const GAP = 14;
const EDGE = 8;

/** "B hears A · 64 · rank 45 %" (Zigbee) or "B hears A · −75 dBm · LQI 3" (Thread): the pill's text plus what it leaves out. */
export function cardLine(t, link, name, engine) {
  const parts = [t("history.card_hears", { hearer: name(link.hearer), sender: name(link.sender) }), link.text];
  if (engine === "zigbee" && link.rankPct !== null) parts.push(t("history.card_rank", { pct: link.rankPct }));
  if (engine !== "zigbee" && link.rssi !== null && link.lqi !== null) parts.push(`LQI ${link.lqi}`);
  return parts.join(" · ");
}

/** The points of the 48 h line for `link` (the hearer's own reading of the sender): Thread draws RSSI where recorded. */
export function cardSeries(history, link, engine) {
  const lane = history.lane(link.hearer, link.sender, { last: true }, null);
  return lane.aHearsB.map(([time, lqi, rssi]) => [time, engine !== "zigbee" && typeof rssi === "number" ? rssi : lqi]);
}

/** Open the card. ctx: { host (the map's element), t, x, y (the pill's centre in it), a, b, links (GraphView.pairLinks), names(id),
 *  engine, loader, onOpen("lane" | "timeline"), onClose() }. Returns { el, close }. */
export function openPairCard(ctx) {
  const { t, a, b } = ctx;
  const title = t("history.link_title", { a: ctx.names(a), b: ctx.names(b) });
  const rows = ctx.links.map((link) => ({ link, spark: h("span", { class: "card-spark" }) }));
  const note = h("small", { class: "muted card-note" });
  const close = h("button", { type: "button", class: "card-close", "aria-label": t("history.close"), title: t("history.close"), text: "×", on: { click: () => finish() } });
  const el = h("div", { class: "pair-card", role: "dialog", "aria-label": title, tabIndex: -1,
    on: { keydown: (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(); } } } },
  h("div", { class: "card-head" }, h("b", { text: title }), close),
  ...rows.map(({ link, spark }) => h("div", { class: "card-row" }, h("span", { text: cardLine(t, link, ctx.names, ctx.engine) }), spark)),
  note,
  h("div", { class: "card-actions" },
    h("button", { type: "button", class: "button", text: t("history.card_direct"), on: { click: () => ctx.onOpen("lane") } }),
    h("button", { type: "button", class: "button", text: t("history.card_route"), on: { click: () => ctx.onOpen("timeline") } })));
  let done = false;
  function finish() {
    if (done) return;
    done = true;
    el.remove();
    ctx.onClose();
  }
  // Next to the pill, kept inside the map; flipped above the pill where there is no room below. On a phone the stylesheet
  // makes it a bottom sheet whatever these say.
  ctx.host.append(el);
  const [w, hh] = [el.offsetWidth || 260, el.offsetHeight || 120];
  const [mw, mh] = [ctx.host.clientWidth || 800, ctx.host.clientHeight || 600];
  const below = ctx.y + GAP + hh <= mh - EDGE;
  Object.assign(el.style, { left: `${Math.max(EDGE, Math.min(ctx.x - w / 2, mw - w - EDGE))}px`,
    top: `${Math.max(EDGE, below ? ctx.y + GAP : ctx.y - GAP - hh)}px` });
  el.focus();
  load();
  return { el, close: finish };

  /** Fill the lines from the cached history (never blocks the values); without a recording say why instead. */
  async function load() {
    let result;
    try { result = await ctx.loader.get("48h"); } catch { return; }
    if (done) return;
    if (result.state === "off" || result.state === "unsupported") {
      note.replaceChildren(result.state === "off" ? h("span", {}, `${t("history.off")} `, settingsLink(INTEGRATION_PATH, t("history.settings"), { class: "inline-link" }))
        : t("history.unsupported", { error: result.info.lastError }));
      return;
    }
    if (!result.history) return;
    for (const { link, spark } of rows) {
      const model = sparkModel(cardSeries(result.history, link, ctx.engine));
      if (model) spark.replaceChildren(sparkline(model));
    }
  }
}
