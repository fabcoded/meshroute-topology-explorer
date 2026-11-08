// SPDX-License-Identifier: MIT
// Websocket conventions every adapter and client of the panel shares: how a command that died with the connection
// looks, a readable text of any error, and what a source's config entries say. No DOM. npm test

/** Code of home-assistant-js-websocket for a command that died with the connection (ERR_CONNECTION_LOST in its
 *  lib/errors.ts). Pending commands are rejected with { type: "result", success: false, error: { code: 3 } }, results
 *  of the server with { code, message }; both forms are accepted, as its own isConnectionLost() does. */
const ERR_CONNECTION_LOST = 3;

/** Code of a websocket error in either form ({ code, message } or { error: { code, message } }), else undefined. */
export function errorCode(err) {
  const e = err && (err.error || err);
  return e ? e.code : undefined;
}

export function isConnectionLost(err) {
  return errorCode(err) === ERR_CONNECTION_LOST;
}

/** Readable text of a websocket error ({ code, message }, { error: { ... } }, Error or anything else). */
export function errorText(err) {
  if (!err) return "unknown error";
  const e = err.error || err;
  return String(e.message || e.code || e);
}

/** What a source's config entries (config_entries/get) say (spec 9.4): { status: "loaded" } when an entry that counts
 *  is loaded; { status: "not_running", state } when entries count but none is loaded (state: the first one's, e.g.
 *  "setup_retry" while its server or radio is unreachable); else { status: "not_set_up" }. Ignored and disabled
 *  entries do not count (#15). */
export function entryState(entries, domain) {
  const counted = (Array.isArray(entries) ? entries : [])
    .filter((e) => e && e.domain === domain && e.source !== "ignore" && !e.disabled_by);
  if (counted.some((e) => e.state === "loaded")) return { status: "loaded" };
  return counted.length ? { status: "not_running", state: String(counted[0].state ?? "unknown") } : { status: "not_set_up" };
}
