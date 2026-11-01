// SPDX-License-Identifier: MIT
// The Zigbee engine's data model: buildNetwork() turns the answers of ZHA (from-zha.js) into a Network (spec 4) with
// derived facts (5) and findings (5.6). No DOM, no Home Assistant objects. Plain objects, so a Network can be
// serialized. Tested in Node: node --test tests/
//
// Network = { engine: 'zigbee', source: 'zha', id, capabilities, devices, readings, routes, pairs, status, findings,
//             unresolved }; engine names the viewer engine (engines/index.js), capabilities what the data holds (spec 4.6)
// Device  = { id, registryId, nwk, role, label, labelKind, name, haName, area, areaId, firmware, entities, vendor,
//             model, powerSource, kind, sleepy, battery, available, lastSeen, parent, children, relayLoad, rating, hasTable, tableSize, tableCapacity,
//             tableCapacitySource, tableFull, parentLqi, parentFromStaleTable, possiblyStaleParents }
// Reading = { reporter, subject, lqi, measured, scale, relationship, rating, pool, poolMedian }
// Pair    = { a, b, ab, ba }, direction = { state, lqi, rating, source, reason } (pairs.js)
// Route   = { owner, destination, nextHop, status, direct, stale }
import { normalize, ZHA_CAPABILITIES } from "./from-zha.js";
import { applyRatings } from "./ratings.js";
import { relayLoads } from "./paths.js";
import { computePairs, pairEvidence } from "./pairs.js";
import { computeFindings, computeStatus } from "./findings.js";

export { parseAddress, parseLqi, normalizeIeee } from "../../model/parse.js";
export { upPath, downPath, routePath } from "./paths.js";
export { nodePaths, pathHops, unknownEnd, NODE_VIEWS, DEFAULT_NODE_VIEW } from "./node-paths.js";
export { assumedDownPaths, sourceRouteSummary, sourceRouteMode, SOURCE_ROUTE_MODES, DEFAULT_SOURCE_ROUTE }
  from "./source-routes.js";
export { fingerprints, updateObservations, newestChange } from "../../model/observations.js";
export { pairEvidence };
export { FINDING_KINDS } from "./findings.js";
export { KINDS } from "./kinds.js";
export { ZHA_CAPABILITIES };

/** Build a Network from the answer of `zha/devices` and, optionally, the registry answers and the ZHA config entry
 *  list (`config_entries/get`), which names the network. capabilities: what the source holds, ZHA's by default. */
export function buildNetwork(rawDevices, { deviceRegistry, areaRegistry, configEntries, capabilities = ZHA_CAPABILITIES } = {}) {
  const { devices, readings, routes, unresolved } = normalize(rawDevices, { deviceRegistry, areaRegistry });
  applyRatings(devices, readings);
  const loads = relayLoads(routes);
  for (const d of devices) d.relayLoad = loads.get(d.id) || 0;
  const entry = (Array.isArray(configEntries) ? configEntries : []).find((e) => e && e.domain === "zha" && e.entry_id);
  return {
    engine: "zigbee",
    source: "zha",
    id: entry ? entry.entry_id : "zha",
    capabilities,
    devices, readings, routes,
    pairs: computePairs({ devices, readings, routes }),
    status: computeStatus({ devices, readings }),
    findings: computeFindings({ devices, readings, routes }),
    unresolved,
  };
}
