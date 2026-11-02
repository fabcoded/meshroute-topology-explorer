// SPDX-License-Identifier: MIT
// The status line of a Zigbee network (spec 6, board M1): source, "Router tables: x/y", "unchanged since" from the
// observations, a followed scan, the source-route stage on the right, and the "incomplete" banner below 90 % of the
// available routers with a table. No DOM: the panel translates the parts. npm test
import { sourceRouteSummary } from "./source-routes.js";

/** Below this completeness (share of available routers with a table) the map carries the banner "incomplete". */
export const INCOMPLETE_BELOW = 0.9;

export function isIncomplete(status) {
  return status.completeness < INCOMPLETE_BELOW;
}

/** Status keys of a followed scan (adapters/zha-scan.js states). */
const SCAN_KEYS = { running: "status.scan_running", ended: "status.scan_ended", stopped: "status.scan_stopped",
  "not-sent": "status.scan_not_sent" };

/** Short status keys of a followed scan, for narrow screens. */
const SCAN_SHORT = { running: "status.short_scan_running", ended: "status.short_scan_over", stopped: "status.short_scan_over",
  "not-sent": "status.short_scan_not_sent" };

/** Reasons the integration gives when zigpy cannot be read (zigpy_routes.py), and the error code of an older
 *  integration; anything else is shown as it came. */
const ZIGPY_REASONS = ["zha_not_loaded", "no_gateway", "internals_changed", "error", "unknown_command"];

/** The part on the right of the status line (board M1): the source-route stage and how many return paths it concerns
 *  (source-routes.js sourceRouteSummary: { mode, count, recorded, zigpy }); null when no device is concerned, and
 *  in the view "routing table" (`paths` "table"), which draws no assumed or recorded return path.
 *  Long and short form, [key, params, longKey] like the other parts. In the stage "zigpy" the part counts recorded and
 *  assumed return paths; when zigpy could not be read it says so, the reason being the part's description. */
export function sourceRoutePart(summary, compact = false, paths = "coordinator") {
  if (!summary || paths === "table") return null;
  if (summary.mode === "zigpy") {
    const z = summary.zigpy || {};
    const reason = ZIGPY_REASONS.includes(z.reason) ? z.reason : null;
    const params = { count: summary.count, recorded: summary.recorded || 0, reason: reason || z.reason || "?" };
    if (z.status !== "ok") {
      const why = reason ? `status.zigpy_reason_${reason}` : "status.sr_zigpy_reason";
      return compact ? ["status.short_sr_zigpy_failed", params, "status.sr_zigpy_failed"] : ["status.sr_zigpy_failed", params, why];
    }
    if (!summary.count && !summary.recorded) return null;
    return compact ? ["status.short_sr_zigpy", params, "status.sr_zigpy"] : ["status.sr_zigpy", params];
  }
  if (!summary.count) return null;
  const long = summary.mode === "off" ? "status.sr_off" : "status.sr_assumed";
  const short = summary.mode === "off" ? "status.short_sr_off" : "status.short_sr_assumed";
  return compact ? [short, { count: summary.count }, long] : [long, { count: summary.count }];
}

/** Parts of the status line as [key, params] for the translator, in order (board M1): source, "Router tables: x/y"
 *  (available routers with a table; the coordinator is not counted; no percentage, review 1.4c), "unchanged since" when known (the caveat "observed" is the tooltip) (formatted time,
 *  from the observations), the state of a followed scan (spec 6, 9.4). Devices missing from every table are named by
 *  the findings, and that ZHA reads the tables by itself is an info button beside "Read data again". compact (narrow screens): short forms in at most two lines, without the source; each part
 *  then carries a third element, the key of its long form, which the panel offers as the part's description. The
 *  source-route part (sourceRoutePart) is not among them: the panel sets it apart on the right. */
export function statusParts(network, { unchangedSince = null, scan = null, compact = false } = {}) {
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

/** The whole status line of the engine (engines/index.js): { parts, right, incomplete }. extras: { unchangedSince,
 *  scan, compact, settings } (settings: the network's, for the source-route stage and the view; without them no
 *  right part). incomplete: { x, y } for the banner "Router tables: x/y", or null. */
export function statusLine(network, { unchangedSince = null, scan = null, compact = false, settings = null } = {}) {
  const s = network.status;
  return {
    parts: statusParts(network, { unchangedSince, scan, compact }),
    // Not in the view "routing table" (sourceRoutePart).
    right: settings ? sourceRoutePart(sourceRouteSummary(network, settings.sourceRoute), compact, settings.paths) : null,
    incomplete: isIncomplete(s) ? { x: s.routersWithTable, y: s.routersAvailable } : null,
  };
}
