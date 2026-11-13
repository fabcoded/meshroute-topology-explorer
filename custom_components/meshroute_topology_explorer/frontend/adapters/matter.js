// SPDX-License-Identifier: MIT
// The Matter adapter (spec 3.2): reads the Thread network through Home Assistant's Matter integration, and the border
// routers its Thread integration knows (#20), and hands both to the Thread engine (engines/index.js), which builds the
// model. Read only: a snapshot built from the server's cache. No DOM. npm test
import { ENGINES } from "../engines/index.js";
import { entryState, errorCode, errorText, isConnectionLost } from "./ws.js";
import { TEXTS } from "./matter-texts.js";

/** How long the panel waits at most for the result of thread/discover_routers, and then collects its events (owner
 *  decision 2026-11-13, from a measurement on Home Assistant 2026.11, 5 runs: both routers arrived 3 ms after
 *  subscribing, once 87 ms, from Home Assistant's mDNS cache, before or with the result). */
export const DISCOVERY_MS = 500;
const REAL_TIMERS = Object.freeze({ setTimeout: (f, ms) => setTimeout(f, ms) });

/** End a subscription; a failed unsubscribe means the connection is gone, and the subscription with it. */
const stop = (unsubscribe) => Promise.resolve(unsubscribe()).catch(() => null);

/** The border routers Home Assistant's Thread integration knows, read only (spec 3.2 "Border routers", #20): the
 *  answer of thread/list_datasets (no keys) and the data of the routers thread/discover_routers reports (a
 *  subscription: Home Assistant's mDNS view, no Thread radio traffic; events may arrive before its result) until
 *  DISCOVERY_MS after the result, then it unsubscribes. Returns { datasets, routers }, each null where its command
 *  failed or no result came within DISCOVERY_MS (no Thread integration, not an admin): the map is then built as
 *  without them, without a message. Never rejects: a lost connection comes back as { lost }. timers: { setTimeout }. */
async function readBorderRouters(hass, timers) {
  const found = new Map();
  const onEvent = (e) => {
    if (e && e.type === "router_discovered" && typeof e.key === "string") found.set(e.key, e.data);
    else if (e && e.type === "router_removed") found.delete(e.key);
  };
  const elapsed = () => new Promise((resolve) => { timers.setTimeout(() => resolve(null), DISCOVERY_MS); });
  const subscribing = (async () => hass.connection.subscribeMessage(onEvent, { type: "thread/discover_routers" },
    { resubscribe: false }))();
  const [datasets, subscribed] = await Promise.allSettled([hass.callWS({ type: "thread/list_datasets" }),
    Promise.race([subscribing, elapsed()])]);
  let routers = null;
  if (subscribed.status === "fulfilled" && subscribed.value) {
    await elapsed();
    routers = [...found.values()];
    stop(subscribed.value);
  } else subscribing.then(stop, () => null); // a result after DISCOVERY_MS: end the subscription when it comes
  const lost = [datasets, subscribed].find((r) => r.status === "rejected" && isConnectionLost(r.reason));
  if (lost) return { lost: lost.reason };
  return { datasets: datasets.status === "fulfilled" ? datasets.value : null, routers };
}

/** The Thread network through Matter (spec 3.2): read only when the Matter integration is loaded, with refresh false
 *  (a snapshot built from the server's cache; refresh true reads every node's tables over the radio and is never
 *  sent from here), then the route tables of the same cache through the integration (thread_tables); beside them the
 *  border routers of Home Assistant's Thread integration (readBorderRouters). options.timers: { setTimeout }.
 *  Returns { status: "ok" | "not_set_up" | "not_running" | "not_supported" | "empty" | "error", network?, message?
 *  (not_running: the entry's state) }; a lost
 *  connection is thrown to the caller. A Matter server too old for the command answers not_supported, Home Assistant
 *  before 2026.9 unknown_command (below the minimum 2026.10, spec 3.2): both are "not_supported". */
export async function readThread(hass, registries = {}, { timers = REAL_TIMERS } = {}) {
  let entries;
  try {
    entries = await hass.callWS({ type: "config_entries/get", domain: "matter" });
  } catch (err) {
    if (isConnectionLost(err)) throw err;
    return { status: "error", message: errorText(err) };
  }
  const entry = entryState(entries, "matter");
  if (entry.status === "not_set_up") return { status: "not_set_up" };
  if (entry.status === "not_running") return { status: "not_running", message: entry.state };
  const borderRouters = readBorderRouters(hass, timers); // never rejects; ends its subscription itself
  let topology;
  try {
    topology = await hass.callWS({ type: "matter/network_topology", refresh: false });
  } catch (err) {
    if (isConnectionLost(err)) throw err;
    const code = errorCode(err);
    if (code === "not_supported" || code === "unknown_command") return { status: "not_supported" };
    return { status: "error", message: errorText(err) };
  }
  // The route and neighbour tables of the Matter client's cache (the integration's own command, read only, no radio
  // traffic; spec 3.2 "Routes"): without them the map has no routes and Details say why.
  let tables = null;
  let tablesProblem = null;
  try {
    tables = await hass.callWS({ type: "meshroute_topology_explorer/thread_tables" });
  } catch (err) {
    if (isConnectionLost(err)) throw err;
    tablesProblem = errorText(err);
  }
  const haThread = await borderRouters;
  if (haThread.lost) throw haThread.lost;
  const network = ENGINES.thread.build(topology, { ...registries, tables, tablesProblem, haThread });
  return network ? { status: "ok", network } : { status: "empty" };
}

/** Reasons a Thread network cannot be shown that the network switch names (it lists the network greyed), with their
 *  words; not set up, read and skipped are no reasons. */
const UNAVAILABLE = Object.freeze({ not_running: "status.thread_not_running", not_supported: "status.thread_not_supported",
  empty: "status.thread_empty", error: "status.thread_error" });

/** One read of this source for the panel (ui/controller.js readNetwork): readThread's { status, network?, message? }.
 *  The registries are read before the Matter read. */
export async function readSource(hass, { registries }) {
  // hass.entities and hass.states are already in the panel: the Thread engine derives each device's kind from them.
  const read = await readThread(hass, { ...(await registries()), entities: hass.entities, states: hass.states });
  return { ...read, network: read.network || null };
}

/** Empty-state phases of a Matter read without a network (spec 9.4): the same reasons the network switch names. */
const EMPTY_STATES = Object.freeze({ not_running: "thread_not_running", not_supported: "thread_not_supported",
  empty: "thread_empty", error: "thread_error" });

/** The Matter adapter as the shell sees it (adapters/index.js): key (the source its networks carry, "thread", and the
 *  stored choice of the network switch), the read, the empty-state phase of a read without a network, whether a read
 *  lists the network greyed and the words for why, and the reload note (a text key: the server's cached topology,
 *  refresh false, no radio traffic). */
export const adapter = Object.freeze({
  key: "thread",
  read: readSource,
  emptyState: (read) => (read && EMPTY_STATES[read.status]) || null,
  unavailable: (read) => Boolean(read && UNAVAILABLE[read.status]),
  reasonText: (choice, t) => t(UNAVAILABLE[choice.reason], { message: choice.message || "?" }),
  devicePage: null,
  scan: null,
  Observations: null,
  reloadInfo: "view.thread_reload_info",
  texts: TEXTS,
});
