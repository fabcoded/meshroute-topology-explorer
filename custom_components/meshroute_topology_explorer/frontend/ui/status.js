// SPDX-License-Identifier: MIT
// The decision which empty or error state applies before any data is shown (spec 9.4), and the age of a time for the
// status line. The status line's parts are the engines' (engines/*/status.js). No DOM, no Home Assistant objects.
// Tested in Node: node --test tests/

/** Decide which empty/error state applies before any data is shown (spec 9.4). Returns a key or null. */
export function blockingState({ isAdmin, configEntries }) {
  if (!isAdmin) return "not_admin";
  const loaded = Array.isArray(configEntries) && configEntries.some((e) => e.domain === "zha" && e.state === "loaded");
  return loaded ? null : "zha_not_loaded";
}

/** Age of a time as a text key and its parameters: "just now", "{n} min ago", "{n} h ago". */
export function ageParts(iso, now = Date.now()) {
  const minutes = Math.floor((now - Date.parse(iso)) / 60000);
  if (!Number.isFinite(minutes) || minutes < 1) return ["status.age_now", {}];
  return minutes < 120 ? ["status.age_minutes", { n: minutes }] : ["status.age_hours", { n: Math.floor(minutes / 60) }];
}
