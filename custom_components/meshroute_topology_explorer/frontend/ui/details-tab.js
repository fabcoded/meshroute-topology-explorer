// SPDX-License-Identifier: MIT
// The Details tab (spec 9.2): everything the model knows about the selected device as text, so every value on the
// canvas also exists as text (9.3). Other devices appear as buttons that select them. Raw ZHA tables only in debug
// mode (9.1). Runs in the browser; the data comes from details.js.
import { h, icon } from "./dom.js";
import { detailsOf } from "./details.js";
import { findingText } from "./finding-text.js";
import { lqiText, rankText, receptionText, roleText, percent } from "./format.js";
import { formatNwk } from "../model/parse.js";
import { rawText, RAW_COLUMNS } from "./raw-values.js";

/** Home Assistant's device page. Path: the config panel's devices section (/config/devices) with the "device" route
 *  of home-assistant/frontend src/panels/config/devices/ha-config-devices.ts, which reads the id from the rest of the
 *  path. */
export const devicePagePath = (registryId) => `/config/devices/device/${encodeURIComponent(registryId)}`;

/** In-app navigation as Home Assistant's frontend does it (home-assistant/frontend src/common/navigate.ts): push the
 *  path onto the history, then fire "location-changed" on the window; the app's router listens for it. A plain link
 *  would reload the whole frontend. */
export function navigate(path) {
  history.pushState(null, "", path);
  window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
}

/** Fill `container` with the details of `id`. ctx: { network, t, debug, raw (Map id -> zha/devices entry),
 *  observedSince (formatted time this device's table was first seen as it is now, or null), pinned
 *  (boolean), onSelect(id), onRelease(id) }. */
export function renderDetails(container, ctx) {
  const { network, t } = ctx;
  container.replaceChildren();
  const info = ctx.id ? detailsOf(network, ctx.id) : null;
  if (!info) {
    container.append(h("p", { class: "empty", text: t("details.empty") }));
    return;
  }
  const d = info.device;
  const name = (id) => (network.devices.find((x) => x.id === id) || { label: id }).label;
  const deviceButton = (dev, extra) => h("button", { type: "button", class: "link", on: { click: () => ctx.onSelect(dev.id) } },
    dev.label, extra ? h("span", { class: "muted", text: ` (${extra})` }) : null);

  const head = h("div", { class: "details-head" },
    h("h2", { class: "device-name", text: d.label }),
    h("p", { class: "muted", text: `${roleText(d.role, t)} · ${d.available ? receptionText(d.rating, t) : t("details.unavailable_since", { time: t.time(d.lastSeen) })}` }));
  const actions = h("div", { class: "actions" });
  if (d.registryId) {
    const path = devicePagePath(d.registryId);
    actions.append(h("a", { class: "button", href: path, on: { click: (e) => {
      // Ordinary clicks stay in the app; modified clicks (new tab, new window) keep the browser's behaviour.
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      navigate(path);
    } } }, icon("link", 18), t("details.open_ha")));
  }
  if (ctx.pinned) {
    actions.append(h("span", { class: "muted", text: t("details.pinned") }),
      h("button", { type: "button", class: "button", text: t("details.release_pin"), on: { click: () => ctx.onRelease(d.id) } }));
  }
  container.append(head);
  if (actions.childNodes.length) container.append(actions);

  // Facts, in the order of spec 9.2.
  const rows = [];
  const row = (label, ...value) => rows.push(h("dt", { text: label }), h("dd", {}, ...value));
  if (d.vendor) row(t("details.vendor"), d.vendor);
  if (d.model) row(t("details.model"), d.model);
  row(t("details.ieee"), h("span", { class: "mono", text: d.id }));
  row(t("details.nwk"), h("span", { class: "mono", text: d.nwk === null ? "?" : `${formatNwk(d.nwk)} (${d.nwk})` }));
  if (d.area) row(t("details.area"), d.area);
  row(t("details.role"), roleText(d.role, t));
  if (d.powerSource) row(t("details.power"), rawText("power", d.powerSource, t, { debug: ctx.debug }));
  row(t("details.state"), d.available ? rawText("available", true, t, { debug: ctx.debug })
    : t("details.unavailable_since", { time: t.time(d.lastSeen) }) + (ctx.debug ? " (false)" : ""));
  if (d.available && d.lastSeen) {
    row(t("details.last_seen"), d.role === "router" ? t("details.last_seen_router", { time: t.time(d.lastSeen) }) : t.time(d.lastSeen));
  }
  if (d.role === "router" || d.role === "coordinator") {
    row(t("details.table"), d.hasTable ? t("details.table_yes") : t("details.table_no"));
  }
  if (d.role === "end device") {
    if (info.parent) {
      const notes = [];
      if (!info.parent.available) notes.push(t("details.parent_unavailable"));
      if (info.parentFromStaleTable) notes.push(t("details.parent_stale"));
      row(t("details.parent"), deviceButton(info.parent, notes.join(", ")));
      row(t("details.parent_lqi"), lqiText(info.parentLqi, t));
    } else {
      row(t("details.parent"), t("details.parent_none"));
    }
    if (info.possiblyStaleParents.length) {
      row(t("details.possibly_stale"), ...joinButtons(info.possiblyStaleParents.map((p) => deviceButton(p))));
    }
  } else if (d.role === "router" || d.role === "coordinator") {
    if (info.children.length) row(t("details.children"), ...joinButtons(info.children.map((c) => deviceButton(c))));
    row(t("details.relay_load"), t("details.relay_load_value", { count: info.relayLoad }));
  }
  // The label says "Reception"; the value is the rank alone (spec 5.4: best rating among the readings of it).
  row(t("details.reception"), typeof info.reception === "number" ? t("rank.value", { pct: percent(info.reception) }) : t("rank.none"));
  container.append(h("dl", { class: "facts" }, rows));

  // Findings with their evidence.
  container.append(h("h3", { text: t("details.findings", { count: info.findings.length }) }));
  if (info.findings.length) {
    container.append(h("ul", { class: "finding-list" }, info.findings.map((f) => {
      const { title, lines } = findingText(f, t, name);
      return h("li", {}, h("strong", { text: title }), lines.map((line) => h("div", { class: "evidence", text: line })));
    })));
  } else {
    container.append(h("p", { class: "muted", text: t("details.no_findings") }));
  }

  // Readings in both directions. "Heard by": others' readings of this device, ranked on each reporter's scale.
  // "Hears": this device's own readings, ranked on its scale.
  container.append(h("h3", { text: t("details.heard_by", { count: info.heardBy.length }) }));
  if (info.heardBy.length) container.append(h("p", { class: "muted small", text: t("details.heard_by_note") }));
  container.append(readingTable(info.heardBy, t, deviceButton));
  container.append(h("h3", { text: t("details.hears", { count: info.hears.length }) }));
  container.append(readingTable(info.hears, t, deviceButton));

  // Own routing entries; collapsed when long (the coordinator lists one per router).
  const routes = h("details", { class: "routes", open: info.routes.length <= 8 },
    h("summary", { text: t("details.routes", { count: info.routes.length }) }));
  if (info.routes.length) {
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
  } else {
    routes.append(h("p", { class: "muted", text: t("details.no_routes") }));
  }
  container.append(routes);

  if (ctx.debug) {
    // Per table: since when it was observed as it is now (spec 9.1, debug), with the caveat of spec 6.
    if (d.hasTable) {
      container.append(h("h3", { text: ctx.observedSince ? t("details.observed", { time: ctx.observedSince }) : t("details.observed_none") }),
        h("p", { class: "muted small", text: t("status.unchanged_note") }));
    }
    container.append(rawTables(ctx.raw && ctx.raw.get(d.id), t));
  }
}

/** Buttons separated by commas, for inline lists of devices. */
function joinButtons(buttons) {
  return buttons.flatMap((b, i) => (i ? [", ", b] : [b]));
}

function readingTable(rows, t, deviceButton) {
  if (!rows.length) return h("p", { class: "muted", text: t("details.no_readings") });
  return h("table", { class: "readings" },
    h("thead", {}, h("tr", {}, h("th", { scope: "col", text: t("details.col_device") }),
      h("th", { scope: "col", class: "num", text: t("details.col_lqi") }), h("th", { scope: "col", text: t("details.col_rank") }))),
    h("tbody", {}, rows.map((r) => h("tr", {},
      h("td", {}, deviceButton(r.device)),
      h("td", { class: "num", text: lqiText(r.lqi, t) }),
      h("td", { text: rankText(r.rating, r.reporter.label, t) + (r.pool === "vendor" ? ` ${t("rank.vendor")}` : "") })))));
}

/** A raw table cell: enum values in words with the raw text beside them, everything else as ZHA sent it. */
function cell(column, value, t) {
  if (value === undefined || value === null) return "";
  return RAW_COLUMNS[column] ? rawText(RAW_COLUMNS[column], value, t, { debug: true }) : String(value);
}

/** The device's neighbour and routing tables as zha/devices delivered them (debug mode). Columns are the keys with
 *  plain values; enum values carry their translation next to the raw text. */
function rawTables(raw, t) {
  const box = h("div", { class: "raw" });
  for (const [key, label] of [["neighbors", "details.raw_neighbours"], ["routes", "details.raw_routes"]]) {
    const entries = raw && Array.isArray(raw[key]) ? raw[key].filter((e) => e && typeof e === "object") : [];
    const section = h("details", { open: true }, h("summary", { text: t(label, { count: entries.length }) }));
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
