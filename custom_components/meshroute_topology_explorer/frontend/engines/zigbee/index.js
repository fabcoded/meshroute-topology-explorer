// SPDX-License-Identifier: MIT
// The Zigbee viewer engine (engines/index.js): what a Zigbee network means. For now a facade over the modules that
// hold that meaning today (model/, graph/links.js, graph/renderer.js); the cut moves them here step by step without
// changing behaviour, and each hook appears once a caller needs it.
// Pure except details(), which fills the Details tab. node --test tests/
import { buildNetwork, FINDING_KINDS } from "./model.js";
import { laneValue, legendEntries, springQuality, unknownGlyph } from "./lanes.js";
import { renderDetails } from "./ui/details-tab.js";
import { openClusterDialog } from "./ui/cluster-dialog.js";
import { findingText } from "./ui/finding-text.js";
import { connection } from "./connection.js";
import { zigbeeOptions } from "./options.js";
import { statusLine } from "./status.js";
import { settings } from "./settings.js";
import * as zigbeeScene from "./scene.js";

export const zigbee = Object.freeze({
  key: "zigbee",
  /** Network from the answer of `zha/devices` and the registries (model/index.js buildNetwork). */
  build: (payload, options = {}) => buildNetwork(payload, options),
  /** The value under "RX:" of a direction: the raw LQI, "Parent" or "Route" where only they imply it, else a glyph. */
  laneValue: (dir, texts) => laneValue(dir, texts),
  /** "–" where the hearer's table was read and does not list the sender, "?" where there is no table to ask. */
  unknownGlyph: (reason) => unknownGlyph(reason),
  /** A reading's quality 0..1 for the layout's springs (LQI / 255), or null for no spring. */
  springQuality: (reading) => springQuality(reading),
  /** The link rows of the legend (board M7): every path class with the stage or option that draws it. */
  legend: (theme, view = {}) => legendEntries(theme, view),
  /** The status line (spec 6, board M1): { parts, right (the source-route stage), incomplete ({ x, y } or null) }. */
  status: (network, extras = {}) => statusLine(network, extras),
  /** Its finding kinds in the order the Findings tab groups them (model/findings.js), and the words of a finding:
   *  { title, lines }. */
  findings: Object.freeze({ kinds: FINDING_KINDS, text: (finding, t, name) => findingText(finding, t, name) }),
  /** What a user may type to find a device by its network address (Devices search): "0x1234 4660", or none. */
  addresses: (device) => (typeof device.nwk === "number"
    ? [`0x${device.nwk.toString(16).padStart(4, "0")} ${device.nwk}`] : []),
  /** The grey line's connection of a device in the Devices list (board M3), or null. */
  connection: (network, device) => connection(network, device),
  /** Fill the Details tab (three sub-tabs, boards M4, M8-M10). ctx: the panel's Details context; the paths follow
   *  this engine's own settings (paths, returnRoutes, sourceRoute); a cluster's details open as a dialog through the
   *  panel's ctx.openDialog(open(host)). */
  details: (container, ctx) => renderDetails(container, { ...ctx, nodeView: ctx.settings.paths,
    returnRoutes: ctx.settings.returnRoutes, sourceRoute: ctx.settings.sourceRoute,
    onCluster: (spec, opener) => {
      const device = ctx.network.devices.find((d) => d.id === ctx.id);
      if (device) ctx.openDialog((host) => openClusterDialog({ ...host, t: ctx.t, device, ...spec, opener }));
    } }),
  /** The View tab's Zigbee groups as data (OptionGroup[], ui/view-tab.js): communication paths, path display, return
   *  paths without a table entry. */
  options: (network, settings) => zigbeeOptions(network, settings),
  /** What its map draws (graph/renderer.js): lanes and classify once per scene, then per view the overview's look
   *  of every lane and the focus of a selected or hovered device (scene.js). classes: the counters of the drawn
   *  lanes; anchors: always labelled (the coordinator); labelRank: label order; fit: how the fitted view frames the
   *  map ("base": at density factor 1). */
  scene: Object.freeze({ lanes: zigbeeScene.lanes, classify: zigbeeScene.classify, viewKey: zigbeeScene.viewKey,
    overview: zigbeeScene.overview, focus: zigbeeScene.focus, classes: zigbeeScene.CLASSES,
    anchors: zigbeeScene.anchors, labelRank: zigbeeScene.labelRank, fit: zigbeeScene.FIT }),
  /** Its own settings keys (spec 11): paths, heard, returnRoutes, sourceRoute, with their legacy readings; the shell
   *  (ui/settings.js) keeps every other key. */
  settings,
});
