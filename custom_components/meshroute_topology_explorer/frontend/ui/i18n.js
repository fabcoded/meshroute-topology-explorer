// SPDX-License-Identifier: MIT
// Texts of the panel (spec 10). The panel is English only: one flat table per part, merged into STRINGS. Dates and
// numbers keep following the user's locale (t.formatLocale). Placeholders are {name}; values are inserted as text,
// never as HTML. No DOM. The shared table is below; each engine and adapter holds its own words (engines/<type>/texts.js,
// adapters/<source>-texts.js), merged through the two registries.
import { ENGINES } from "../engines/index.js";
import { ADAPTERS } from "../adapters/index.js";
import { HISTORY_TEXTS } from "./history-texts.js";

/** The shared table. */
export const SHARED = Object.freeze({
  "header.sidebar": "Open sidebar",
  "header.findings_label": "Findings: {count}",
  "density.dense": "Dense",
  "density.medium": "Medium",
  "density.spread": "Wide",
  "density.custom": "Custom",
  "zoom.in": "Zoom in",
  "zoom.out": "Zoom out",
  "zoom.fit": "Fit",
  "spread.label": "Spread",
  "spread.more": "More space between devices",
  "spread.less": "Less space between devices",
  "map.label": "Network map. Arrow keys and Enter work in the device list.",
  "map.incomplete": "Incomplete",
  "map.incomplete_detail": "{x} of {y} router tables: findings name what is missing.",
  "map.connection_lost": "Connection to Home Assistant lost. The map shows the last data and reloads when it is back.",
  "map.loading": "Reading data …",
  "drawer.close": "Close",
  "drawer.expand": "Expand",
  "drawer.collapse": "Collapse",
  "tab.details": "Details",
  "tab.devices": "Devices",
  "tab.findings": "Findings",
  "tab.legend": "Legend",
  "status.label": "Data status",
  "status.source": "Source: {source}",
  "status.unchanged": "unchanged since {time}",
  "message.loading": "Reading the network …",
  "message.not_admin": "This panel needs an administrator account.",
  "message.disconnected": "No connection to Home Assistant. The panel tries again by itself when it is back.",
  "message.error": "Could not read the network: {message}",
  "message.version": "The panel files in your browser are out of date: please reload the page.",
  "message.retry": "Try again",
  "message.reload": "Reload the page",
  "live.selected": "{name} selected: {role}, {reception}.",
  "live.cleared": "Selection cleared.",
  "live.lost": "Connection lost.",
  "live.reloaded": "Data read again.",
  "role.router": "Router",
  "role.unknown": "Unknown role",
  "lqi.uncertain": "0 (uncertain)",
  "lqi.none": "no value",
  "rank.value": "rank {pct} %",
  "rank.weakest": "rank {pct} %, weakest tenth of what {reporter} hears",
  "rank.basis_reporter": "rank among the readings of {reporter}",
  "rank.basis_vendor": "rank within the {vendor} group (fewer than ten readings of {reporter})",
  "rank.weakest_vendor": "rank {pct} %, lowest tenth within the {vendor} group (fewer than ten readings of {reporter})",
  "rank.none": "not rated",
  "reception.value": "reception rank {pct} %",
  "reception.none": "reception not rated",
  "details.empty": "Select a device on the map, in the device list or among the findings.",
  "devices.filter": "Name, model, area, address",
  "devices.count": "{shown} of {total} devices",
  "devices.none": "No device matches.",
  "devices.list": "Devices",
  "devices.unavailable": "unavailable",
  "findings.none": "No findings.",
  "findings.hints": "Hints ({count})",
  "findings.hints_note": "Hints are not counted in the number of findings.",
  "findings.missing_table": "Table of {name} missing ({count})",
  "findings.group": "{kind} ({count})",
  "findings.incomplete_group": "{kind} (missing tables: {tables}, devices: {count})",
  "kind.offline": "Offline",
  "kind.parent offline": "Parent offline",
  "kind.route to offline device": "Route to an offline device",
  "kind.data incomplete": "Data incomplete",
  "kind.weak reception": "Weak reception",
  "kind.very low reading": "Very low reading",
  "kind.parent unknown": "Parent unknown",
  "kind.no parent": "No parent",
  "kind.isolated": "Isolated",
  "kind.many end-device children": "Many end-device children",
  "evidence.offline": "Unavailable in Home Assistant; last seen {time}.",
  "evidence.parent_offline": "Parent {parent} is unavailable (last seen {time}).",
  "legend.fill_none": "Fill: none",
  "legend.fill_role": "Fill: role",
  "legend.fill_power": "Fill: power source",
  "legend.symbols_title": "Symbols",
  "legend.symbol_router": "Frame with gaps and strokes: router, passes packets on",
  "legend.states_title": "States",
  "legend.state_offline": "offline: no fill",
  "legend.state_selected": "selected: thick frame",
  "legend.state_pinned": "pinned: pin",
  "power.mains": "Mains power",
  "power.dc": "DC source",
  "power.none": "Not reported",
  "fill.none": "None",
  "fill.role": "Role",
  "fill.power": "Power source",
  "storage.loading": "Reading the stored settings …",
  "storage.stored": "Saved in Home Assistant for this network, shared by all administrators.",
  "storage.unauthorized": "Kept only until this page is closed: saving needs an administrator.",
  "storage.unreadable": "Kept only until this page is closed: the stored settings could not be read ({message}).",
  "storage.offline": "Kept here until the connection is back; then the stored settings are read and your changes saved.",
  "storage.error": "Could not save ({message}). The next change tries again.",
  "storage.too_large": "Too large to save ({kib} KiB, the limit is 256 KiB). Release some pins.",
  "status.unchanged_note": "Observed: a panel notices a change only while one is open, so a table may have changed earlier than shown.",
  "status.scan_running": "scan running: tables changed since the scan started: {changed} of {total} (an unchanged table may also have been answered)",
  "status.scan_stop": "Stop",
  "status.short_unchanged": "unchanged since {time}",
  "status.short_scan_running": "scan: {changed}/{total} tables changed",
  "status.scan_stop_label": "Stop following the scan",
  "live.scan_started": "Scan started. The tables are read again every 15 seconds.",
  "live.scan_over": "The panel no longer follows the scan.",
  "observations.stored": "Observations: kept in Home Assistant for this network ({count} tables).",
  "observations.memory": "Observations: kept only until this page is closed ({reason}).",
  "observations.dropped": "The {count} oldest entries were dropped to stay under 256 KiB.",
  "legend.link.discovery": "Computed path: a candidate, not observed traffic.",
  "legend.link.heard": "Heard only",
  "legend.link.implied": "No traffic, no reading: only a route or parent entry proves this direction",
  "legend.link.width": "Width: lowest, middle or top third of what the hearer hears",
  "legend.link.not-listed": "No reception value in this direction: the hearer's table does not list the sender. This alone does not indicate a weak link.",
  "lane.parent": "Parent",
  "lane.route": "Route",
  "legend.link.path-end": "Dashed stem with ?: the path is unknown from here (a table or an entry is missing)",
  "legend.link.reception": "coloured: lower · middle · higher reception rank",
  "lane.path_unknown": "path unknown",
  "map.devices": "Devices",
  "map.devices_label": "Open devices, {count} findings",
  "map.details_on_click": "Details on click",
  "map.details_on_click_note": "On: a click on a device opens its details on the left.",
  "map.view": "View",
  "map.view_label": "Open view",
  "map.legend": "Legend",
  "map.legend_label": "Open legend",
  "panel.left_label": "Devices, findings and details",
  "panel.right_label": "View and legend",
  "tab.view": "View",
  "view.paths": "Communication paths",
  "view.path_display": "Path display",
  "view.grey": "Grey",
  "view.coloured": "Coloured by reception",
  "view.bad": "lower",
  "view.medium": "middle",
  "view.good": "higher",
  "view.color_bad_label": "Colour for lower reception rank",
  "view.color_medium_label": "Colour for middle reception rank",
  "view.color_good_label": "Colour for higher reception rank",
  "view.colors_info": "Colour shows the relative reception rank, not connection reliability.",
  "view.colors_info_label": "About colour by reception",
  "view.assumed_info": "The return path is assumed to follow the outbound path in reverse. It has not been verified.",
  "view.assumed_info_label": "About assumed return paths",
  "view.colors_note": "freely choosable, e.g. for colour blindness",
  "view.colors_reset": "Back to the default colours",
  "view.on_click": "On click on a device",
  "view.open_details": "Open details",
  "view.density": "Node distance (density)",
  "view.density_info": "Spacing helps arrange the network. It does not show physical distance.",
  "view.density_info_label": "About node distance",
  "view.fill": "Symbol fill",
  "view.labels": "Labels on the map",
  "view.label_type": "Device type above the symbol",
  "view.label_name": "Readable name below the symbol",
  "view.label_ha": "Original HA name",
  "view.debug": "Debug mode",
  "view.reload": "Read data again",
  "view.release": "Release all pins",
  "view.release_count": "Release all pins ({count})",
  "view.scan": "Scan topology …",
  "view.scan_running": "Scan running …",
  "view.scan_stop": "Stop following the scan",
  "legend.paths_title": "Communication paths",
  "legend.rx": "Number in the line = reception at the arrowhead (LQI). Receiver scales may differ.",
  "devices.search": "Search",
  "devices.hint_on": "A click on a device, here or on the map, opens its details.",
  "devices.hint_off": "Details on click is off: a click selects and zooms; right-click or long-press opens the details.",
  "kind_short.light": "Light",
  "kind_short.outlet": "Plug",
  "kind_short.relay": "Relay",
  "kind_short.button": "Button",
  "kind_short.sensor": "Sensor",
  "kind_short.motion": "Motion sensor",
  "kind_short.temperature": "Temperature",
  "kind_short.thermostat": "Thermostat",
  "kind_short.blind": "Blind",
  "kind_short.lock": "Lock",
  "kind_short.hub": "Hub",
  "details.tab_entity": "Entity",
  "devices.network": "Network",
  "devices.sleeps": "sleeps",
  "devices.via": "via {name}",
  "view.source_route": "Return paths without a table entry (source route)",
  "view.sr_off": "Off: the return path stays “unknown”",
  "view.sr_assume": "Assume: the way up reversed (dash-dot)",
  "view.sr_experimental": "experimental",
  "view.paths_table": "routing table",
  "view.paths_table_hint": "Each router's table names the next hop to a destination. This view follows those entries until the destination or a gap; a listed neighbour is reached directly.",
  "view.paths_returns": "include return routes",
  "view.paths_returns_hint": "Follow each destination's route back by the same rules.",
  "view.paths_all_hint": "without a selection every link any path uses (computed lighter); on click the device's trees there and back",
  "view.paths_heard": "additional heard neighbours (best 3)",
  "view.paths_heard_hint": "needs a selection: adds the device's 3 best partners with a reading and no drawn link",
  "view.paths_note": "Each view has its own basis. Debug shows everything.",
  "view.reload_info_label": "About reading the data",
  "legend.option_heard": "(option under \"Routing table\", needs a selection)",
  "legend.stage": "(view {n})",
  "legend.stages": "(views {a} and {b})",
  "legend.stage_computed": "(computed, view {n})",
  "legend.symbol_wired": "Plug only, no arcs: wired device",
  "status.names_missing": "Names and areas not read",
  "status.pill_label": "{name}, {state}. Data status and menu",
  "status.network": "Network",
  "status.lost": "connection to Home Assistant lost",
  "status.settings": "Settings",
  "status.settings_ha": "Settings (Home Assistant)",
  "status.settings_note": "Integration options in Home Assistant",
  "status.network_unavailable": "{source} is not available: {reason}",
  "status.age_minutes": "{n} min ago",
  "status.age_hours": "{n} h ago",
  "status.age_now": "just now",
});

/** One table from several: shared first, then each part's; a key two parts share must have the same text in both
 *  (two engines naming the same role), anything else is an error. */
export function mergeTexts(parts) {
  const out = {};
  for (const part of parts) {
    for (const [key, text] of Object.entries(part)) {
      if (key in out && out[key] !== text) throw new Error(`text ${key} differs between tables`);
      out[key] = text;
    }
  }
  return Object.freeze(out);
}

/** Every text of the panel: the shared table, every engine's and every adapter's. */
export const STRINGS = mergeTexts([SHARED, HISTORY_TEXTS, ...Object.values(ENGINES).map((e) => e.texts),
  ...ADAPTERS.map((a) => a.texts)]);

function primaryTag(hass) {
  const tag = (hass && ((hass.locale && hass.locale.language) || hass.language)) || "en";
  return String(tag).toLowerCase().split(/[-_]/)[0];
}

/** The locale for dates and numbers: the user's primary language subtag if the browser's Intl knows it, else English
 *  (English texts, local number and date format). */
export function formatLocaleOf(hass) {
  const primary = primaryTag(hass);
  try {
    return Intl.NumberFormat.supportedLocalesOf([primary]).length ? primary : "en";
  } catch {
    return "en";
  }
}

/** t(key, params) with the key itself as fallback. Also: t.formatLocale, t.number(n), t.list(items), t.time(text).
 *  strings: the table, all of the panel's by default (tests pass fewer: mergeTexts). */
export function translator(formatLocale = "en", strings = STRINGS) {
  const t = (key, params = {}) => {
    const text = strings[key] ?? key;
    return text.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m));
  };
  t.formatLocale = formatLocale;
  t.has = (key) => key in strings;
  /** A time the panel recorded (ISO, UTC) in the browser's local time: "14:32" today, with the date otherwise. */
  t.when = (iso, now = new Date()) => {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return "?";
    const sameDay = d.toDateString() === now.toDateString();
    const options = sameDay ? { hour: "2-digit", minute: "2-digit" }
      : { year: d.getFullYear() === now.getFullYear() ? undefined : "numeric", month: "numeric", day: "numeric",
        hour: "2-digit", minute: "2-digit" };
    return new Intl.DateTimeFormat(t.formatLocale, options).format(d);
  };
  const numbers = new Intl.NumberFormat(t.formatLocale);
  t.number = (n) => (typeof n === "number" && Number.isFinite(n) ? numbers.format(n) : "?");
  t.list = (items) => items.join(", ");
  /** ZHA's last_seen is local time without a zone ("2026-01-01T11:30:28"): shown as text, minutes only, never
   *  converted (spec 5.5: for routers it is text only). */
  t.time = (text) => {
    if (typeof text !== "string" || !text) return "?";
    const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(text);
    return m ? `${m[1]} ${m[2]}` : text;
  };
  return t;
}

/** The network with the model's own labels translated: a label whose labelKind has a text "label.<labelKind>" is the
 *  model's own word (Zigbee: the coordinator, labelKind "coordinator") and takes that text; every other label is the
 *  user's or the device's own text and stays as it is. areas:
 *  Home Assistant's hass.areas (id -> { name }), where present: its names win over the registry's, so the area shown
 *  is the one the frontend shows. */
export function localize(network, t, areas = null) {
  const areaName = (d) => {
    const a = areas && d.areaId && Object.hasOwn(areas, d.areaId) ? areas[d.areaId] : null;
    return a && typeof a.name === "string" && a.name.trim() ? a.name.trim() : d.area;
  };
  return { ...network, devices: network.devices.map((d) => {
    const area = areaName(d);
    const key = `label.${d.labelKind}`;
    const own = typeof d.labelKind === "string" && t.has(key);
    if (!own && area === d.area) return d;
    return { ...d, area, ...(own ? { label: t(key) } : {}) };
  }) };
}
