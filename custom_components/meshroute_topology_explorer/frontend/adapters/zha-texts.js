// SPDX-License-Identifier: MIT
// The ZHA adapter's texts: its blocked and empty states, its name in the network switch,
// its scan dialog, its device page link and the reload note. Merged into the panel's table by ui/i18n.js through adapters/index.js. Pure data. npm test

export const TEXTS = Object.freeze({
  "message.zha_not_loaded": "ZHA is not loaded. Set up the Zigbee Home Automation integration, then try again.",
  "message.no_devices": "ZHA has no devices yet. Pair a device, then try again.",
  "scan.title": "Scan the topology?",
  "scan.body_radio": "The coordinator asks every router for its neighbour and routing tables, one after another, about a second per table page. On a network of this size that takes several minutes, and the network carries extra traffic meanwhile.",
  "scan.body_auto": "ZHA does the same by itself, every 4 hours by default. Starting a scan cancels one that is already running.",
  "scan.body_follow": "The panel reads the tables again every 15 seconds for 2 minutes, then every minute up to 15 minutes. ZHA does not report when the scan is done, so the panel never says it is.",
  "scan.confirm": "Start scan",
  "scan.cancel": "Cancel",
  "ha.zha": "Zigbee info (ZHA)",
  "view.zha_reload_info": "Reloads the tables currently held by ZHA. It does not start a radio scan. ZHA reads the tables by itself, every 4 hours by default.",
  "source.zha": "Zigbee (ZHA)",
});
