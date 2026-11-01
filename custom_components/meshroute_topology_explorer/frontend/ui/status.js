// SPDX-License-Identifier: MIT
// The status line (spec 6) and the decision which empty or error state applies before any data is shown (9.4).
// No DOM, no Home Assistant objects: the panel translates the parts. Tested in Node: node --test tests/

/** Below this completeness (share of available routers with a table) the map carries the banner "incomplete". */
export const INCOMPLETE_BELOW = 0.9;

/** Decide which empty/error state applies before any data is shown (spec 9.4). Returns a key or null. */
export function blockingState({ isAdmin, configEntries }) {
  if (!isAdmin) return "not_admin";
  const loaded = Array.isArray(configEntries) && configEntries.some((e) => e.domain === "zha" && e.state === "loaded");
  return loaded ? null : "zha_not_loaded";
}

export function isIncomplete(status) {
  return status.completeness < INCOMPLETE_BELOW;
}

/** Status keys of a followed scan (ui/scan.js states). */
const SCAN_KEYS = { running: "status.scan_running", ended: "status.scan_ended", stopped: "status.scan_stopped",
  "not-sent": "status.scan_not_sent" };

/** Short status keys of a followed scan, for narrow screens. */
const SCAN_SHORT = { running: "status.short_scan_running", ended: "status.short_scan_over", stopped: "status.short_scan_over",
  "not-sent": "status.short_scan_not_sent" };

/** The part on the right of the status line (board M1): the source-route stage and how many return paths it concerns
 *  (model/source-routes.js sourceRouteSummary: { mode, count }); null when no device is concerned. Long and short form,
 *  [key, params, longKey] like the other parts. */
export function sourceRoutePart(summary, compact = false) {
  if (!summary || !summary.count) return null;
  const long = summary.mode === "off" ? "status.sr_off" : "status.sr_assumed";
  const short = summary.mode === "off" ? "status.short_sr_off" : "status.short_sr_assumed";
  return compact ? [short, { count: summary.count }, long] : [long, { count: summary.count }];
}

/** Parts of the status line as [key, params] for the translator, in order (board M1): source, "Router tables: x/y"
 *  (available routers with a table; the coordinator is not counted; no percentage, review 1.4c), "unchanged since" when known (the caveat "observed" is the tooltip) (formatted time,
 *  from the observations), the state of a followed scan (spec 6, 9.4). Devices missing from every table are named by
 *  the findings, and that ZHA reads the tables by itself is an info button beside "Read data again" (decision by Fabian
 *  Schwamborn, 2026-11-01). compact (narrow screens): short forms in at most two lines, without the source; each part
 *  then carries a third element, the key of its long form, which the panel offers as the part's description. The
 *  source-route part (sourceRoutePart) is not among them: the panel sets it apart on the right. */
export function statusParts(network, { unchangedSince = null, scan = null, compact = false, collected = null } = {}) {
  if (network.source === "thread") return threadParts(network, { collected, compact });
  const s = network.status;
  if (compact) {
    const parts = [
      ["status.short_tables", { x: s.routersWithTable, y: s.routersAvailable }, "status.tables"],
    ];
    if (unchangedSince) parts.push(["status.short_unchanged", { time: unchangedSince }, "status.unchanged"]);
    const short = scan && SCAN_SHORT[scan.status];
    if (short) {
      parts.push([short, { changed: scan.changed, total: scan.total, message: scan.message || "?" }, SCAN_KEYS[scan.status]]);
    }
    return parts;
  }
  const parts = [
    ["status.source", { source: network.source === "zha" ? "ZHA" : network.source }],
    ["status.tables", { x: s.routersWithTable, y: s.routersAvailable }],
  ];
  if (unchangedSince) parts.push(["status.unchanged", { time: unchangedSince }]);
  const scanKey = scan && SCAN_KEYS[scan.status];
  if (scanKey) parts.push([scanKey, { changed: scan.changed, total: scan.total, message: scan.message || "?" }]);
  return parts;
}

/** Status parts of a Thread network (spec 3.2, 6; board Variant A): the source, the coverage "Links with both
 *  directions: x/y" instead of router tables (every Matter node's table comes with the snapshot), when the Matter
 *  server collected the topology with its age (collected: { time, age }, formatted by the panel; its note says it was
 *  read from the cache), and "no border router listed" when the snapshot names none. */
export function threadParts(network, { collected = null, compact = false } = {}) {
  const s = network.status;
  const parts = compact ? [] : [["status.source", { source: "Thread (Matter)" }]];
  parts.push(compact ? ["status.short_thread_links", { x: s.linksBoth, y: s.links }, "status.thread_links"]
    : ["status.thread_links", { x: s.linksBoth, y: s.links }]);
  if (collected) {
    parts.push(compact ? ["status.short_thread_read", collected, "status.thread_read"]
      : ["status.thread_read", collected, "status.thread_read_note"]);
  }
  if (!s.borderRouters) parts.push(["status.thread_no_br", {}]);
  return parts;
}

/** Age of a time as a text key and its parameters: "just now", "{n} min ago", "{n} h ago". */
export function ageParts(iso, now = Date.now()) {
  const minutes = Math.floor((now - Date.parse(iso)) / 60000);
  if (!Number.isFinite(minutes) || minutes < 1) return ["status.age_now", {}];
  return minutes < 120 ? ["status.age_minutes", { n: minutes }] : ["status.age_hours", { n: Math.floor(minutes / 60) }];
}
