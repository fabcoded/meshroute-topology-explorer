// SPDX-License-Identifier: MIT
// The Zigbee viewer engine (engines/index.js): what a Zigbee network means. For now a facade over the modules that
// hold that meaning today (model/, graph/links.js, graph/renderer.js); the cut moves them here step by step without
// changing behaviour, and each hook appears once a caller needs it.
// Pure, no DOM. node --test tests/
import { buildNetwork } from "../../model/index.js";
import { legendEntries, unknownGlyph } from "../../graph/links.js";
import { laneValue } from "../../graph/renderer.js";

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
});
