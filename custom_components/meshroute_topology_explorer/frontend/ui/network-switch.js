// SPDX-License-Identifier: MIT
// Which network the map shows, Zigbee (ZHA) or Thread (Matter): the choices, the shown one and the stored choice (spec 9.1,
// 11). The control that switches it is the status pill's menu (ui/status-pill.js). A network that cannot be read is a
// greyed entry with the reason. The choice is stored under the reserved network id PANEL_STORE through the integration's
// settings commands (spec 10, 11); settings of each network stay under its own id. The choice logic is pure and
// tested in Node: npm test
import { ADAPTERS } from "../adapters/index.js";
import { getStored, setStored } from "./store-client.js";

/** Networks the panel can show, in menu order: one per adapter (adapters/index.js); the keys are stored values. */
export const NETWORK_KEYS = Object.freeze(ADAPTERS.map((a) => a.key));
/** The first load shows the first adapter's network, Zigbee (spec 9.1). */
export const DEFAULT_NETWORK = NETWORK_KEYS[0];
/** Reserved network id for settings of the panel itself (the chosen network); valid under spec 10's id rule. */
export const PANEL_STORE = "panel";

/** Menu entries from the controller state: [{ key, available, reason?, message? }], in the adapters' order. A network
 *  is listed when it was read; a source that could not be used is listed greyed with its reason where its adapter
 *  says so (the Matter topology: not supported, empty or an error; ZHA: a read error, #15). */
export function networkChoices(state) {
  const networks = (state && state.networks) || {};
  const reads = (state && state.reads) || {};
  const out = [];
  for (const adapter of ADAPTERS) {
    const read = reads[adapter.key] || null;
    if (networks[adapter.key]) out.push({ key: adapter.key, available: true });
    else if (adapter.unavailable(read)) {
      out.push({ key: adapter.key, available: false, reason: read.status, message: read.message || null });
    }
  }
  return out;
}

/** The network to show: the wanted one if it can be shown, else the first that can; null if none. */
export function activeNetwork(choices, wanted) {
  const usable = choices.filter((c) => c.available);
  return (usable.find((c) => c.key === wanted) || usable.find((c) => c.key === DEFAULT_NETWORK) || usable[0] || {}).key || null;
}

/** The stored choice (one of NETWORK_KEYS), or null when none is stored or the store cannot be read. */
export async function loadNetworkChoice(callWS) {
  try {
    const stored = await getStored(callWS, "settings", PANEL_STORE);
    const value = stored && stored.network;
    return NETWORK_KEYS.includes(value) ? value : null;
  } catch {
    return null;
  }
}

/** Store the choice by read-merge-write (keys the panel does not know are kept); failures leave it in memory. */
export async function saveNetworkChoice(callWS, key) {
  try {
    const stored = await getStored(callWS, "settings", PANEL_STORE);
    await setStored(callWS, "settings", PANEL_STORE, { ...(stored && typeof stored === "object" ? stored : {}), network: key });
    return true;
  } catch {
    return false;
  }
}
