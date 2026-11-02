// SPDX-License-Identifier: MIT
// The Zigbee engine's own settings keys (spec 11; engines cut, section 3): the view of "Communication paths", its
// checkboxes "additional heard neighbours" and "Include return routes", and the source-route stage, with the legacy
// readings of each. The shell (ui/settings.js) sanitizes its own keys and hands the stored object here; keys of other
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

/** The stage of "Communication paths" (board M11). Before it, the panel
 *  stored class switches (`links`) and the node view (`nodeView`: "coordinator" or "all"); without a valid `paths`
 *  the node view decides: "all" reads as the stage "all", anything else as the default. */
export function sanitizePaths(input, legacyNodeView) {
  if (PATH_STAGES.includes(input)) return input;
  if (input === "heard") return "all"; // the former third stage (settings.heard becomes true, sanitize below)
  return legacyNodeView === "all" ? "all" : DEFAULT_PATHS;
}

/** Write the Zigbee keys of the stored object `src` into `out` (the shell's copy of it), valid or their defaults,
 *  and drop the keys they replaced, so the next save leaves those out. */
export function sanitize(src, out) {
  out.paths = sanitizePaths(src.paths, src.nodeView);
  // Formerly "heard" was a third stage: it now reads as the stage "all" with the checkbox on.
  out.heard = src.paths === "heard" ? true : src.heard === true;
  if (src.paths === "heard") out.paths = "all";
  // Newer key; older stores have no key and read as off.
  out.returnRoutes = src.returnRoutes === true;
  // Replaced by paths: the next save leaves the class switches and the node view out.
  delete out.links;
  delete out.nodeView;
  // off, assume or zigpy (read the route records); anything else counts as "assume".
  out.sourceRoute = sourceRouteMode(src.sourceRoute);
  return out;
}

/** The engine's settings part (engines/index.js; ui/settings.js sanitizeSettings and SettingsClient take it). */
export const settings = Object.freeze({ keys: Object.freeze(Object.keys(DEFAULTS)), defaults: DEFAULTS, sanitize });
