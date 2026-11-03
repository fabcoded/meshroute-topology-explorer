// SPDX-License-Identifier: MIT
// Test helper (not a test file) of the path history UI tests: the committed ZHA sample network with its live input and
// the committed history sample as a records answer, and a callWS that answers the history commands like the
// integration does (rows inside the asked range, the first one full).
import { readFileSync } from "node:fs";
import { ENGINES } from "../custom_components/meshroute_topology_explorer/frontend/engines/index.js";

const read = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8"));

/** { network (Zigbee engine, with `live` as adapters/zha.js attaches it), response (history/records of the whole sample),
 *  last (time of the newest record) }. */
export function sampleHistory() {
  const zha = read("zha-sample.json").responses;
  const live = { rawDevices: zha["zha/devices"], deviceRegistry: zha["config/device_registry/list"],
    areaRegistry: zha["config/area_registry/list"], configEntries: zha["config_entries/get"] };
  const network = ENGINES.zigbee.build(zha["zha/devices"], live);
  network.live = live;
  const response = read("zha-history-sample.json");
  return { network, response, last: Math.max(...response.records.filter((r) => Number.isFinite(r.t)).map((r) => r.t)) };
}

/** callWS of the history commands over `response`; `info` = fields of history/info. Returns { callWS, calls }. */
export function callWsFor(response, info) {
  const calls = [];
  const callWS = async (msg) => {
    calls.push(msg);
    if (msg.type.endsWith("/history/info")) return { records: response.records.length, bytes: 0, first: null, last: null, ...info };
    if (!msg.type.endsWith("/history/records")) throw { code: "unknown_command", message: msg.type };
    let full = null;
    const records = [];
    for (const r of response.records) {
      if (r.e) full = r;
      if (r.t < msg.since || r.t > msg.until) continue;
      records.push(!records.length && !r.e && full ? { ...full, t: r.t } : r);
    }
    return { k: response.k, records };
  };
  return { callWS, calls };
}
