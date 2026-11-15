// SPDX-License-Identifier: MIT
// The partitions the border routers advertise (#21, spec 3.2 "Partitions"): each border router's partition id as its
// border agent advertises it over mDNS (TXT key pt), from Home Assistant's cache (the integration's command
// thread_border_agents), and whether the border routers of the network advertise different ones. Different ids say
// either that the network is split into parts without radio contact, or that a border router is off and its last
// advertisement still stands in the cache (until its TTL ends; RFC 6762 10 recommends 75 minutes for TXT records).
// Nothing here tells the two apart, and equal ids prove nothing either: a part without a border router advertises
// nothing. Pure, no DOM. npm test
import { extAddress } from "./from-matter.js";

/** A partition id (Matter 0/53/9, a nullable uint32; the TXT key pt, 4 bytes): 0 to 2³²−1, else null. */
export const partitionId = (v) => (Number.isInteger(v) && v >= 0 && v <= 0xffffffff ? v : null);

/** When an advertisement was received, in epoch milliseconds: the answer's read time less the record's age (both in
 *  seconds), or null where either is unknown. */
function receivedAt(age, readAt) {
  const finite = (v) => typeof v === "number" && Number.isFinite(v);
  return finite(age) && age >= 0 && finite(readAt) ? (readAt - age) * 1000 : null;
}

/** Per extended address the newest advertisement of network `pan` in the answer of thread_border_agents: { partition
 *  (null where the record names none), at (receivedAt) }. A record of known time wins over one of unknown time; of
 *  two known, the later. Records of another extended PAN id (compared in one case) are left out. */
function newestByAddress(answer, pan) {
  const out = new Map();
  const agents = answer && Array.isArray(answer.agents) ? answer.agents : [];
  for (const a of agents) {
    const address = a && typeof a.ext_pan_id === "string" && pan && a.ext_pan_id.toLowerCase() === pan
      ? extAddress(a.ext_address) : null;
    if (!address) continue;
    const next = { partition: partitionId(a.partition_id), at: receivedAt(a.age, answer.read_at) };
    const had = out.get(address);
    if (!had || (next.at !== null && (had.at === null || next.at > had.at))) out.set(address, next);
  }
  return out;
}

/** Whether advertisement `x` takes part in a statement: a partition id from a record of known time. */
const counts = (x) => Boolean(x && x.partition !== null && x.at !== null);

/** Set each device's `advertised` (a border router's newest advertisement with a partition id: { partition, at }, else
 *  null; the record is matched by its extended address within the network's extended PAN id `pan`) and return the
 *  network's statement: { count, oldestAt } where its border routers advertise two or more different partition ids,
 *  counting only advertisements of known time (count: how many ids, oldestAt: the oldest such advertisement), else
 *  null. answer: the answer of thread_border_agents, or null. */
export function advertisedPartitions(devices, answer, pan) {
  const newest = newestByAddress(answer, pan);
  for (const d of devices) {
    const x = d.role === "border router" && d.extAddress ? newest.get(d.extAddress) : null;
    d.advertised = x && x.partition !== null ? x : null;
  }
  const used = devices.map((d) => d.advertised).filter(counts);
  const ids = new Set(used.map((x) => x.partition));
  return ids.size < 2 ? null : { count: ids.size, oldestAt: Math.min(...used.map((x) => x.at)) };
}

/** The other border routers whose advertisement names the same partition as `device`'s (at a known time or not):
 *  their ids, or null where `device`'s own advertisement takes part in no statement. */
export function sharingPartition(network, device) {
  if (!counts(device.advertised)) return null;
  return network.devices.filter((d) => d !== device && d.advertised
    && d.advertised.partition === device.advertised.partition).map((d) => d.id);
}
