// SPDX-License-Identifier: MIT
// The ZHA adapter's texts (engines cut step 9): its blocked and empty states, its name in the network switch,
// its scan dialog, its device page link and the reload note. English is the reference; the dormant German table moves
// along. Merged into the panel's tables by ui/i18n.js through adapters/index.js. Pure data. npm test

const en = {
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
};

const de = {
  "message.zha_not_loaded": "ZHA ist nicht geladen. Richte die Integration Zigbee Home Automation ein und versuche es dann erneut.",
  "message.no_devices": "ZHA hat noch keine Geräte. Kopple ein Gerät und versuche es dann erneut.",
  "scan.title": "Topologie scannen?",
  "scan.body_radio": "Der Koordinator fragt jeden Router nacheinander nach seiner Nachbar- und Routing-Tabelle, etwa eine Sekunde je Tabellenseite. Bei einem Netz dieser Größe dauert das einige Minuten, und das Netz trägt so lange zusätzlichen Funkverkehr.",
  "scan.body_auto": "ZHA macht das auch selbst, standardmäßig alle 4 Stunden. Ein neuer Scan bricht einen laufenden ab.",
  "scan.body_follow": "Das Panel liest die Tabellen 2 Minuten lang alle 15 Sekunden neu, danach jede Minute bis 15 Minuten. ZHA meldet nicht, wann der Scan fertig ist, deshalb sagt das Panel es auch nie.",
  "scan.confirm": "Scan starten",
  "scan.cancel": "Abbrechen",
  "ha.zha": "Zigbee-Infos (ZHA)",
  "view.zha_reload_info": "ZHA liest die Tabellen selbst, standardmäßig alle 4 Stunden.",
};

/** { en, de }: the tables, frozen. */
export const TEXTS = Object.freeze({ en: Object.freeze(en), de: Object.freeze(de) });
