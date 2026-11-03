// SPDX-License-Identifier: MIT
// The viewer engines, one per network type (each network type gets its own
// viewer engine, engines are at most derived from each other). An engine holds the meaning of its network type: the
// model it builds, what each lane carries and how the map draws it (scene), lane values, legend, options, settings
// keys, status line, findings, Details, searchable addresses and texts. Shared code reaches an engine only through
// this module (engineFor, ENGINES); the engines do not import each other (tests/engine-leaks.test.mjs).
// Pure, no DOM. npm test
import { zigbee } from "./zigbee/index.js";
import { thread } from "./thread/index.js";
import { createHistory, createHistoryCache, hopContext, weakestHop } from "./zigbee/history.js";
import { tableWalk } from "./zigbee/paths.js";

export { createHistoryCache, hopContext, weakestHop };
export { RANGES, LANE_HALF_WINDOW } from "./history-records.js";

/** What the path history window needs to know of a network type: { walks (a routing table, so routes are walked),
 *  lqiMax (top of the LQI axis), keepsNoTable(device) (what it hears is in no record), entryText(entry) (the pill text of a lane value where there is no walk) }. */
export const historyCaps = (network) => engineFor(network).history;

/** The path history of a network over one recorded range (spec 5.8): createHistory with the network's engine and, for
 *  Zigbee, the live input the adapter kept (`network.live`). The history module serves both engines (Thread has no
 *  walks), so the shared UI reaches it here and not through an engine's folder. */
export function historyFor(network, response) {
  const engine = engineFor(network).key;
  return createHistory({ engine, response, live: engine === "zigbee" ? network.live : null });
}

/** Every engine by its key (a network's `engine`). */
export const ENGINES = Object.freeze({ zigbee, thread });

/** The engine of a network. Throws when the network names no known engine or declares no capabilities (spec 4.6):
 *  there is no default engine, so nothing is ever drawn as Zigbee because a field is missing. */
export function engineFor(network) {
  const key = network ? network.engine : undefined;
  if (typeof key !== "string" || !Object.hasOwn(ENGINES, key)) {
    throw new Error(`no viewer engine for network type ${JSON.stringify(key ?? null)}`);
  }
  if (!network.capabilities || typeof network.capabilities !== "object") {
    throw new Error(`the ${key} network declares no capabilities`);
  }
  return ENGINES[key];
}

/** Hops of the walk there (a to b) and back (b to a) on the shown network, for the badge's tooltip: { there, back } or
 *  null where the network type has no routing table (Thread, spec 5.8). */
export function pairHops(network, a, b) {
  if (engineFor(network).key !== "zigbee") return null;
  return { there: tableWalk(network, a, b).hops.length, back: tableWalk(network, b, a).hops.length };
}
