// SPDX-License-Identifier: MIT
// Details of a device in a Thread network (spec 3.2, 9.2): Thread data has no signature and no clusters, so instead
// of the three sub-tabs one stack of cards: the head (name, type · role · vendor model, the state), the route to the
// default border router (hop list there and back, path cost, weakest hop, source and age of the tables; routes.js),
// the neighbours with the reception in both directions (RSSI in dBm and link quality 0-3, each measured by its
// receiver), parent or children, the findings, and the Thread facts (role, extended address, RLOC16, Matter node id,
// the partition id and leader router ID as last read; a border router's advertised partition, #21). What the tables
// panel beside the Details shows (#25: neighbours and route as tables, the explanations under "About these values")
// is offered from here to the panel's shell (ui/slideout.js); where none can be offered the cards keep every
// explanation. Names are set as text. Runs in the browser; the rows are pure (threadNeighbourRows, routeRows) and
// tested in Node.
import { h, icon } from "../../ui/dom.js";
import { findingText } from "./findings.js";
import { roleText } from "../../ui/format.js";
import { historyButton } from "../../ui/history-links.js";
import { unknownGlyph } from "../unknown-reason.js";
import { markedWeak } from "./routes.js";
import { ageParts } from "../../ui/status.js";
import { sharingPartition } from "./advertised.js";

/** A direction's reception as text: "−75 dBm · LQI 3", what is known of it, or the unknown glyph. */
export function threadReception(dir) {
  if (!dir || dir.state !== "measured") return unknownGlyph(dir && dir.reason);
  const parts = [];
  if (typeof dir.rssi === "number") parts.push(`${String(dir.rssi).replace("-", "−")} dBm`);
  if (typeof dir.lqi === "number") parts.push(`LQI ${dir.lqi}`);
  return parts.join(" · ") || "?";
}

/** One row per neighbour of device `id`: { id, hears (id hears it), heardBy (it hears id), parent, child }, the
 *  parent first, then by label in natural order. */
export function threadNeighbourRows(network, id) {
  const byId = new Map(network.devices.map((d) => [d.id, d]));
  const self = byId.get(id);
  const rows = [];
  for (const p of network.pairs || []) {
    if (p.a !== id && p.b !== id) continue;
    const other = p.a === id ? p.b : p.a;
    rows.push({ id: other, hears: p.a === id ? p.ab : p.ba, heardBy: p.a === id ? p.ba : p.ab,
      parent: Boolean(self && self.parent === other), child: Boolean(self && self.children.includes(other)) });
  }
  const label = (r) => (byId.get(r.id) || { label: r.id }).label;
  return rows.sort((x, y) => (y.parent - x.parent) || label(x).localeCompare(label(y), undefined, { numeric: true }));
}

/** Older than this a table's values show in amber (spec 6: the age at which the pill's dot turns amber), judged by
 *  the worst case: the read interval's lower bound, or unknown (owner 2026-11-09). */
export const OLD_TABLE_MS = 4 * 3600 * 1000;

/** Whether a table read in `times` ({ lo, hi } or null) may be older than OLD_TABLE_MS at `now`. */
export const mayBeOld = (times, now) => !times || times.lo === null || now - times.lo > OLD_TABLE_MS;

/** The rows of a route's hop list (spec 3.2 "Routes"): one per hop there, with the reverse hop back beside it; a hop
 *  back that does not reverse one there gets a row of its own (back only). Per cell { lqi, rssi, holder and table
 *  (whose table it comes from: the receiver's neighbour table, else the sender's route table, its LQI out), source,
 *  times (that table's read interval), old (it may be older than OLD_TABLE_MS: mayBeOld), derived }; the cost as the
 *  sender counts it; weakThere / weakBack mark the weakest hop of a direction below LQI 3 (routes.js markedWeak).
 *  Pure. */
export function routeRows(tables, r, now) {
  const cell = (x) => {
    if (!x) return null;
    const holder = x.source === "neighbours" ? x.to : x.source === "lqi out" ? x.from : null;
    const table = x.source === "neighbours" ? "neighbours" : x.source === "lqi out" ? "routes" : null;
    const h = holder ? tables.holders.get(holder) : null;
    const times = h ? h.times[table] : null;
    return { lqi: x.lqi, rssi: x.rssi, holder, table, source: x.source, derived: x.derived, times,
      old: holder !== null && mayBeOld(times, now) };
  };
  const back = r.back ? [...r.back.hops] : [];
  const rows = r.there.hops.map((x, k) => {
    const j = back.findIndex((y) => y && y.from === x.to && y.to === x.from);
    const b = j >= 0 ? back[j] : null;
    if (j >= 0) back[j] = null;
    return { n: k + 1, from: x.from, to: x.to, there: cell(x), back: cell(b), cost: x.cost, backDerived: Boolean(b && b.derived),
      child: x.decided === "parent", weakThere: k === r.there.weakest && markedWeak(x),
      weakBack: Boolean(b && r.back.hops.indexOf(b) === r.back.weakest && markedWeak(b)) };
  });
  back.forEach((b, j) => {
    if (b) rows.push({ n: null, from: b.to, to: b.from, there: null, back: cell(b), cost: b.cost, backDerived: b.derived,
      child: false, weakThere: false, weakBack: j === r.back.weakest && markedWeak(b) });
  });
  return rows;
}

/** The tables the route's values come from, in order: [{ id (the holder), table ("neighbours" | "routes" | null
 *  where the device has no tables in the cache), times ({ lo, hi } or null), both (the holder gives values from both
 *  its tables) }]. */
export function routeHolders(tables, rows) {
  const out = new Map();
  for (const row of rows) {
    for (const c of [row.there, row.back]) {
      if (!c) continue;
      addHolders(out, tables, row, c);
    }
  }
  const list = [...out.values()];
  for (const x of list) x.both = list.filter((y) => y.id === x.id && y.table).length > 1;
  return list;
}

/** Add the tables cell `c` of `row` comes from to `out` (by "id|table"), each once: its holder's table, else each
 *  end of the hop that has no tables in the cache (table null). */
function addHolders(out, tables, row, c) {
  const found = c.holder ? [[c.holder, c.table]] : [row.from, row.to].filter((id) => !tables.holders.has(id))
    .map((id) => [id, null]);
  for (const [id, table] of found) {
    const key = `${id}|${table}`;
    if (out.has(key)) continue;
    const h = tables.holders.get(id);
    out.set(key, { id, table, times: h && table ? h.times[table] : null, both: false });
  }
}

/** "09:50–10:00", "yesterday 22:10–08:05", "11/7 09:50–10:00", or "before 13:50" ("before 15:09 yesterday") where
 *  the lower bound is unknown:
 *  when the Matter server read a table, in the browser's local time. t: the panel's words (t.formatLocale). */
export function readText(times, now, t) {
  const at = (ms) => new Date(ms);
  const sameDay = (a, b) => at(a).toDateString() === at(b).toDateString();
  const clock = (ms) => new Intl.DateTimeFormat(t.formatLocale, { hour: "2-digit", minute: "2-digit" }).format(at(ms));
  const day = (ms) => (sameDay(ms, now) ? "" : sameDay(ms, now - 86400000) ? `${t("details.route_yesterday")} `
    : `${new Intl.DateTimeFormat(t.formatLocale, { month: "numeric", day: "numeric" }).format(at(ms))} `);
  // Time first, then the day: "read before 03:09 PM yesterday" (rev11a-b), never "before yesterday".
  const after = (ms) => day(ms).trim();
  if (times.lo === null) {
    return t("details.route_read_before", { time: [clock(times.hi), after(times.hi)].filter(Boolean).join(" ") });
  }
  const end = sameDay(times.lo, times.hi) ? clock(times.hi) : `${day(times.hi)}${clock(times.hi)}`;
  return t("details.route_read_between", { from: `${day(times.lo)}${clock(times.lo)}`, to: end });
}

const card = (title, ...children) => h("section", { class: "card" },
  typeof title === "string" ? h("h3", { class: "card-title", text: title }) : title, ...children);

/** A card's title with the "i" that opens the tables panel on "About these values" (#25), or the plain title. */
const cardTitle = (title, info) => (info ? h("div", { class: "card-head" }, h("h3", { class: "card-title", text: title }), info)
  : title);

/** Fill `container` for a Thread device. ctx: the Details context of panel.js (network, t, id, onSelect, onFindings,
 *  slideout: the shell of the tables panel, #25; absent where there is none). */
export function renderThreadDetails(container, ctx) {
  const { network, t } = ctx;
  container.replaceChildren();
  const d = ctx.id ? network.devices.find((x) => x.id === ctx.id) : null;
  if (!d) {
    container.append(h("p", { class: "empty", text: t("details.empty") }));
    return;
  }
  const name = (id) => (network.devices.find((x) => x.id === id) || { label: id }).label;
  const product = [d.vendor, d.model].filter(Boolean).join(" ");
  const role = d.leader ? `${roleText(d.role, t)} (${t("details.thread_leader")})` : roleText(d.role, t);
  const line = [role, product].filter(Boolean).join(" · ");
  const rows = threadNeighbourRows(network, d.id);
  const route = routeModel(ctx, d);
  const offer = tablesOffer(ctx, d, name, route, rows);
  const openers = offer ? offer.openers : {};
  const head = h("div", { class: "details-head" }, h("div", { class: "details-title" }, h("h2", { class: "device-name", text: d.label }),
    h("div", { class: "title-buttons" }, historyButton(ctx, d.id), openers.tables)), h("p", { class: "muted", text: line }));
  if (!d.available) head.append(h("p", { class: "warn-text", text: t("details.thread_stale") }));
  if (!d.availabilityKnown) head.append(h("p", { class: "muted small", text: t("details.thread_availability_unknown") }));
  // #20: a border router only Home Assistant's Thread integration lists, and the preferred one.
  if (d.inTopology === false) head.append(h("p", { class: "muted small", text: t("details.thread_br_unheard") }));
  if (d.preferred) head.append(h("p", { class: "muted small", text: t("details.thread_br_preferred") }));
  container.append(head);
  // #25: neighbours above the route, as in the tables panel beside the drawer.
  container.append(neighboursCard(ctx, name, rows, openers.neighbours));
  const routeBox = routeCard(ctx, d, name, route, openers.route);
  if (routeBox) container.append(routeBox);

  const findings = (network.findings || []).filter((f) => f.device === d.id);
  if (findings.length) {
    container.append(card(t("tab.findings"), ...findings.map((f) => {
      const { title, lines } = findingText(f, t, name);
      return h("div", {}, h("strong", { text: title }), ...lines.map((l) => h("p", { class: "muted small", text: l })));
    })));
  }

  const hex = (n) => (typeof n === "number" ? `0x${n.toString(16).toUpperCase().padStart(4, "0")}` : t("details.thread_unknown"));
  container.append(card(cardTitle(t("details.tab_entity"), openers.facts), h("ul", { class: "plain" },
    h("li", { text: t("details.thread_role", { role: d.threadRole || "?" }) }),
    h("li", { text: t("details.thread_ext", { value: d.extAddress || "?" }) }),
    h("li", { text: t("details.thread_rloc", { value: hex(d.rloc16) }) }),
    d.nodeId !== null ? h("li", { text: t("details.thread_node", { value: String(d.nodeId) }) }) : null,
    // #21: the device's own values, shown raw; nothing is derived from them (spec 3.2 "Partitions").
    d.partitionRead ? h("li", { text: t(d.partitionRead.leaderRouterId === null ? "details.thread_partition_read"
      : "details.thread_partition_read_leader", { partition: d.partitionRead.partition, leader: d.partitionRead.leaderRouterId }) })
      : null,
    advertisedItem(ctx, d, name, !openers.facts))));
  if (offer) ctx.slideout.offer(offer);
}

/** The neighbours card: both directions per neighbour, the parent first (threadNeighbourRows); a name selects that
 *  device. `info`: the "i" of the tables panel (#25), which then holds the note on where the values come from. */
function neighboursCard(ctx, name, rows, info) {
  const { t } = ctx;
  const link = (id) => h("button", { type: "button", class: "link", text: name(id), on: { click: () => ctx.onSelect(id) } });
  const list = rows.length ? h("ul", { class: "plain" }, rows.map((r) => h("li", {},
    h("div", {}, link(r.id), neighbourMark(r, t)),
    h("div", { class: "muted small", text: t("details.thread_hears", { name: name(r.id), value: threadReception(r.hears) }) }),
    h("div", { class: "muted small", text: t("details.thread_heard_by", { name: name(r.id), value: threadReception(r.heardBy) }) }))))
    : h("p", { class: "muted", text: t("details.thread_none") });
  return card(cardTitle(t("details.thread_title"), info), info ? null : h("p", { class: "muted small", text: t("details.thread_note") }),
    list);
}

/** " · Parent" or " · End device" after a neighbour's name, or "". */
const neighbourMark = (r, t) => (r.parent ? ` · ${t("lane.parent")}` : r.child ? ` · ${t("role.end device")}` : "");

/** A border router's advertised partition (#21, spec 9.2), or null without one; `explained`: with the sentence on
 *  what a partition is (false where it moved to the tables panel, #25). */
function advertisedItem(ctx, d, name, explained) {
  const { network, t } = ctx;
  if (!d.advertised) return null;
  const { partition, at } = d.advertised;
  const line = at === null ? t("details.thread_partition_advertised_unknown", { partition })
    : t("details.thread_partition_advertised", { partition, age: ageParts(at, ctx.now ?? Date.now()) });
  const others = network.advertisedPartitions ? sharingPartition(network, d) : null;
  const shared = !others ? null : others.length ? t("details.thread_partition_shared", { names: t.list(others.map(name)) })
    : t("details.thread_partition_alone");
  return h("li", {}, h("div", { text: line }),
    explained ? h("div", { class: "muted small", text: t("details.thread_partition_explained") }) : null,
    shared ? h("div", { text: shared }) : null);
}

/** The device's route to the default border router with what the route card and the tables panel show of it: { r,
 *  rows (routeRows), tables, holders (routeHolders), now, old (a value may be older than 4 hours), derived (a
 *  derived hop or null) }. Null for a border router (also without the tables, #20), without the Matter cache's route
 *  tables, and where the network has no border router. */
function routeModel(ctx, d) {
  const { network } = ctx;
  const r = d.role !== "border router" && network.routing ? network.routing.defaultRoute(d.id) : null;
  if (!r) return null;
  const now = ctx.now ?? Date.now();
  const tables = network.routing.tables;
  const rows = routeRows(tables, r, now);
  const holders = routeHolders(tables, rows);
  return { r, rows, tables, holders, now, old: holders.some((x) => x.table && mayBeOld(x.times, now)),
    derived: [...r.there.hops, ...(r.back ? r.back.hops : [])].find((x) => x.derived) || null };
}

/** The route card (board M38 section 2, #22): the route to the default border router, its hops there and back with
 *  what each receiver hears and the table it comes from, the cost as each sender counts it, the weakest hop per
 *  direction, a derived hop's note, the source line with when the Matter server read each table, and amber values
 *  with the note on them; without the Matter cache's tables the reason they could not be read; null for a border
 *  router or without a route. `info`: the "i" of the tables panel (#25): then what each value means, the derived note
 *  and the source line are in the panel, and the note on amber values is the short one. */
function routeCard(ctx, d, name, route, info) {
  const { network, t } = ctx;
  if (!route) {
    return d.role !== "border router" && !network.routing && network.routingProblem
      ? card(t("details.route_title", { name: t("role.border router") }),
        h("p", { class: "muted small", text: t("details.route_problem", { message: network.routingProblem }) }))
      : null;
  }
  const { r, rows } = route;
  const hops = routeList(rows, name, t);
  const summary = routeSummary(r, t);
  const weakest = weakestText(r, name, t);
  const here = !info; // the explanations stay in the card
  return card(cardTitle(t("details.route_title", { name: name(r.to) }), info),
    summary ? h("p", { class: "muted small", text: summary }) : null,
    ...routeLines(r, name, t).map((text) => h("p", { class: "muted small", text })),
    here && hops ? h("p", { class: "muted small", text: t("details.route_hint") }) : null,
    hops,
    weakest ? h("p", { class: "muted small", text: weakest }) : null,
    here && route.derived ? h("p", { class: "muted small", text: t("details.route_derived_note", { name: name(route.derived.to) }) }) : null,
    here ? sourceLine(route, name, t) : null,
    route.old ? h("p", { class: "small warn-text", text: t(here ? "details.route_old" : "details.route_old_short") }) : null,
    network.advertisedPartitions ? h("p", { class: "muted small", text: t("route.partitions_note") }) : null); // #21
}

/** The route card's line about the weakest hop of each direction ("Weakest there …; back …"), or null without one. */
function weakestText(r, name, t) {
  const pick = (way, k) => (k === null || k === undefined ? null : way.hops[k]);
  const wt = pick(r.there, r.there.weakest);
  const wb = r.back ? pick(r.back, r.back.weakest) : null;
  const hopName = (x) => (x ? `${name(x.from)} → ${name(x.to)} (${hopValue(x)})` : "?");
  return wt || wb ? t("details.route_weakest", { there: hopName(wt), back: hopName(wb) }) : null;
}

/** The width the tables panel's widest table, the five-column hop table, needs without scrolling sideways: its
 *  min-content width at 13 px (names and sources wrap, values do not), 424 px in headless Chromium on the dev page's
 *  routes sample with and without long names (2026-11-15). The shell adds its padding and scrollbar gutter. */
const TABLES_MIN_WIDTH = 424;

/** What the tables panel shows for device `d` (#25, owner 2026-11-15), as an offer to its shell (ui/slideout.js), or
 *  null where none can be offered: no shell, or neither neighbours nor a route with hops; the cards then keep every
 *  explanation. Sections: "Neighbours" (a table) and "Route to …" (summary or where it stops, the source line, the
 *  hop table, the weakest hops). "About these values" holds the explanations that apply, in this order: the
 *  neighbours' note, what a hop's values are, the derived hop's note, the amber note, what a partition is. Openers:
 *  the "Tables" button and an "i" for each card whose explanation moved there. */
function tablesOffer(ctx, d, name, route, rows) {
  const { t, slideout } = ctx;
  const hops = route ? route.rows : [];
  if (!slideout || (!rows.length && !hops.length)) return null;
  const key = d.id;
  const about = t("details.tables_about");
  // Stable ids: a redraw of the Details finds a focused button again (panel.js keepFocus).
  const info = (which) => h("button", { type: "button", id: `mte-tables-info-${which}`, class: "info-button",
    "aria-label": about, title: about, on: { click: () => slideout.showInfo(key, which) } },
  h("span", { "aria-hidden": "true", text: "i" }));
  const section = (id, heading, ...children) => h("section", { class: "slideout-section" },
    h("h3", { id, class: "card-title", text: heading }), ...children);
  const texts = [rows.length && t("details.thread_note"), hops.length && t("details.route_hint"),
    hops.length && route.derived && t("details.route_derived_note", { name: name(route.derived.to) }),
    hops.length && route.old && t("details.route_old"), d.advertised && t("details.thread_partition_explained")];
  const lines = hops.length ? [routeSummary(route.r, t), stopLine(route.r, name, t), weakestText(route.r, name, t)] : [];
  const note = (text) => (text ? h("p", { class: "muted small", text }) : null);
  return { key, title: d.label, closeLabel: t("drawer.close"), infoLabel: about, info: texts.filter(Boolean),
    minWidth: TABLES_MIN_WIDTH,
    openers: { tables: h("button", { type: "button", id: "mte-tables-open", class: "button tables-button", "aria-expanded": "false",
      on: { click: () => slideout.toggle(key) } }, t("details.tables_button"), icon("expand", 16)),
    neighbours: rows.length ? info("neighbours") : null, route: hops.length ? info("route") : null,
    facts: d.advertised ? info("facts") : null },
    sections: [
      rows.length ? section("mte-tables-neighbours", t("details.tables_neighbours"),
        neighbourTable(rows, name, t, "mte-tables-neighbours")) : null,
      hops.length ? section("mte-tables-route", t("details.route_title", { name: name(route.r.to) }),
        note(lines[0]), note(lines[1]), sourceLine(route, name, t), routeTable(route.rows, name, t, "mte-tables-route"),
        note(lines[2])) : null,
    ].filter(Boolean) };
}

/** A table in a box that scrolls sideways where the panel is narrower; the box takes focus, so the keyboard can
 *  scroll it too, and is named by the section's heading (`labelledBy`). */
const tableBox = (labelledBy, cls, head, body) => h("div", { class: "scroll", tabIndex: 0, role: "group",
  "aria-labelledby": labelledBy }, h("table", { class: cls },
  h("thead", {}, h("tr", {}, ...head.map((text) => h("th", { scope: "col", text })))), h("tbody", {}, ...body)));

/** The neighbours as a table (#25): the same rows, order and marks as the Details list (threadNeighbourRows); per
 *  neighbour its name (row header) with parent or end device, what this device hears of it and what it hears of
 *  this device. Null without neighbours. */
function neighbourTable(rows, name, t, labelledBy) {
  if (!rows.length) return null;
  return tableBox(labelledBy, "slideout-table", [t("details.tables_head_neighbour"), t("details.tables_head_hears"),
    t("details.tables_head_heard")], rows.map((r) => h("tr", {},
    h("th", { scope: "row" }, name(r.id), h("span", { class: "muted", text: neighbourMark(r, t) })),
    h("td", {}, h("span", { class: "nowrap", text: threadReception(r.hears) })),
    h("td", {}, h("span", { class: "nowrap", text: threadReception(r.heardBy) })))));
}

/** The five-column hop table (#25, as before #22; routeRows): number, hop (row header), there and back with the
 *  weakest and old values marked, a derived hop tagged and the source table below each value, and the cost with a
 *  child's note. Null without rows. */
function routeTable(rows, name, t, labelledBy) {
  if (!rows.length) return null;
  const td = (c, weak, derived) => h("td", { class: [weak ? "weak" : "", c && c.old ? "warn-text" : ""].filter(Boolean).join(" ") },
    h("span", { class: "nowrap", text: hopValue(c) }),
    derived ? h("span", { class: "tag", text: ` ${t("details.route_derived")}` }) : null,
    c && c.holder ? h("div", { class: "muted small source", text: sourceText(c, name, t) }) : null);
  return tableBox(labelledBy, "slideout-table hop-table", ["#", t("details.route_head_hop"), t("details.route_head_there"),
    t("details.route_head_back"), t("details.route_head_cost")], rows.map((row) => h("tr", {},
    h("td", { text: row.n === null ? "" : String(row.n) }),
    h("th", { scope: "row", class: "hop-names", text: `${name(row.from)} → ${name(row.to)}` }),
    td(row.there, row.weakThere, false),
    td(row.back, row.weakBack, row.backDerived),
    h("td", {}, typeof row.cost === "number" ? String(row.cost) : "?",
      row.child ? h("div", { class: "muted small", text: t("route.cost_child") }) : null))));
}

/** Whose table a hop value comes from: "Plug 1's table", "Plug 1's “LQI out”", or "" without a holder. */
const sourceText = (c, name, t) => (c && c.holder ? t(c.source === "neighbours" ? "route.source.neighbours" : "route.source.lqi_out",
  { name: name(c.holder) }) : "");

/** The route card's summary: hop count and path cost of a complete way there, or that its cost is unknown; null
 *  where the way there is incomplete. */
function routeSummary(r, t) {
  const hopCount = r.there.hops.length;
  return !r.there.complete ? null : r.there.cost === null ? t("details.route_unknown_cost")
    : t(hopCount === 1 ? "details.route_summary_one" : "details.route_summary", { hops: hopCount, cost: r.there.cost });
}

/** What a hop's receiver hears as one value text: "−75 dBm · LQI 3", "– dBm" without RSSI, "?" without either. */
function hopValue(c) {
  if (!c || (c.lqi === null && c.rssi === null)) return "?";
  const rssi = typeof c.rssi === "number" ? `${String(c.rssi).replace("-", "−")} dBm` : "– dBm";
  return `${rssi} · LQI ${c.lqi ?? "?"}`;
}

/** The route card's hop list (#22, routeRows): one block per hop, the number and "A → B" with the cost in the
 *  first line, then a line for each direction that exists: its label, what the receiver hears (amber when old, derived tagged) and the
 *  table it comes from; the weakest hop of a direction marked at the left edge of that line. Null without rows. */
export function routeList(rows, name, t) {
  // Spaces between the parts (ignored by flex and grid) keep the text readable for assistive technology
  // ("there −87 dBm · LQI 2 Plug 1's table").
  const line = (label, c, weak, derived) => (c ? h("div", { class: weak ? "hop-line weak" : "hop-line" },
    h("span", { class: "muted", text: t(label) }), " ",
    h("div", { class: c.old ? "warn-text" : "" },
      h("span", { class: "nowrap", text: hopValue(c) }),
      derived ? h("span", { class: "tag", text: ` ${t("details.route_derived")}` }) : null,
      c.holder ? h("span", { class: "muted small", text: ` ${sourceText(c, name, t)}` }) : null)) : null);
  const cost = (row) => h("span", { class: "hop-cost" },
    h("span", { class: "nowrap", text: t("details.route_cost", { cost: typeof row.cost === "number" ? String(row.cost) : "?" }) }),
    row.child ? h("span", { class: "muted small", text: ` · ${t("route.cost_child")}` }) : null);
  return rows.length ? h("ol", { class: "route-hops", role: "list" }, ...rows.map((row) => h("li", {},
    h("div", { class: "hop-head" },
      row.n === null ? null : h("strong", { text: String(row.n) }), " ",
      h("span", { class: "hop-names", text: `${name(row.from)} → ${name(row.to)}` }), " ",
      cost(row)),
    line("details.route_label_there", row.there, row.weakThere, false),
    line("details.route_label_back", row.back, row.weakBack, row.backDerived)))) : null;
}

/** The route card's lines: the way there and back by name, and where and why a way stops. */
function routeLines(r, name, t) {
  const way = (hops) => hops.length ? [hops[0].from, ...hops.map((x) => x.to)].map(name).join(" → ") : "";
  const lines = [];
  if (r.there.hops.length) lines.push(t("details.route_there", { list: way(r.there.hops) }));
  if (r.back && r.back.hops.length) lines.push(t("details.route_back", { list: way(r.back.hops) }));
  const stop = stopLine(r, name, t);
  if (stop) lines.push(stop);
  return lines;
}

/** Where and why a way of the route stops ("The route stops at X: …", "No route: …"), or null where nothing stops. */
function stopLine(r, name, t) {
  const reason = (code) => t(`route.reason.${code}`);
  if (!r.there.complete) {
    return r.there.hops.length ? t("details.route_stops", { name: name(r.there.at), reason: reason(r.there.reason) })
      : t("details.route_none", { reason: reason(r.there.reason) });
  }
  return r.back && !r.back.complete && r.back.reason !== "there_incomplete"
    ? t("details.route_stops", { name: name(r.back.at), reason: reason(r.back.reason) }) : null;
}

/** The route's source line: one span per table the values come from (routeHolders) with when the Matter server
 *  read it, amber where it may be old, and a tooltip; null without tables. */
function sourceLine({ tables, holders, now }, name, t) {
  const holderName = (x) => (x.both ? `${name(x.id)} (${t(`details.route_table_${x.table}`)})` : name(x.id));
  const minutes = Math.round((tables.observeMs ?? 600000) / 60000);
  const checked = tables.readAt === null ? "?" : t.when(tables.readAt);
  // One span per table, each with its own tooltip: an interval (C) or only an upper bound (D).
  const holderSpan = (x) => {
    if (!x.table) return h("span", { text: t("details.route_holder_unknown", { name: name(x.id) }) });
    if (!x.times) return h("span", { text: t("details.route_holder_no_time", { name: holderName(x) }) });
    const tip = x.times.lo === null
      ? t("details.route_read_tip_unknown", { to: t.when(x.times.hi) })
      : t("details.route_read_tip", { from: t.when(x.times.lo), to: t.when(x.times.hi), minutes, check: checked });
    return h("span", { class: mayBeOld(x.times, now) ? "warn-text" : "", title: tip,
      text: `${holderName(x)} ${readText(x.times, now, t)}` });
  };
  return holders.length ? h("p", { class: "small muted" }, t("details.route_source"),
    ...holders.flatMap((x, k) => [k ? " · " : " ", holderSpan(x)])) : null;
}
