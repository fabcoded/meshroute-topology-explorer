// SPDX-License-Identifier: MIT
// The Thread engine's texts: the status line's link coverage and collection time, the
// legend's parent and neighbour rows, the Details' Thread facts, the border router and end device roles. Merged into the panel's table by ui/i18n.js through
// engines/index.js; every key the Thread engine emits resolves in the shared table or here
// (tests/engine-leaks.test.mjs 13). Pure data. npm test

export const TEXTS = Object.freeze({
  "role.end device": "End device",
  "role.border router": "Border router",
  "legend.symbol_end": "Closed frame: end device",
  "legend.symbol_end_sleepy": "Closed frame, bed: end device, sleeps",
  "status.thread_links": "Links with both directions: {x}/{y}",
  "status.short_thread_links": "Both directions {x}/{y}",
  "status.thread_read": "read {time} ({age})",
  "status.short_thread_read": "read {time}",
  "status.thread_read_note": "Time the Matter server collected the topology. Read from its cache: no radio traffic.",
  "status.thread_no_br": "no border router listed",
  "view.thread_paths_note": "Thread data names neighbours and parents, not routes; there are no path views.",
  "legend.link.parent": "Parent link: end device and its parent",
  "legend.link.neighbour": "Neighbour (measured, from the neighbour table); no route data for Thread",
  "legend.link.no-table-thread": "No reception value in this direction: no table to ask (border router or a node not read). This alone does not indicate a weak link.",
  "legend.rx_thread": "Number in the line = reception at the arrowhead, as reported by the receiver: RSSI in dBm; link quality (LQI 0–3) where no RSSI was reported.",
  "evidence.thread_no_parent": "The topology lists no link between this end device and a router.",
  "details.thread_title": "Neighbours (Thread)",
  "details.thread_note": "From the neighbour tables in the Matter server's snapshot. Thread data has no routes, so no paths are shown.",
  "details.thread_hears": "hears {name}: {value}",
  "details.thread_heard_by": "heard by {name}: {value}",
  "details.thread_none": "No neighbour listed.",
  "details.thread_parent": "Parent: {name}",
  "details.thread_role": "Thread role: {role}",
  "details.thread_ext": "Extended address: {value}",
  "details.thread_rloc": "RLOC16: {value}",
  "details.thread_node": "Matter node id: {value}",
  "details.thread_availability_unknown": "Availability not reported (border routers are found by mDNS, not by Matter).",
  "details.thread_leader": "Thread leader",
  "details.thread_unknown": "not reported",
  "details.thread_stale": "Unavailable: its last known readings are not drawn.",
});
