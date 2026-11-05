// SPDX-License-Identifier: MIT
// The path history window of a device pair (spec 9.5, boards M36, M35): a modal dialog "A ⇄ B" with the tabs Timeline,
// Route (Metro-Map | Mesh) and Direct link, the ranges 48 h · 7 d · 30 d · 90 d (at most what "Keep for" holds), the history
// read through the loader, and the states "not recorded", "no records yet", "source not supported" and "failed". A
// click on a pill in the Route tab opens the Direct link tab for that hop. The second name of the title is a menu to change
// the partner, keeping tab and range. The tab last used is remembered. Runs in the browser.
import { h, iconButton } from "./dom.js";
import { hopContext, historyCaps, RANGES, LANE_HALF_WINDOW } from "../engines/index.js";
import { rangesFor } from "./history-loader.js";
import { routeAt } from "./history-route.js";
import { createRouteView } from "./history-route-view.js";
import { renderTimeline } from "./history-timeline.js";
import { renderLane, LANE_WINDOWS } from "./history-lane.js";
import { timeText } from "./history-chart.js";
import { settingsLink } from "./status-pill.js";
import { INTEGRATION_PATH } from "./ha-links.js";
import { roleText } from "./format.js";
import { partnerChoices } from "./history-partners.js";

export const TABS = Object.freeze(["timeline", "route", "lane"]);
/** The tab the window was last used on (kept while the panel lives; the badge opens on it). */
let lastTab = "timeline";
export const rememberedTab = () => lastTab;
export const forgetTab = () => { lastTab = "timeline"; };

const FOCUSABLE = "button:not([disabled]), a[href], input, [tabindex]:not([tabindex='-1'])";
let uid = 0;

/** The smallest range in `keys` that reaches `seconds` back, else the largest. */
export function rangeReaching(keys, seconds) {
  return keys.find((k) => RANGES[k] >= seconds) || keys[keys.length - 1];
}

/** Open the window. ctx: { root, t, theme(), loader, network() (localized, with `live`), a, b, tab (else the last one),
 *  lane ({ x, y } to open the Direct link tab on a lane's last 48 h), positionOf(id), opener, onClose(), now(), zone, timers }.
 *  Returns { el, close(), state }. */
export function openHistoryWindow(ctx) {
  const { t, loader, a } = ctx;
  let b = ctx.b; // the partner: changed by the title's menu
  const now = ctx.now || (() => Date.now() / 1000);
  const id = `mte-history-${++uid}`;
  const state = { tab: ctx.tab || (ctx.lane ? "lane" : lastTab), range: "48h", ranges: rangesFor(null),
    route: { mode: "metro", index: -1, sel: null, playing: false },
    lane: ctx.lane ? { x: ctx.lane.x, y: ctx.lane.y, context: null, key: "48h", fromRow: true } : { x: a, y: b, context: null, key: "48h", fromRow: true },
    table: false };
  lastTab = state.tab;
  let routeView = null;
  let closed = false;
  let token = 0;
  const deviceOf = (history) => (key) => ctx.network().devices.find((d) => d.id === key) || history.device(key);
  const labelOf = (history) => (key) => deviceOf(history)(key).label || key;

  const title = h("h2", { id: `${id}-title`, class: "hist-title" });
  const menu = h("div", { class: "hist-partners", hidden: true });
  const choicesBox = h("div", { class: "hist-choices" });
  const closeButton = iconButton("close", t("history.close"), () => finish(), "icon-button dialog-close");
  const tabs = h("div", { class: "hist-tabs", role: "tablist" });
  const rangeBox = h("div", { class: "hist-ranges", role: "group", "aria-label": t("history.ranges") });
  const body = h("div", { class: "hist-body" });
  const dialog = h("dialog", { class: "history-dialog", "aria-labelledby": `${id}-title` },
    h("div", { class: "hist-head" }, title, closeButton), menu, h("div", { class: "hist-bar" }, tabs, rangeBox), body);

  function stopRoute() { if (routeView) { routeView.destroy(); routeView = null; } }
  function finish() {
    if (closed) return;
    closed = true;
    stopRoute();
    if (dialog.open) dialog.close();
    dialog.remove();
    if (ctx.opener && ctx.opener.isConnected && ctx.opener.focus) ctx.opener.focus();
    if (ctx.onClose) ctx.onClose();
  }

  function renderBar(names) {
    const partner = h("button", { type: "button", class: "hist-partner", "aria-haspopup": "true", "aria-expanded": String(!menu.hidden),
      title: t("history.partner"), on: { click: toggleMenu } }, names(b), " \u25BE");
    title.replaceChildren(`${names(a)} \u21C4 `, partner);
    title.setAttribute("aria-label", t("history.pair", { a: names(a), b: names(b) }));
    tabs.replaceChildren(...TABS.map((tab) => h("button", { type: "button", role: "tab", id: `${id}-tab-${tab}`, class: `htab${state.tab === tab ? " on" : ""}`,
      "aria-selected": String(state.tab === tab), text: t(`history.tab_${tab}`), on: { click: () => switchTab(tab) } })));
    rangeBox.replaceChildren(...(state.tab === "lane" ? [] : state.ranges.map((r) => h("button", { type: "button", class: `seg${state.range === r ? " on" : ""}`,
      "aria-pressed": String(state.range === r), text: t(`history.range_${r}`), on: { click: () => { state.range = r; state.route.index = -1; show(); } } }))));
  }

  /** The partner menu (owner 2026-11-05): the coordinator / border routers, then a's neighbours by reception, and a search
   *  over all devices. A choice keeps the tab and the range. */
  function fillMenu(query) {
    const net = ctx.network();
    const name = (k) => (net.devices.find((d) => d.id === k) || {}).label || k;
    const rows = partnerChoices(net, a, historyCaps(net).anchorRole, query).map((c) => h("button", { type: "button", class: `hist-choice${c.id === b ? " on" : ""}`, "aria-current": String(c.id === b),
      on: { click: () => setPartner(c.id) } }, h("span", { text: name(c.id) }), h("small", { class: "muted", text: c.group === "anchor" ? roleText(net.devices.find((d) => d.id === c.id).role, t) : t(`history.partner_${c.group}`) })));
    choicesBox.replaceChildren(...(rows.length ? rows : [h("p", { class: "muted small", text: t("history.partner_none") })]));
  }
  function toggleMenu() {
    menu.hidden = !menu.hidden;
    if (menu.hidden) { renderBar((k) => labelFor(k)); return; }
    const search = h("input", { type: "search", class: "hist-search", placeholder: t("history.partner_search"), "aria-label": t("history.partner_search") });
    search.addEventListener("input", () => fillMenu(search.value));
    menu.replaceChildren(search, choicesBox);
    fillMenu("");
    renderBar((k) => labelFor(k));
    search.focus();
  }
  const labelFor = (k) => ctx.network().devices.find((d) => d.id === k)?.label || k;
  function setPartner(key) {
    b = key;
    menu.hidden = true;
    state.lane = { x: a, y: b, context: null, key: "48h", fromRow: true };
    state.route = { ...state.route, index: -1, sel: null };
    show();
  }

  function switchTab(tab) {
    state.tab = tab;
    lastTab = tab;
    show();
  }

  /** The range a tab needs: Direct link reaches back to its window's start. */
  function neededRange() {
    if (state.tab !== "lane") return state.range;
    const lane = state.lane;
    if (lane.fromRow || !lane.context) return "48h";
    const half = (LANE_WINDOWS.find(([k]) => k === lane.key) || LANE_WINDOWS[1])[1];
    return rangeReaching(state.ranges, now() - (lane.context.t - half));
  }

  async function show() {
    const mine = ++token;
    stopRoute();
    renderBar((k) => k);
    body.replaceChildren(h("p", { class: "muted", text: t("history.loading") }));
    if (!state.infoRead) {
      const info = await loader.info();
      if (mine !== token || closed) return;
      state.infoRead = true;
      state.ranges = rangesFor(info.keepDays);
      if (!state.ranges.includes(state.range)) state.range = state.ranges[state.ranges.length - 1];
    }
    const result = await loader.get(neededRange());
    if (mine !== token || closed) return;
    const names = result.history ? labelOf(result.history) : (k) => ctx.network().devices.find((d) => d.id === k)?.label || k;
    renderBar(names);
    body.replaceChildren();
    if (!result.history || result.state === "off" || result.state === "empty" || result.state === "unsupported" || result.state === "failed") {
      body.append(message(result));
      return;
    }
    if (result.state === "sparse") body.append(h("p", { class: "small muted", text: t("history.sparse") }));
    const view = h("div", { class: "hist-tab", role: "tabpanel", "aria-labelledby": `${id}-tab-${state.tab}` });
    body.append(view);
    renderTab(view, result);
  }

  function message(result) {
    if (result.state === "off") return h("p", { class: "muted" }, `${t("history.off")} `, settingsLink(INTEGRATION_PATH, t("history.settings"), { class: "inline-link" }));
    if (result.state === "unsupported") return h("p", { class: "muted", text: t("history.unsupported", { error: result.info.lastError }) });
    if (result.state === "failed") return h("p", { class: "muted", role: "alert", text: t("history.failed", { error: result.error }) });
    return h("p", { class: "muted", text: t("history.none") });
  }

  function renderTab(view, result) {
    const history = result.history;
    const caps = historyCaps(ctx.network());
    const theme = ctx.theme();
    const labels = labelOf(history);
    const last = history.snapshots[history.snapshots.length - 1].t;
    const width = Math.max(300, body.clientWidth || 600);
    const tl = history.timeline(a, b);
    const to = Math.max(now(), last);
    const from = to - RANGES[neededRange()];
    if (state.tab === "timeline") {
      renderTimeline(view, { t, theme, tl, from, to, width, labelOf: labels, walks: caps.walks, a, b });
    } else if (state.tab === "route") {
      if (state.route.index >= tl.points.length || state.route.index < 0) state.route.index = tl.points.length - 1;
      routeView = createRouteView({ t, theme: ctx.theme, walks: caps.walks, meshHeight: () => Math.max(320, (body.clientHeight || 640) - 200), tl, from, to, state: state.route, deviceOf: deviceOf(history),
        positionOf: ctx.positionOf, timers: ctx.timers, recordText: (s) => t("history.record_at", { time: timeText(s, t.formatLocale, ctx.zone) }),
        getRoute: (i) => routeAt({ history, caps, tl, index: i, t, table: history.snapshots[tl.points[i] ? tl.points[i].index : 0]?.table }),
        onPill: (item) => openLane(history, caps, tl, item), onChange() {} });
      view.append(routeView.el);
      routeView.redraw();
    } else {
      const lane = state.lane;
      const half = lane.context ? (LANE_WINDOWS.find(([k]) => k === lane.key) || LANE_WINDOWS[1])[1] : LANE_HALF_WINDOW;
      const data = history.lane(lane.x, lane.y, lane.context ? { center: lane.context.t, half } : { last: true }, lane.context);
      const hop = lane.context ? tl.points[lane.context.index] && tl.points[lane.context.index][lane.context.direction] : null;
      const h0 = hop && hop.hops ? hop.hops[lane.context.hopIndex] : null;
      const clickedText = h0 && typeof h0.lqi === "number" ? (typeof h0.rankPct === "number" ? t("history.lane_clicked", { lqi: h0.lqi, pct: h0.rankPct })
        : t("history.lane_clicked_plain", { lqi: h0.lqi })) : null;
      renderLane(view, { t, theme, lane: data, lqiMax: caps.lqiMax, keepsNoTable: caps.keepsNoTable, deviceOf: deviceOf(history), labelOf: labels, now: now(),
        firstRecord: history.snapshots[0].t, ids: lane.context ? lane.context.ids : [], context: lane.context, fromRow: lane.fromRow,
        clickedText, windowKey: lane.key, zone: ctx.zone, width, state, onWindow: (key) => { lane.key = key; show(); } });
    }
  }

  /** A pill was clicked: the Direct link tab for that hop, centred on the record the pill belongs to, its nodes stay ringed. */
  function openLane(history, caps, tl, item) {
    const point = tl.points[item.pointIndex];
    const context = caps.walks ? hopContext(tl, item.dir, point, item.hopIndex, item.ghost)
      : { pair: [a, b], direction: item.dir, t: point.t, index: point.index, hopIndex: 0, hopCount: 1, sender: item.sender, hearer: item.hearer,
        ids: [item.sender, item.hearer], complete: true, reason: null, ghost: item.ghost };
    state.route.sel = { dir: item.dir, sender: item.sender, hearer: item.hearer };
    state.lane = { x: context.sender, y: context.hearer, context, key: "48h", fromRow: false };
    switchTab("lane");
  }

  dialog.addEventListener("cancel", (e) => { e.preventDefault(); finish(); });
  dialog.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); finish(); return; }
    if (e.key !== "Tab") return;
    const order = [...dialog.querySelectorAll(FOCUSABLE)].filter((el) => !el.hidden && el.offsetParent !== null);
    if (!order.length) return;
    const at = order.indexOf(dialog.getRootNode().activeElement);
    e.preventDefault();
    order[(at + (e.shiftKey ? -1 : 1) + order.length) % order.length].focus();
  });
  dialog.addEventListener("click", (e) => { if (e.target === dialog) finish(); });
  ctx.root.append(dialog);
  if (dialog.showModal) dialog.showModal(); else dialog.setAttribute("open", "");
  closeButton.focus();
  show();
  return { el: dialog, close: finish, state, routeView: () => routeView };
}
