// SPDX-License-Identifier: MIT
// The Zigbee engine's own settings keys (spec 11; engines cut, section 3): the view of "Communication paths", its
// checkboxes "additional heard neighbours" and "Include return routes", and the source-route stage. The shell (ui/settings.js) sanitizes its own keys and hands the stored object here; keys of other
// engines are kept verbatim by the shell and never read here. No DOM. npm test
import { DEFAULT_PATHS, PATH_STAGES } from "./lanes.js";
import { DEFAULT_SOURCE_ROUTE, sourceRouteMode } from "./source-routes.js";

/** Defaults of the Zigbee keys (spec 11). paths: the view of "Communication paths" (PATH_STAGES: with the coordinator
 *  there and back, routing table, paths to all devices). heard: the checkbox "additional heard neighbours (best 3)",
 *  on top of any view (default off). returnRoutes: the checkbox "Include return routes" of the view "routing table"
 *  (default off). sourceRoute: return paths without a table entry are "assume"d (the way up reversed), "off"
 *  (unknown) or read from "zigpy" (route records, else assumed). */
export const DEFAULTS = Object.freeze({ paths: DEFAULT_PATHS, heard: false, returnRoutes: false,
  sourceRoute: DEFAULT_SOURCE_ROUTE });

/** The stage of "Communication paths" (board M11); anything else is the default. */
export function sanitizePaths(input) {
  return PATH_STAGES.includes(input) ? input : DEFAULT_PATHS;
}

/** Write the Zigbee keys of the stored object `src` into `out` (the shell's copy of it), valid or their defaults. */
export function sanitize(src, out) {
  out.paths = sanitizePaths(src.paths);
  out.heard = src.heard === true;
  out.returnRoutes = src.returnRoutes === true;
  // off, assume or zigpy (read the route records); anything else counts as "assume".
  out.sourceRoute = sourceRouteMode(src.sourceRoute);
  return out;
}

/** The engine's settings part (engines/index.js; ui/settings.js sanitizeSettings and SettingsClient take it). */
export const settings = Object.freeze({ keys: Object.freeze(Object.keys(DEFAULTS)), defaults: DEFAULTS, sanitize });
