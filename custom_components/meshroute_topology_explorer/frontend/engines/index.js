// SPDX-License-Identifier: MIT
// The viewer engines, one per network type (decision by Fabian Schwamborn, 2026-11-01: each network type gets its own
// viewer engine, engines are at most derived from each other). An engine holds the meaning of its network type: the
// model it builds, lane values, legend and, step by step, roles, paths, options, status, findings and details. Shared
// code reaches an engine only through engineFor(); the engines do not import each other.
// Pure, no DOM. node --test tests/
import { zigbee } from "./zigbee/index.js";
import { thread } from "./thread/index.js";

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
