// SPDX-License-Identifier: MIT
// Websocket conventions every adapter and client of the panel shares: how a command that died with the connection
// looks, and a readable text of any error. No DOM. node --test tests/

/** Code of home-assistant-js-websocket for a command that died with the connection (ERR_CONNECTION_LOST in its
 *  lib/errors.ts). Pending commands are rejected with { type: "result", success: false, error: { code: 3 } }, results
 *  of the server with { code, message }; both forms are accepted, as its own isConnectionLost() does. */
const ERR_CONNECTION_LOST = 3;

export function isConnectionLost(err) {
  return Boolean(err) && (err.code === ERR_CONNECTION_LOST || (err.error && err.error.code === ERR_CONNECTION_LOST));
}

/** Readable text of a websocket error ({ code, message }, { error: { ... } }, Error or anything else). */
export function errorText(err) {
  if (!err) return "unknown error";
  const e = err.error || err;
  return String(e.message || e.code || e);
}
