// SPDX-License-Identifier: MIT
// The Zigbee viewer engine (engines/index.js): what a Zigbee network means. For now a facade over the modules that
// hold that meaning today (model/, graph/links.js, graph/renderer.js); the cut moves them here step by step without
// changing behaviour, and each hook appears once a caller needs it.
// Pure except details(), which fills the Details tab. node --test tests/
import { buildNetwork } from "../../model/index.js";
import { legendEntries, unknownGlyph } from "../../graph/links.js";
import { laneValue } from "../../graph/renderer.js";
import { renderDetails } from "../../ui/details-tab.js";
import { findingText } from "../../ui/finding-text.js";
import { connection } from "./connection.js";
import { zigbeeOptions } from "./options.js";
import { statusLine } from "./status.js";
import { settings } from "./settings.js";

export const zigbee = Object.freeze({
  key: "zigbee",
  /** Network from the answer of `zha/devices` and the registries (model/index.js buildNetwork). */
  build: (payload, options = {}) => buildNetwork(payload, options),
  /** The value under "RX:" of a direction: the raw LQI, "Parent" or "Route" where only they imply it, else a glyph. */
  laneValue: (dir, texts) => laneValue(dir, texts),
  /** "–" where the hearer's table was read and does not list the sender, "?" where there is no table to ask. */
  unknownGlyph: (reason) => unknownGlyph(reason),
  /** The link rows of the legend (board M7): every path class with the stage or option that draws it. */
  legend: (theme, view = {}) => legendEntries(theme, { ...view, routes: true }),
  /** The status line (spec 6, board M1): { parts, right (the source-route stage), incomplete ({ x, y } or null) }. */
  status: (network, extras = {}) => statusLine(network, extras),
  /** Words of a finding: { title, lines }. */
  findings: Object.freeze({ text: (finding, t, name) => findingText(finding, t, name) }),
  /** The grey line's connection of a device in the Devices list (board M3), or null. */
  connection: (network, device) => connection(network, device),
  /** Fill the Details tab (three sub-tabs, boards M4, M8-M10). ctx: the panel's Details context; the paths follow
   *  this engine's own settings (paths, returnRoutes, sourceRoute). */
  details: (container, ctx) => renderDetails(container, { ...ctx, nodeView: ctx.settings.paths,
    returnRoutes: ctx.settings.returnRoutes, sourceRoute: ctx.settings.sourceRoute }),
  /** The View tab's Zigbee groups as data (OptionGroup[], ui/view-tab.js): communication paths, path display, return
   *  paths without a table entry. */
  options: (network, settings) => zigbeeOptions(network, settings),
  /** Its own settings keys (spec 11): paths, heard, returnRoutes, sourceRoute, with their legacy readings; the shell
   *  (ui/settings.js) keeps every other key. */
  settings,
});
