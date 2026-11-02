// SPDX-License-Identifier: MIT
// The Matter adapter (spec 3.2): reads the Thread network through Home Assistant's Matter integration and hands the
// topology to the Thread engine (engines/index.js), which builds the model. Read only: the server's cached snapshot.
// No DOM. npm test
import { ENGINES } from "../engines/index.js";
import { errorText, isConnectionLost } from "./ws.js";
import { TEXTS } from "./matter-texts.js";

/** The Thread network through Matter (spec 3.2): read only when the Matter integration is loaded, with refresh false
 *  (the server's cached snapshot; refresh true reads every node's tables over the radio and is never sent from here).
 *  Returns { status: "ok" | "not_loaded" | "not_supported" | "empty" | "error", network?, message? }; a lost
 *  connection is thrown to the caller. Home Assistant before 2026.9 has no such command (unknown_command), a Matter
 *  server too old for it answers not_supported (spec 3.2): both are "not_supported". */
export async function readThread(hass, registries = {}) {
  let entries;
  try {
    entries = await hass.callWS({ type: "config_entries/get", domain: "matter" });
  } catch (err) {
    if (isConnectionLost(err)) throw err;
    return { status: "error", message: errorText(err) };
  }
  if (!(Array.isArray(entries) && entries.some((e) => e && e.domain === "matter" && e.state === "loaded"))) {
    return { status: "not_loaded" };
  }
  let topology;
  try {
    topology = await hass.callWS({ type: "matter/network_topology", refresh: false });
  } catch (err) {
    if (isConnectionLost(err)) throw err;
    const code = String((err && (err.code || (err.error && err.error.code))) || "");
    if (code === "not_supported" || code === "unknown_command") return { status: "not_supported" };
    return { status: "error", message: errorText(err) };
  }
  const network = ENGINES.thread.build(topology, registries);
  return network ? { status: "ok", network } : { status: "empty" };
}

/** Reasons a Thread network cannot be shown that the network switch names (it lists the network greyed); not loaded,
 *  read and skipped are no reasons. */
const UNAVAILABLE = Object.freeze(["not_supported", "empty", "error"]);

/** One read of this source for the panel (ui/controller.js readNetwork): readThread's { status, network?, message? }
 *  with blocking null (Thread alone never blocks the panel). The registries are read before the Matter read. */
export async function readSource(hass, { registries }) {
  const read = await readThread(hass, await registries());
  return { ...read, network: read.network || null, blocking: null };
}

/** The Matter adapter as the shell sees it (adapters/index.js): key (the source its networks carry, "thread", and the
 *  stored choice of the network switch), the read, whether a read lists the network greyed and the words for why, and
 *  the reload note (a text key: the server's cached topology, refresh false, no radio traffic). */
export const adapter = Object.freeze({
  key: "thread",
  read: readSource,
  blocking: null,
  unavailable: (read) => Boolean(read && UNAVAILABLE.includes(read.status)),
  reasonText: (choice, t) => {
    if (choice.reason === "not_supported") return t("status.thread_not_supported");
    if (choice.reason === "empty") return t("status.thread_empty");
    return t("status.thread_error", { message: choice.message || "?" });
  },
  devicePage: null,
  scan: null,
  Observations: null,
  reloadInfo: "view.thread_reload_info",
  texts: TEXTS,
});
