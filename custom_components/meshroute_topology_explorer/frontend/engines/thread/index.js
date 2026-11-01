// SPDX-License-Identifier: MIT
// The Thread viewer engine (engines/index.js): what a Thread network read through Matter means (spec 3.2, 4.6). For
// now a facade over the modules that hold that meaning today (model/thread.js, graph/links.js, graph/renderer.js); the
// cut moves it here step by step without changing behaviour, and each hook appears once a caller needs it.
// Pure except details(), which fills the Details tab. node --test tests/
import { buildThreadNetwork } from "../../model/thread.js";
import { laneValue, legendEntries, springQuality, unknownGlyph } from "./lanes.js";
import { renderThreadDetails } from "../../ui/thread-details.js";
import { findingText } from "./findings.js";
import { statusLine } from "./status.js";
import * as threadScene from "./scene.js";

/** The kinds Thread raises (spec 4.6), in the Findings tab's order. */
const THREAD_FINDING_KINDS = Object.freeze(["offline", "parent offline", "parent unknown"]);

/** Thread owns no settings keys today (engines cut, section 3): a stored Zigbee key under a Thread id is kept by the
 *  shell, never read and never written. */
const SETTINGS = Object.freeze({ keys: Object.freeze([]), defaults: Object.freeze({}), sanitize: (src, out) => out });

/** The View tab's Thread groups: one line where the paths would be, no controls (ui/view-tab.js renders a group
 *  without a legend as its note). */
const THREAD_OPTIONS = Object.freeze([Object.freeze({ id: "paths", legend: null, note: "view.thread_paths_note",
  controls: Object.freeze([]) })]);

export const thread = Object.freeze({
  key: "thread",
  /** Network from the answer of `matter/network_topology` and the registries (model/thread.js); null without a node. */
  build: (payload, options = {}) => buildThreadNetwork(payload, options),
  /** The value under "RX:" of a direction: RSSI in dBm, else link quality 0-3, "Parent" for a parent link, else a
   *  glyph; never a number on the Zigbee LQI scale. */
  laneValue: (dir, texts) => laneValue(dir, texts),
  /** "–" where the hearer's neighbour table was read and does not list the sender, "?" where there is none. */
  unknownGlyph: (reason) => unknownGlyph(reason),
  /** A reading's quality 0..1 for the layout's springs (link quality / 3), or null: RSSI alone is no spring. */
  springQuality: (reading) => springQuality(reading),
  /** The link rows of the legend: parent links, measured neighbours, the glyphs, RX in dBm; no stages. */
  legend: (theme) => legendEntries(theme),
  /** The status line (spec 3.2, 6): links measured both ways, the collection time; no right part, no banner. */
  status: (network, extras = {}) => statusLine(network, extras),
  /** Its finding kinds in the order the Findings tab groups them (offline, parent offline, parent unknown;
   *  model/thread.js threadFindings), and the words of a finding: { title, lines }. */
  findings: Object.freeze({ kinds: THREAD_FINDING_KINDS, text: (finding, t, name) => findingText(finding, t, name) }),
  /** What a user may type to find a device by its network address (Devices search): the RLOC16 as "0x1c00 7168", or
   *  none; the extended address is the device's key and searched anyway. */
  addresses: (device) => (typeof device.rloc16 === "number"
    ? [`0x${device.rloc16.toString(16).padStart(4, "0")} ${device.rloc16}`] : []),
  /** The grey line's connection of a device in the Devices list: an end device "via" its parent, else null. */
  connection: (network, device) => {
    if (device.role !== "end device" || !device.parent) return null;
    const parent = network.devices.find((x) => x.id === device.parent);
    return parent ? { kind: "via", label: parent.label } : null;
  },
  /** Fill the Details tab: one stack of cards, no sub-tabs (no routes, signature or clusters). */
  details: (container, ctx) => renderThreadDetails(container, ctx),
  /** The View tab's Thread groups: none of the Zigbee path groups (owner decision 2026-11-01: hidden, not greyed;
   *  colour by reception waits for the Thread reception model), one line where the paths would be saying why. */
  options: () => THREAD_OPTIONS,
  /** What its map draws (graph/renderer.js): parent links and measured neighbours; a click shows the device's own
   *  lanes, no band, no ends (scene.js). anchors: the leader and the border routers, always labelled; fit "contain":
   *  the whole network in the window at the active density. */
  scene: Object.freeze({ lanes: threadScene.lanes, classify: threadScene.classify, viewKey: threadScene.viewKey,
    overview: threadScene.overview, focus: threadScene.focus, classes: threadScene.CLASSES,
    anchors: threadScene.anchors, labelRank: threadScene.labelRank, fit: threadScene.FIT }),
  /** Its own settings keys: none. */
  settings: SETTINGS,
});
