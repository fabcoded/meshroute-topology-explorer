// SPDX-License-Identifier: MIT
// The status line of a Thread network (spec 3.2, 6, 9.1). No DOM: the panel translates the parts.
// npm test

/** Status parts of a Thread network: the source, the coverage "Links with both directions: x/y" instead of router
 *  tables (no source-route stage, no completeness banner: every Matter node's table comes with the snapshot), when
 *  the panel's snapshot was built with its age (collected: { time, age }, formatted by the panel), and "no border
 *  router listed" when the snapshot names none. `collected_at` is the time of the request, not the read time of the
 *  Thread tables, which the snapshot does not report; the note says so. */
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

/** Older than this the panel's snapshot counts as old for the pill's dot (the age of the snapshot, not of the Thread
 *  tables in it, whose read time is unknown): the interval at which ZHA scans by default (spec 6),
 *  reused so both networks follow one rule. */
export const OLD_AFTER_MS = 4 * 3600 * 1000;

/** The pill's dot (spec 6): "ok" when every linked pair is measured both ways, a border router is listed and the
 *  panel's snapshot is younger than OLD_AFTER_MS; else "warn". */
export function healthLevel(network, now = Date.now()) {
  const s = network.status;
  const age = network.collectedAt ? now - Date.parse(network.collectedAt) : 0;
  return s.linksBoth < s.links || !s.borderRouters || age >= OLD_AFTER_MS ? "warn" : "ok";
}

/** The whole status line of the engine (engines/index.js): { parts, right: null, incomplete: null, level }. extras:
 *  { compact, collected, now } (the snapshot time and its age, formatted by the panel). */
export function statusLine(network, { compact = false, collected = null, now = Date.now() } = {}) {
  return { parts: threadParts(network, { collected, compact }), right: null, incomplete: null,
    level: healthLevel(network, now) };
}
