// SPDX-License-Identifier: MIT
// The partitions the border routers advertise over mDNS (#21): the records of thread_border_agents matched to the
// map's border routers, and whether these advertise different ones. Rules and limits: spec 3.2 "Partitions". Pure,
// no DOM. npm test
import { extAddress } from "./from-matter.js";

/** A partition id (Matter 0/53/9; TXT key pt): 0 to 2³²−1, else null. */
export const partitionId = (v) => (Number.isInteger(v) && v >= 0 && v <= 0xffffffff ? v : null);
/** Whether advertisement `x` takes part in a statement: a partition id received at a known time. */
const counts = (x) => Boolean(x && x.partition !== null && x.at !== null);

/** Per extended address its newest record { partition, at, pan }: at = read_at less the age in epoch ms, null unless
 *  a valid Date (±8.64e15 ms), so NaN, Infinity or an absurd age has no time; a time beats none. */
function newestByAddress(answer) {
  const newest = new Map();
  for (const a of answer && Array.isArray(answer.agents) ? answer.agents : []) {
    const address = a ? extAddress(a.ext_address) : null;
    const ms = typeof answer.read_at === "number" && typeof a?.age === "number" && a.age >= 0
      ? (answer.read_at - a.age) * 1000 : Number.NaN;
    const at = Math.abs(ms) <= 8.64e15 ? ms : null;
    const had = address && newest.get(address);
    if (address && (!had || (at !== null && (had.at === null || at > had.at)))) {
      newest.set(address, { partition: partitionId(a.partition_id), at, pan: String(a.ext_pan_id).toLowerCase() });
    }
  }
  return newest;
}

/** Set each border router's `advertised` ({ partition, at } from its newest record, where that record is of network
 *  `pan` and names a partition id; else null) and return { count, oldestAt } where two or more different ids are
 *  advertised at known times, else null. answer: thread_border_agents' answer, or null. */
export function advertisedPartitions(devices, answer, pan) {
  const newest = newestByAddress(answer);
  for (const d of devices) {
    const x = d.role === "border router" && d.extAddress ? newest.get(d.extAddress) : null;
    d.advertised = x && x.pan === pan && x.partition !== null ? { partition: x.partition, at: x.at } : null;
  }
  const used = devices.map((d) => d.advertised).filter(counts);
  const ids = new Set(used.map((x) => x.partition));
  return ids.size < 2 ? null : { count: ids.size, oldestAt: Math.min(...used.map((x) => x.at)) };
}

/** The other border routers advertising `device`'s partition (at a known time or not), or null where `device`'s own
 *  advertisement takes part in no statement. */
export function sharingPartition(network, device) {
  if (!counts(device.advertised)) return null;
  return network.devices.filter((d) => d !== device && d.advertised?.partition === device.advertised.partition)
    .map((d) => d.id);
}
