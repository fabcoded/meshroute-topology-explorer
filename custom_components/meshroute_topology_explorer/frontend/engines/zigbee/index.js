// SPDX-License-Identifier: MIT
// The Zigbee viewer engine (engines/index.js): what a Zigbee network means (spec 3.1, 4, 5, 7.1). The object gathers
// the engine's modules (from-zha.js and model.js with the derived facts, lanes.js, scene.js, options.js, settings.js,
// status.js, connection.js, texts.js, the Details in ui/); every hook has a caller in the shell, and both engines offer
// the same hooks.
// Pure except details(), which fills the Details tab. npm test
import { buildNetwork } from "./model.js";
import { FINDING_KINDS } from "./findings.js";
import { laneValue, legendEntries, springQuality } from "./lanes.js";
import { unknownGlyph } from "../unknown-reason.js";
import { renderDetails } from "./ui/details-tab.js";
import { openClusterDialog } from "./ui/cluster-dialog.js";
import { findingText } from "./ui/finding-text.js";
import { connection } from "./connection.js";
import { zigbeeOptions } from "./options.js";
import { statusLine } from "./status.js";
import { settings } from "./settings.js";
import * as zigbeeScene from "./scene.js";
import { TEXTS } from "./texts.js";

export const zigbee = Object.freeze({
  key: "zigbee",
  /** Network from the answer of `zha/devices` and the registries (model/index.js buildNetwork). */
  build: (payload, options = {}) => buildNetwork(payload, options),
  /** The value under "RX:" of a direction: the raw LQI, "Parent" or "Route" where only they imply it, else a glyph. */
  laneValue,
  /** "–" where the hearer's table was read and does not list the sender, "?" where there is no table to ask. */
  unknownGlyph,
  /** A reading's quality 0..1 for the layout's springs (LQI / 255), or null for no spring. */
  springQuality,
  /** The link rows of the legend (spec 9.1): every path class with the stage or option that draws it. */
  legend: (theme, view = {}) => legendEntries(theme, view),
  /** The status line (spec 6): { parts, right (the source-route stage), incomplete ({ x, y } or null), level ("ok" or "warn": the pill's dot) }. */
  status: (network, extras = {}) => statusLine(network, extras),
  /** Its finding kinds in the order the Findings tab groups them (findings.js), and the words of a finding:
   *  { title, lines }. */
  findings: Object.freeze({ kinds: FINDING_KINDS, text: findingText }),
  /** What a user may type to find a device by its network address (Devices search): "0x1234 4660", or none. */
  addresses: (device) => (typeof device.nwk === "number"
    ? [`0x${device.nwk.toString(16).padStart(4, "0")} ${device.nwk}`] : []),
  /** The grey line's connection of a device in the Devices list (spec 9.1), or null. */
  connection,
  /** Fill the Details tab (three sub-tabs, spec 9.2). ctx: the panel's Details context; the paths follow
   *  this engine's own settings (paths, returnRoutes, sourceRoute); a cluster's details open as a dialog through the
   *  panel's ctx.openDialog(open(host)). */
  details: (container, ctx) => renderDetails(container, { ...ctx, stage: ctx.settings.paths,
    returnRoutes: ctx.settings.returnRoutes, sourceRoute: ctx.settings.sourceRoute,
    onCluster: (spec, opener) => {
      const device = ctx.network.devices.find((d) => d.id === ctx.id);
      if (device) {
        ctx.openDialog((host) => openClusterDialog({ ...host, t: ctx.t, device, ...spec, opener,
          devicePage: ctx.devicePage, radioActions: ctx.radioActions }));
      }
    } }),
  /** The View tab's Zigbee groups as data (OptionGroup[], ui/view-tab.js): communication paths, path display, return
   *  paths without a table entry. */
  options: zigbeeOptions,
  /** What its map draws (graph/renderer.js): lanes and classify once per scene, then per view the overview's look
   *  of every lane and the focus of a selected or hovered device (scene.js). classes: the counters of the drawn
   *  lanes; anchors: always labelled (the coordinator); labelRank: label order; fit: how the fitted view frames the
   *  map ("base": at density factor 1). */
  scene: Object.freeze({ lanes: zigbeeScene.lanes, classify: zigbeeScene.classify, viewKey: zigbeeScene.viewKey,
    overview: zigbeeScene.overview, focus: zigbeeScene.focus, classes: zigbeeScene.CLASSES,
    anchors: zigbeeScene.anchors, labelRank: zigbeeScene.labelRank, fit: zigbeeScene.FIT }),
  /** The path history window (ui/history-window.js): routes are walked from the routing tables; LQI 0 to 255. */
  history: Object.freeze({ walks: true, lqiMax: 255, entryText: null }),
  /** Its own words (texts.js), merged into the panel's table by ui/i18n.js. */
  texts: TEXTS,
  /** Its own settings keys (spec 11): paths, heard, returnRoutes, sourceRoute, with their legacy readings; the shell
   *  (ui/settings.js) keeps every other key. */
  settings,
});
