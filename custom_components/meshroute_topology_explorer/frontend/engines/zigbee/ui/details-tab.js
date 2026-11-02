// SPDX-License-Identifier: MIT
// The Details tab (spec 9.2; boards M4, M8, M9): the device's name and one
// line "type · role · vendor model", then a segmented control with three sub-tabs, each a stack of cards:
// - Communication: the path with the coordinator there and back with the reception at every hop (the coordinator: all
//   its routes), in the view "table" its routing-table walks per destination, in the view "all" its theoretical paths
//   to every other device (spec 5.7), parent or
//   children, findings, who hears it and whom it hears with RX and the rank relative to the reporter, its tables and
//   load; raw tables in debug mode;
// - Entity: the node card (badges for logical type, power, receiver when idle, frequency band, stack revision; then
//   addresses, manufacturer with code, model, firmware, quirk, buffers, last heard), the ways into Home Assistant and
//   the device's entities, each opening Home Assistant's more-info dialog;
// - Cluster: the signature's clusters per endpoint, a row opens the cluster's details (cluster-dialog.js).
// Every value on the canvas also exists here as text (9.3). Names are text, never HTML. Runs in the browser; the data
// comes from details.js, model/signature.js and model/zcl.js.
import { h } from "../../../ui/dom.js";
import { detailsOf, howText, pathParts, stopText } from "./details.js";
import { unknownEnd } from "../node-paths.js";
import { findingText } from "./finding-text.js";
import { lqiText, percent, rankTooltip, roleText } from "../../../ui/format.js";
import { formatNwk } from "../../../model/parse.js";
import { clusterTable, nodeCard } from "../signature.js";
import { clusterName, deviceTypeName, profileName } from "../zcl.js";
import { rawText, RAW_COLUMNS } from "./raw-values.js";
import { deviceLinks, inApp, moreInfo } from "../../../ui/ha-links.js";

/** The sub-tabs, in the board's order. */
export const DETAIL_TABS = Object.freeze(["communication", "entity", "cluster"]);
/** Readings listed before "… all" (board M4). */
const TOP_READINGS = 5;
/** "All paths" collapses above this many lines (spec 9.2). */
const PATHS_OPEN = 12;
/** Below this rating a reading is in the weakest tenth of what its reporter hears (spec 5.4). */
const WEAKEST = 0.1;

/** Fill `container` with the details of `id`. ctx: { network, t, id, debug, raw (Map id -> zha/devices entry),
 *  nodeView ("coordinator" | "table" | "all"), returnRoutes (view "table"), sourceRoute ("off" | "assume"), sub (one of DETAIL_TABS), observedSince
 *  (formatted time the table was first seen as it is now, or null), pinned, idPrefix, onSub(sub, { focus }),
 *  onSelect(id), onRelease(id), onCluster({ endpoint, profile, cluster, direction }, opener), onFindings(opener) (show
 *  the Findings tab) }. */
export function renderDetails(container, ctx) {
  const { network, t } = ctx;
  container.replaceChildren();
  const info = ctx.id ? detailsOf(network, ctx.id, ctx.nodeView, { sourceRoute: ctx.sourceRoute,
    returnRoutes: ctx.returnRoutes }) : null;
  if (!info) {
    container.append(h("p", { class: "empty", text: t("details.empty") }));
    return;
  }
  const d = info.device;
  const sub = DETAIL_TABS.includes(ctx.sub) ? ctx.sub : DETAIL_TABS[0];
  const prefix = ctx.idPrefix || "mte-details";
  const name = (id) => (network.devices.find((x) => x.id === id) || { label: id }).label;

  // Head: name, then "type · role · vendor model" (board M4); the state when it is down.
  const kind = d.kind && d.kind !== "unknown" ? t(`kind_short.${d.kind}`) : null;
  const product = [d.vendor, d.model].filter(Boolean).join(" ");
  const line = [kind, roleText(d.role, t), product].filter(Boolean).join(" · ");
  const head = h("div", { class: "details-head" }, h("h2", { class: "device-name", text: d.label }),
    h("p", { class: "muted", text: line }));
  if (!d.available) head.append(h("p", { class: "warn-text", text: t("details.unavailable_since", { time: t.time(d.lastSeen) }) }));
  if (ctx.pinned) {
    head.append(h("div", { class: "actions" }, h("span", { class: "muted", text: t("details.pinned") }),
      h("button", { type: "button", class: "button", text: t("details.release_pin"), on: { click: () => ctx.onRelease(d.id) } })));
  }
  container.append(head);

  // The segmented control: WAI-ARIA tabs with automatic activation (arrows, Home and End move and show).
  const tabs = DETAIL_TABS.map((key) => h("button", { type: "button", role: "tab", class: "segment", id: `${prefix}-tab-${key}`,
    "aria-selected": String(key === sub), "aria-controls": `${prefix}-panel`, tabIndex: key === sub ? 0 : -1,
    text: t(`details.tab_${key}`), on: { click: () => ctx.onSub(key, { focus: false }) } }));
  const list = h("div", { class: "segmented", role: "tablist", "aria-label": t("details.tabs_label"),
    on: { keydown: (e) => {
      const at = DETAIL_TABS.indexOf(sub);
      const next = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: DETAIL_TABS.length - 1 }[e.key];
      if (next === undefined) return;
      e.preventDefault();
      ctx.onSub(DETAIL_TABS[(next + DETAIL_TABS.length) % DETAIL_TABS.length], { focus: true });
    } } }, tabs);
  const panel = h("div", { class: "sub-panel", role: "tabpanel", id: `${prefix}-panel`, "aria-labelledby": `${prefix}-tab-${sub}` });
  container.append(list, panel);
  const raw = ctx.raw ? ctx.raw.get(d.id) : null;
  if (sub === "communication") communication(panel, info, ctx, name);
  else if (sub === "entity") entity(panel, d, raw, ctx, network.capabilities);
  else clusters(panel, d, raw, ctx);
}

/** A card: a bordered box with a small bold heading (board M4). */
function card(title, ...children) {
  return h("section", { class: "card" }, title ? h("h3", { class: "card-title", text: title }) : null, ...children);
}

/** A device as a button that selects it, with an optional muted note. */
function deviceButton(ctx, dev, note) {
  return h("span", { class: "device-ref" }, h("button", { type: "button", class: "link", text: dev.label,
    on: { click: () => ctx.onSelect(dev.id) } }), note ? h("span", { class: "muted", text: ` · ${note}` }) : null);
}

// ---- Communication ----------------------------------------------------------------------------------------------

function communication(panel, info, ctx, name) {
  const { t } = ctx;
  const d = info.device;
  // The coordinator in the view "routing table" has only that card.
  if (!(info.table && info.device.role === "coordinator")) panel.append(pathsCard(info.paths, ctx, name, info.record));
  if (info.table) panel.append(tableCard(info.table, ctx, name));
  if (info.theory.length) panel.append(theoryCard(info.theory, ctx, name));

  if (d.role === "end device") {
    const rows = [];
    if (info.parent) {
      const notes = [];
      if (!info.parent.available) notes.push(t("details.parent_unavailable"));
      if (info.parentFromStaleTable) notes.push(t("details.parent_stale"));
      rows.push(h("div", {}, deviceButton(ctx, info.parent, notes.join(", "))),
        h("div", { class: "muted" }, `${t("details.parent_lqi")}: `, lqiText(info.parentLqi, t)));
    } else {
      rows.push(h("div", { class: "muted", text: t("details.parent_none") }));
    }
    if (info.possiblyStaleParents.length) {
      rows.push(h("div", { class: "muted" }, `${t("details.possibly_stale")}: `,
        joinNodes(info.possiblyStaleParents.map((p) => deviceButton(ctx, p)))));
    }
    rows.push(h("div", { class: "muted", text: `${t("details.sleepy")}: ${t(d.sleepy === true ? "details.sleepy_yes"
      : d.sleepy === false ? "details.sleepy_no" : "details.sleepy_unknown")}` }));
    panel.append(card(t("details.parent"), ...rows));
  } else if (info.children.length) {
    panel.append(card(t("details.children_title"),
      ...info.children.map((c) => h("div", {}, deviceButton(ctx, c, c.model && c.model !== c.label ? c.model : null)))));
  }

  // Findings only when the device has some, with a way to the Findings
  // tab, where they stand among the network's; nothing when it has none.
  if (info.findings.length) {
    panel.append(card(t("details.findings", { count: info.findings.length }), h("ul", { class: "finding-list" },
      info.findings.map((f) => {
        const { title, lines } = findingText(f, t, name);
        return h("li", {}, h("strong", { text: title }), lines.map((l) => h("div", { class: "evidence", text: l })));
      })), ctx.onFindings ? h("button", { type: "button", class: "link small findings-jump",
      id: `${ctx.idPrefix || "mte-details"}-findings`, text: t("details.findings_jump"),
      on: { click: (e) => ctx.onFindings(e.currentTarget) } }) : null));
  }

  panel.append(heardCard(info, ctx));
  panel.append(tablesCard(info, ctx));

  if (ctx.debug) {
    const extra = [];
    if (d.hasTable) {
      extra.push(h("p", { text: ctx.observedSince ? t("details.observed", { time: ctx.observedSince }) : t("details.observed_none") }),
        h("p", { class: "muted small", text: t("status.unchanged_note") }));
    }
    panel.append(card(t("details.raw_title"), ...extra, rawTables(ctx.raw && ctx.raw.get(d.id), t)));
  }
}

/** The path card (board M4): "Communication path with the coordinator" with the lines there and back; for the
 *  coordinator, whose paths are its routes, "All paths" collapsed when long. Each hop names the device that hears it
 *  and the reception there, the value in bold; an assumed return path (source route) says so in its prefix and in a
 *  note, and so does one from zigpy's route record (stage "zigpy", `record` of detailsOf), whose note names the radio
 *  library and that the record has no time; a record that takes another way than a complete measured down path is
 *  one line, not drawn. A device's theoretical paths have their own card
 *  (theoryCard). */
function pathsCard(all_, ctx, name, record = null) {
  const t = ctx.t;
  const own = all_.filter((p) => p.kind === "up" || p.kind === "down");
  const paths = own.length ? own : all_; // the coordinator has no up or down path: its routes are its paths
  const all = !own.length && paths.length > 0;
  const lines = paths.map((p) => {
    const { prefix, steps, tail } = pathParts(p, t, name);
    const nodes = [`${prefix}: `];
    steps.forEach((s, i) => {
      if (i) nodes.push(" → ");
      nodes.push(s.name);
      if (s.rx !== null) nodes.push(" · ", h("span", { class: "rx" }, h("small", { text: `${t("details.rx")} ` }), h("b", { text: s.rx })));
      if (s.basis) nodes.push(h("span", { class: "how", text: ` (${s.basis})` }));
    });
    if (tail) nodes.push(steps.length ? " → " : "", h("span", { class: "unknown", text: tail }));
    return h("div", { class: `path-line${p.assumed ? " assumed" : ""}` }, nodes);
  });
  const body = lines.length ? lines : [h("div", { class: "muted", text: t("details.paths_none") })];
  const notes = [h("p", { class: "muted small", text: t("details.paths_note") })];
  if (record && record.differs) {
    const text = record.differs.length ? t("details.path_record_differs", { via: record.differs.map(name).join(" → ") })
      : t("details.path_record_differs_direct");
    lines.push(h("div", { class: "path-line muted", text }));
  }
  if (paths.some((p) => p.assumed)) notes.push(h("p", { class: "muted small", text: t("details.paths_assumed_note") }));
  if (paths.some((p) => p.recorded)) {
    notes.push(h("p", { class: "muted small", text: t("details.paths_recorded_note", { radio: (record && record.radio) || "?" }) }));
  }
  if (!all) return card(t("details.paths_coordinator"), ...body, ...notes);
  return card(null, h("details", { class: "card-details", open: paths.length <= PATHS_OPEN },
    h("summary", { class: "card-title", text: t("details.paths_all", { count: paths.length }) }), ...body, ...notes));
}

/** "Paths to other devices (theoretical)" (spec 5.7, 9.2): a row per other device, the shortest first,
 *  with the number of hops there (→) and back (←); a row opens to both ways, every hop with the
 *  reception at its hearer and how it is taken (table, neighbour, route discovery, parent, child), a discovery with its
 *  path cost. Collapsed above PATHS_OPEN rows, like "All paths". */
function theoryCard(rows, ctx, name) {
  const t = ctx.t;
  // Per direction the hop count only: a "weakest RX" would mix a missing value with a low one and compare receivers
  // on different scales (review 1.4b); the values are in the opened row, hop by hop.
  const way = (p, arrow) => h("span", { class: "theory-way", text: p ? `${arrow} ${p.complete ? p.hops.length : "?"}` : "" });
  const line = (p, label) => {
    const { steps, tail } = pathParts(p, t, name);
    const nodes = [h("span", { class: "muted", text: `${label}: ` })];
    steps.forEach((s, i) => {
      if (i) nodes.push(" → ");
      nodes.push(s.name);
      if (s.rx !== null) nodes.push(" · ", h("span", { class: "rx" }, h("small", { text: `${t("details.rx")} ` }), h("b", { text: s.rx })));
      const notes = [s.how && howText(s.how, t), s.basis, s.noEntry && t(`details.no_entry_${s.noEntry.replace(/ /g, "_")}`)]
        .filter(Boolean);
      // A middle dot, not brackets: "Routensuche (berechnet)" carries its own.
      if (notes.length) nodes.push(h("span", { class: "how", text: ` · ${notes.join(", ")}` }));
    });
    if (tail) nodes.push(steps.length ? " → " : "", h("span", { class: "unknown", text: tail }));
    // The cost of the whole path, in a place of its own at the end of the row (not read as the last hop's).
    if (p.cost !== null && p.cost !== undefined) nodes.push(h("span", { class: "how theory-cost", text: t("details.theory_cost", { cost: p.cost }) }));
    return h("div", { class: "path-line theory-line" }, nodes);
  };
  const items = rows.map((r) => h("details", { class: "theory-row" },
    h("summary", {}, h("span", { class: "theory-name", text: name(r.id) }), way(r.out, "\u2192"), way(r.in, "\u2190")),
    r.out ? line(r.out, t("details.path_up")) : null, r.in ? line(r.in, t("details.path_down")) : null));
  return card(null, h("details", { class: "card-details theory", open: rows.length <= PATHS_OPEN },
    h("summary", { class: "card-title", text: t("details.theory_title", { count: rows.length }) }),
    h("p", { class: "muted small", text: t("details.theory_note") }),
    h("p", { class: "muted small", text: t("details.theory_head") }), ...items));
}

/** "Routing table" (spec 7.1, 9.2): a row per destination of the device's own
 *  usable entries with the hops there (→) and, with "Include return routes", back (←), "?" for a walk that stops; a
 *  row opens to the walks, every hop with the reception at its hearer and how it is taken, a gap named with the device
 *  it stopped at and why. The notes say what the view rests on and what it leaves out (zigpy's route records and
 *  assumed return paths are another basis), and that a return route missing from the tables is no verdict. */
function tableCard(table, ctx, name) {
  const t = ctx.t;
  const returns = ctx.returnRoutes === true;
  if (!table.rows.length) {
    return card(t("details.table_title", { count: 0 }), h("div", { class: "muted", text: t(`details.table_none_${table.none.replace(/ /g, "_")}`) }));
  }
  const way = (p, arrow) => h("span", { class: "theory-way", text: p ? `${arrow} ${p.complete ? p.hops.length : "?"}` : "" });
  const line = (p, label) => {
    const { steps } = pathParts(p, t, name);
    const nodes = [h("span", { class: "muted", text: `${label}: ` })];
    steps.forEach((s, i) => {
      if (i) nodes.push(" → ");
      nodes.push(s.name);
      if (s.rx !== null) nodes.push(" · ", h("span", { class: "rx" }, h("small", { text: `${t("details.rx")} ` }), h("b", { text: s.rx })));
      const notes = [s.how && howText(s.how, t), s.basis].filter(Boolean);
      if (notes.length) nodes.push(h("span", { class: "how", text: ` · ${notes.join(", ")}` }));
    });
    // A gap names the device the walk stopped at: the tables hold nothing further from there.
    const gap = unknownEnd(p);
    if (gap) {
      nodes.push(steps.length ? " → " : "", h("span", { class: "unknown",
        text: t("details.table_gap", { name: name(gap.at), reason: stopText(p.reason, t) }) }));
    }
    return h("div", { class: "path-line theory-line" }, nodes);
  };
  const items = table.rows.map((r) => h("details", { class: "theory-row" },
    h("summary", {}, h("span", { class: "theory-name", text: name(r.id) }), way(r.out, "\u2192"), returns ? way(r.in, "\u2190") : null),
    r.out ? line(r.out, t("details.path_up")) : null, r.in ? line(r.in, t("details.path_down")) : null));
  const notes = [t("details.table_note"), returns ? t("details.table_returns_note") : t("details.table_returns_off"),
    t("details.table_basis")];
  return card(null, h("details", { class: "card-details theory", open: table.rows.length <= PATHS_OPEN },
    h("summary", { class: "card-title", text: t("details.table_title", { count: table.rows.length }) }),
    ...notes.map((text) => h("p", { class: "muted small", text })), ...items));
}

/** Reading rows: name, RX value (bold) and the rank on the reporter's scale, right-aligned (board M4). */
function readingRows(list, ctx) {
  const t = ctx.t;
  return h("div", { class: "reading-rows", role: "table" }, list.map((r) => {
    const rated = typeof r.rating === "number";
    const vendorPool = rated && r.pool === "vendor";
    const rank = rated ? t("rank.short", { pct: percent(r.rating) }) + (vendorPool ? ` \u00B7 ${t("rank.group")}` : "") : t("rank.none");
    const long = rankTooltip(r, t);
    return h("div", { class: `reading-row${rated && r.rating < WEAKEST ? " weak" : ""}`, role: "row", title: long },
      h("span", { role: "cell", class: "reading-name" }, h("button", { type: "button", class: "link", text: r.device.label,
        on: { click: () => ctx.onSelect(r.device.id) } })),
      h("span", { role: "cell", class: "reading-rx" }, h("small", { text: `${t("details.rx")} ` }), h("b", { text: lqiText(r.lqi, t) })),
      h("span", { role: "cell", class: "reading-rank", text: rank }));
  }));
}

/** "Heard by 18 · hears 25" (board M4): the reception, the best readings of the device, then behind "… all" the rest
 *  and what the device itself hears. */
function heardCard(info, ctx) {
  const t = ctx.t;
  const reception = typeof info.reception === "number" ? t("rank.value", { pct: percent(info.reception) }) : t("rank.none");
  const body = [h("div", { class: "muted small", text: `${t("details.reception")}: ${reception}` })];
  const top = info.heardBy.slice(0, TOP_READINGS);
  const rest = info.heardBy.slice(TOP_READINGS);
  body.push(top.length ? readingRows(top, ctx) : h("div", { class: "muted", text: t("details.no_readings") }));
  // Every rank is relative; the note names what it is relative to (the receiving device's own readings or its vendor group).
  if (top.length || info.hears.length) body.push(h("p", { class: "muted small", text: t("details.rank_note") }));
  if (rest.length || info.hears.length) {
    const more = h("details", { class: "more all-readings" },
      h("summary", { text: t("details.readings_all", { count: info.heardBy.length + info.hears.length }) }));
    if (rest.length) more.append(readingRows(rest, ctx));
    if (info.hears.length) more.append(h("h4", { text: t("details.hears", { count: info.hears.length }) }), readingRows(info.hears, ctx));
    body.push(more);
  }
  return card(t("details.heard_title", { by: info.heardBy.length, hears: info.hears.length }), ...body);
}

/** "Tables and load" (board M4): the neighbour table against the model's capacity, the routing table, the relay load;
 *  the routing entries behind a disclosure. */
function tablesCard(info, ctx) {
  const t = ctx.t;
  const d = info.device;
  const lines = [];
  if (d.role === "router" || d.role === "coordinator") {
    if (!d.hasTable) lines.push(h("div", { text: t("details.table_no") }));
    else if (d.tableCapacity) lines.push(h("div", { text: t("details.table_of", { n: d.tableSize, cap: d.tableCapacity }) }));
    else lines.push(h("div", { text: t("details.table_size", { n: d.tableSize }) }));
    lines.push(h("div", { text: t("details.routing_size", { count: info.routingEntries }) }),
      h("div", { text: t("details.relay_load_value", { count: info.relayLoad }) }));
  } else {
    lines.push(h("div", { class: "muted", text: t("details.tables_end_device") }));
  }
  if (info.routes.length) {
    const routes = h("details", { class: "more", open: info.routes.length <= 8 }, h("summary", { text: t("details.routes", { count: info.routes.length }) }));
    routes.append(h("ul", { class: "plain" }, info.routes.map((r) => {
      const text = r.direct ? t("details.route_direct", { destination: r.destination.label })
        : t("details.route_via", { destination: r.destination.label, next: r.nextHop.label });
      const notes = [];
      if (r.status.toLowerCase() !== "active") {
        notes.push(t("details.route_not_followed", { status: rawText("route_status", r.status, t, { debug: ctx.debug }) }));
      }
      if (r.stale) notes.push(t("details.route_stale"));
      return h("li", {}, text, notes.length ? h("span", { class: "muted", text: ` (${notes.join(", ")})` }) : null);
    })));
    lines.push(routes);
  }
  return card(t("details.tables_title"), ...lines);
}

/** Nodes separated by commas. */
function joinNodes(nodes) {
  return nodes.flatMap((b, i) => (i ? [", ", b] : [b]));
}

// ---- Entity -------------------------------------------------------------------------------------------------------

function entity(panel, d, raw, ctx, capabilities) {
  const t = ctx.t;
  const node = nodeCard(raw, d);
  const chips = [];
  const chip = (text) => chips.push(h("span", { class: "chip", text }));
  chip(roleText(node.logicalType || d.role, t));
  if (d.powerSource) chip(rawText("power", d.powerSource, t));
  const rx = node.mac ? node.mac.rxOnWhenIdle : d.sleepy === null ? null : !d.sleepy;
  if (rx !== null) chip(t(rx ? "node.rx_on" : "node.rx_off"));
  for (const band of node.bands) chip(t(`node.band_${band}`));
  if (node.revision !== null) chip(node.revision ? t("node.revision", { r: node.revision }) : t("node.revision_old"));

  const facts = [];
  const fact = (label, ...value) => facts.push(h("div", { class: "kv" }, h("span", { class: "kv-key", text: label }),
    h("span", { class: "kv-value" }, ...value)));
  const unknown = () => h("span", { class: "muted", text: t("node.unknown") });
  fact(t("details.ieee"), h("span", { class: "mono", text: d.id }));
  fact(t("details.nwk"), h("span", { class: "mono", text: d.nwk === null ? "?" : `${formatNwk(d.nwk)} (${d.nwk})` }));
  fact(t("details.vendor"), d.vendor || unknown(), node.manufacturerCode !== null ? ` · ${formatNwk(node.manufacturerCode)}` : "");
  fact(t("details.model"), d.model || unknown());
  fact(t("node.firmware"), node.firmware || unknown());
  fact(t("node.quirk"), node.quirk ? h("span", { class: "mono small", text: node.quirk }) : t("node.quirk_none"));
  if (node.bufferSize !== null) {
    const transfer = node.transferIn !== null && node.transferOut !== null && node.transferIn !== node.transferOut
      ? `${node.transferIn}/${node.transferOut}` : node.transferIn ?? node.transferOut;
    fact(t("node.buffer"), transfer === null ? t("node.bytes", { n: node.bufferSize })
      : t("node.buffer_value", { n: node.bufferSize, transfer }));
  }
  fact(t("node.last_heard"), node.lastSeen ? (d.role === "router" ? t("details.last_seen_router", { time: t.time(node.lastSeen) })
    : t.time(node.lastSeen)) : unknown());
  panel.append(card(t("node.title"), h("div", { class: "chips" }, chips), h("div", { class: "kv-list" }, facts)));

  // The ways into Home Assistant (board M8), as links that stay in the app.
  // The source's own page of the device (ZHA's), where the source has one; the panel hands its adapter's builder.
  const sourcePage = capabilities && capabilities.devicePage && ctx.devicePage ? ctx.devicePage(d, "signature") : null;
  const links = deviceLinks(d, sourcePage).map(({ key, path }) => h("a", { class: "pill", href: path, on: { click: inApp(path) } },
    key === "area" ? t("ha.area", { name: d.area || d.areaId }) : t(`ha.${key}`)));
  panel.append(card(t("ha.title"), links.length ? h("div", { class: "pills" }, links) : h("div", { class: "muted", text: t("ha.none") }),
    h("p", { class: "muted small", text: t("ha.note") })));

  const ids = d.entities || [];
  panel.append(card(t("ha.entities_title", { count: ids.length }), ids.length
    ? h("ul", { class: "plain entity-list" }, ids.map((id) => h("li", {}, h("button", { type: "button", class: "link mono",
      text: id, on: { click: (e) => moreInfo(e.currentTarget, id) } }))))
    : h("div", { class: "muted", text: t("ha.entities_none") })));
}

// ---- Cluster ------------------------------------------------------------------------------------------------------

function clusters(panel, d, raw, ctx) {
  const t = ctx.t;
  const table = clusterTable(raw && raw.signature);
  if (!table.length) {
    panel.append(h("p", { class: "muted", text: t("cluster.none") }));
    return;
  }
  const body = h("tbody");
  for (const ep of table) {
    const profile = profileName(ep.profile);
    const type = ep.profile !== null && ep.deviceType !== null ? deviceTypeName(ep.profile, ep.deviceType) : null;
    const head = [t("cluster.endpoint", { n: ep.endpoint }),
      ep.profile !== null ? `${profile || t("cluster.profile_unknown")} ${formatNwk(ep.profile)}` : null,
      ep.deviceType !== null ? `${type || t("cluster.type_unknown")} ${formatNwk(ep.deviceType)}` : null]
      .filter(Boolean).join(" · ");
    body.append(h("tr", { class: "ep-row" }, h("th", { colSpan: 3, scope: "colgroup", text: head })));
    for (const c of ep.clusters) {
      const open = (opener) => ctx.onCluster({ endpoint: ep.endpoint, profile: ep.profile, cluster: c.id, direction: c.direction }, opener);
      const label = c.manufacturerSpecific ? (d.vendor || t("cluster.vendor_unknown")) : clusterName(c.id) || t("cluster.unknown");
      const button = h("button", { type: "button", class: "row-button", on: { click: (e) => { e.stopPropagation(); open(e.currentTarget); } } },
        label, c.manufacturerSpecific ? h("span", { class: "tag", text: t("cluster.manufacturer") }) : null);
      body.append(h("tr", { class: "cluster-row", on: { click: () => open(button) } },
        h("td", {}, button), h("td", { class: "mono id", text: formatNwk(c.id) }),
        h("td", { text: t(c.direction === "in" ? "cluster.in" : "cluster.out") })));
    }
  }
  // The table stands on its own, not in a card (board M9).
  panel.append(h("section", { class: "cluster-section" }, h("table", { class: "cluster-table" }, h("thead", {}, h("tr", {},
    h("th", { scope: "col", text: t("cluster.col_cluster") }), h("th", { scope: "col", text: t("cluster.col_id") }),
    h("th", { scope: "col", text: t("cluster.col_direction") }))), body),
  h("p", { class: "muted small", text: t("cluster.legend") })));
  panel.append(h("p", { class: "muted small", text: t("cluster.source_note") }));
}

// ---- raw tables (debug) -------------------------------------------------------------------------------------------

/** A raw table cell: enum values in words with the raw text beside them, everything else as ZHA sent it. */
function cell(column, value, t) {
  if (value === undefined || value === null) return "";
  return RAW_COLUMNS[column] ? rawText(RAW_COLUMNS[column], value, t, { debug: true }) : String(value);
}

/** The device's neighbour and routing tables as zha/devices delivered them (debug mode). */
function rawTables(raw, t) {
  const box = h("div", { class: "raw" });
  for (const [key, label] of [["neighbors", "details.raw_neighbours"], ["routes", "details.raw_routes"]]) {
    const entries = raw && Array.isArray(raw[key]) ? raw[key].filter((e) => e && typeof e === "object") : [];
    const section = h("details", { class: "more", open: true }, h("summary", { text: t(label, { count: entries.length }) }));
    if (!entries.length) {
      section.append(h("p", { class: "muted", text: t("details.raw_empty") }));
    } else {
      const columns = [...new Set(entries.flatMap((e) => Object.keys(e).filter((k) => e[k] === null || typeof e[k] !== "object")))];
      section.append(h("div", { class: "scroll" }, h("table", { class: "raw-table" },
        h("thead", {}, h("tr", {}, columns.map((c) => h("th", { scope: "col", text: c })))),
        h("tbody", {}, entries.map((e) => h("tr", {}, columns.map((c) => h("td", { text: cell(c, e[c], t) }))))))));
    }
    box.append(section);
  }
  return box;
}
