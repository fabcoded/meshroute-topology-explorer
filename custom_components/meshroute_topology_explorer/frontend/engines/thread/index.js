// SPDX-License-Identifier: MIT
// The Thread viewer engine (engines/index.js): what a Thread network read through Matter means (spec 3.2, 4.6). For
// now a facade over the modules that hold that meaning today (model/thread.js, graph/links.js, graph/renderer.js); the
// cut moves it here step by step without changing behaviour, and each hook appears once a caller needs it.
// Pure, no DOM. node --test tests/
import { buildThreadNetwork } from "../../model/thread.js";
import { legendEntries, unknownGlyph } from "../../graph/links.js";
import { laneValue } from "../../graph/renderer.js";

export const thread = Object.freeze({
  key: "thread",
  /** Network from the answer of `matter/network_topology` and the registries (model/thread.js); null without a node. */
  build: (payload, options = {}) => buildThreadNetwork(payload, options),
  /** The value under "RX:" of a direction: RSSI in dBm, else link quality 0-3, "Parent" for a parent link, else a
   *  glyph; never a number on the Zigbee LQI scale. */
  laneValue: (dir, texts) => laneValue(dir, texts),
  /** "–" where the hearer's neighbour table was read and does not list the sender, "?" where there is none. */
  unknownGlyph: (reason) => unknownGlyph(reason),
  /** The link rows of the legend: parent links, measured neighbours, the glyphs, RX in dBm; no stages. */
  legend: (theme, view = {}) => legendEntries(theme, { ...view, routes: false }),
});
