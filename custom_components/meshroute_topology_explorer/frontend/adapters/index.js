// SPDX-License-Identifier: MIT
// The data sources the panel reads, one adapter each (spec 3): ZHA for Zigbee and the
// Matter topology for Thread, in the order the network switch lists them and the first load prefers. The shell reaches
// an adapter only through this registry: by its key (the stored choice of the network switch, ui/network-switch.js) or
// by a network (adapterFor: the adapter whose key is the network's source). An adapter's capabilities travel on its
// networks (spec 4.6); here are its I/O: read, the phase of a blocked source, the device page, the scan and the
// observations, each null where the source has none. No DOM. npm test
import { adapter as zha } from "./zha.js";
import { adapter as matter } from "./matter.js";

/** Every adapter, in menu order. */
export const ADAPTERS = Object.freeze([zha, matter]);

/** The adapter of a key, or null. */
export function adapterByKey(key) {
  return ADAPTERS.find((a) => a.key === key) || null;
}

/** The adapter a network was read by (its source). Throws for a network of no known source: there is no default. */
export function adapterFor(network) {
  const found = network ? adapterByKey(network.source) : null;
  if (!found) throw new Error(`no adapter for the source ${JSON.stringify(network ? network.source ?? null : null)}`);
  return found;
}
