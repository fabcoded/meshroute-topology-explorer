// SPDX-License-Identifier: MIT
// The age of a time for the status line. The status line's parts are the engines' (engines/<type>/status.js); which
// empty or error state applies before any data is shown is the controller's and the adapters' (spec 9.4). No DOM.
// Tested in Node: node --test tests/

/** Age of a time as a text key and its parameters: "just now", "{n} min ago", "{n} h ago". */
export function ageParts(iso, now = Date.now()) {
  const minutes = Math.floor((now - Date.parse(iso)) / 60000);
  if (!Number.isFinite(minutes) || minutes < 1) return ["status.age_now", {}];
  return minutes < 120 ? ["status.age_minutes", { n: minutes }] : ["status.age_hours", { n: Math.floor(minutes / 60) }];
}
