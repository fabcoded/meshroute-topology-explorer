// SPDX-License-Identifier: MIT
// Details of a device in a Thread network (spec 3.2, 9.2): Thread data has no signature and no clusters, so instead
// of the three sub-tabs one stack of cards: the head (name, type · role · vendor model, the state), the route to the
// default border router (hop list there and back, path cost, weakest hop, source and age of the tables; routes.js),
// the neighbours with the reception in both directions (RSSI in dBm and link quality 0-3, each measured by its
// receiver), parent or children, the findings, and the Thread facts (role, extended address, RLOC16, Matter node id).
// Names are set as text. Runs in the browser; the rows are pure (threadNeighbourRows, routeRows) and tested in Node.
import { h } from "../../ui/dom.js";
import { findingText } from "./findings.js";
import { roleText } from "../../ui/format.js";
import { historyButton } from "../../ui/history-links.js";
import { unknownGlyph } from "../unknown-reason.js";
import { markedWeak } from "./routes.js";

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

const card = (title, ...children) => h("section", { class: "card" }, title ? h("h3", { class: "card-title", text: title }) : null,
  ...children);

/** Fill `container` for a Thread device. ctx: the Details context of panel.js (network, t, id, onSelect, onFindings). */
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
  const head = h("div", { class: "details-head" }, h("div", { class: "details-title" }, h("h2", { class: "device-name", text: d.label }),
    historyButton(ctx, d.id)), h("p", { class: "muted", text: line }));
  if (!d.available) head.append(h("p", { class: "warn-text", text: t("details.thread_stale") }));
  if (!d.availabilityKnown) head.append(h("p", { class: "muted small", text: t("details.thread_availability_unknown") }));
  // #20: a border router only Home Assistant's Thread integration lists, and the preferred one.
  if (d.inTopology === false) head.append(h("p", { class: "muted small", text: t("details.thread_br_unheard") }));
  if (d.preferred) head.append(h("p", { class: "muted small", text: t("details.thread_br_preferred") }));
  container.append(head);
  const route = routeCard(ctx, d, name);
  if (route) container.append(route);

  const link = (id) => h("button", { type: "button", class: "link", text: name(id), on: { click: () => ctx.onSelect(id) } });
  const rows = threadNeighbourRows(network, d.id);
  const list = rows.length ? h("ul", { class: "plain" }, rows.map((r) => h("li", {},
    h("div", {}, link(r.id), r.parent ? ` · ${t("lane.parent")}` : r.child ? ` · ${t("role.end device")}` : ""),
    h("div", { class: "muted small", text: t("details.thread_hears", { name: name(r.id), value: threadReception(r.hears) }) }),
    h("div", { class: "muted small", text: t("details.thread_heard_by", { name: name(r.id), value: threadReception(r.heardBy) }) }))))
    : h("p", { class: "muted", text: t("details.thread_none") });
  container.append(card(t("details.thread_title"), h("p", { class: "muted small", text: t("details.thread_note") }), list));

  const findings = (network.findings || []).filter((f) => f.device === d.id);
  if (findings.length) {
    container.append(card(t("tab.findings"), ...findings.map((f) => {
      const { title, lines } = findingText(f, t, name);
      return h("div", {}, h("strong", { text: title }), ...lines.map((l) => h("p", { class: "muted small", text: l })));
    })));
  }

  const hex = (n) => (typeof n === "number" ? `0x${n.toString(16).toUpperCase().padStart(4, "0")}` : t("details.thread_unknown"));
  container.append(card(t("details.tab_entity"), h("ul", { class: "plain" },
    h("li", { text: t("details.thread_role", { role: d.threadRole || "?" }) }),
    h("li", { text: t("details.thread_ext", { value: d.extAddress || "?" }) }),
    h("li", { text: t("details.thread_rloc", { value: hex(d.rloc16) }) }),
    d.nodeId !== null ? h("li", { text: t("details.thread_node", { value: String(d.nodeId) }) }) : null)));
}

/** The route card (board M38 section 2): the route to the default border router, its hops there and back with what
 *  each receiver hears and the table it comes from, the cost as each sender counts it, the weakest hop per
 *  direction, a derived hop's note, and one line with the source and since when Meshroute saw each table unchanged
 *  (amber over 4 hours). Null for a border router and where the network has no border router; without the Matter
 *  cache's tables the reason they could not be read. */
function routeCard(ctx, d, name) {
  const { network, t } = ctx;
  if (!network.routing) {
    return network.routingProblem
      ? card(t("details.route_title", { name: t("role.border router") }),
        h("p", { class: "muted small", text: t("details.route_problem", { message: network.routingProblem }) }))
      : null;
  }
  const r = network.routing.defaultRoute(d.id);
  if (!r) return null;
  const now = ctx.now ?? Date.now();
  const tables = network.routing.tables;
  const rows = routeRows(tables, r, now);
  const table = routeTable(rows, name, t);
  const summary = routeSummary(r, t);
  const lines = routeLines(r, name, t);
  const weakest = (way_, k) => (k === null || k === undefined ? null : way_.hops[k]);
  const wt = weakest(r.there, r.there.weakest);
  const wb = r.back ? weakest(r.back, r.back.weakest) : null;
  const hopName = (x) => (x ? `${name(x.from)} → ${name(x.to)} (${hopValue(x)})` : "?");
  const holders = routeHolders(tables, rows);
  const old = holders.some((x) => x.table && mayBeOld(x.times, now));
  const derived = [...r.there.hops, ...(r.back ? r.back.hops : [])].find((x) => x.derived);
  return card(t("details.route_title", { name: name(r.to) }),
    summary ? h("p", { class: "muted small", text: summary }) : null,
    ...lines.map((text) => h("p", { class: "muted small", text })),
    table,
    wt || wb ? h("p", { class: "muted small", text: t("details.route_weakest", { there: hopName(wt), back: hopName(wb) }) }) : null,
    derived ? h("p", { class: "muted small", text: t("details.route_derived_note", { name: name(derived.to) }) }) : null,
    sourceLine(tables, holders, name, t, now),
    old ? h("p", { class: "small warn-text", text: t("details.route_old") }) : null);
}

/** The route card's summary: hop count and path cost of a complete way there, or that its cost is unknown; null
 *  where the way there is incomplete. */
function routeSummary(r, t) {
  const hopCount = r.there.hops.length;
  return !r.there.complete ? null : r.there.cost === null ? t("details.route_unknown_cost")
    : t(hopCount === 1 ? "details.route_summary_one" : "details.route_summary", { hops: hopCount, cost: r.there.cost });
}

/** What a hop's receiver hears as one cell text: "−75 dBm · LQI 3", "– dBm" without RSSI, "?" without either. */
function hopValue(c) {
  if (!c || (c.lqi === null && c.rssi === null)) return "?";
  const rssi = typeof c.rssi === "number" ? `${String(c.rssi).replace("-", "−")} dBm` : "– dBm";
  return `${rssi} · LQI ${c.lqi ?? "?"}`;
}

/** The route card's hop table (routeRows): number, hop, there and back with the weakest and old values marked, a
 *  derived hop tagged and the source table below each value, and the cost; null without rows. */
function routeTable(rows, name, t) {
  const sourceText = (c) => (c && c.holder ? t(c.source === "neighbours" ? "route.source.neighbours" : "route.source.lqi_out",
    { name: name(c.holder) }) : "");
  const td = (c, weak, derived) => h("td", { class: [weak ? "weak" : "", c && c.old ? "warn-text" : ""].filter(Boolean).join(" ") },
    h("span", { class: "nowrap", text: hopValue(c) }),
    derived ? h("span", { class: "tag", text: ` ${t("details.route_derived")}` }) : null,
    c && c.holder ? h("div", { class: "muted small", text: sourceText(c) }) : null);
  return rows.length ? h("table", { class: "route-table" },
    h("tr", {}, ...["#", t("details.route_head_hop"), t("details.route_head_there"), t("details.route_head_back"),
      t("details.route_head_cost")].map((text) => h("th", { text }))),
    ...rows.map((row) => h("tr", {},
      h("td", { text: row.n === null ? "" : String(row.n) }),
      h("td", { text: `${name(row.from)} → ${name(row.to)}` }),
      td(row.there, row.weakThere, false),
      td(row.back, row.weakBack, row.backDerived),
      h("td", {}, typeof row.cost === "number" ? String(row.cost) : "?",
        row.child ? h("div", { class: "muted small", text: t("route.cost_child") }) : null)))) : null;
}

/** The route card's lines: the way there and back by name, and where and why a way stops. */
function routeLines(r, name, t) {
  const reason = (code) => t(`route.reason.${code}`);
  const way = (hops) => hops.length ? [hops[0].from, ...hops.map((x) => x.to)].map(name).join(" → ") : "";
  const lines = [];
  if (r.there.hops.length) lines.push(t("details.route_there", { list: way(r.there.hops) }));
  if (r.back && r.back.hops.length) lines.push(t("details.route_back", { list: way(r.back.hops) }));
  if (!r.there.complete) {
    lines.push(r.there.hops.length ? t("details.route_stops", { name: name(r.there.at), reason: reason(r.there.reason) })
      : t("details.route_none", { reason: reason(r.there.reason) }));
  } else if (r.back && !r.back.complete && r.back.reason !== "there_incomplete") {
    lines.push(t("details.route_stops", { name: name(r.back.at), reason: reason(r.back.reason) }));
  }
  return lines;
}

/** The route card's source line: one span per table the values come from (routeHolders) with when the Matter server
 *  read it, amber where it may be old, and a tooltip; null without tables. */
function sourceLine(tables, holders, name, t, now) {
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
