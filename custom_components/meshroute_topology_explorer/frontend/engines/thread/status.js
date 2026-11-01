// SPDX-License-Identifier: MIT
// The status line of a Thread network (spec 3.2, 6; board Variant A): no router tables, no source-route stage and no
// completeness banner (every Matter node's table comes with the snapshot). No DOM: the panel translates the parts.
// node --test tests/

/** Status parts of a Thread network (spec 3.2, 6; board Variant A): the source, the coverage "Links with both
 *  directions: x/y" instead of router tables (every Matter node's table comes with the snapshot), when the Matter
 *  server collected the topology with its age (collected: { time, age }, formatted by the panel; its note says it was
 *  read from the cache), and "no border router listed" when the snapshot names none. */
export function threadParts(network, { collected = null, compact = false } = {}) {
  const s = network.status;
  const parts = compact ? [] : [["status.source", { source: "Thread (Matter)" }]];
  parts.push(compact ? ["status.short_thread_links", { x: s.linksBoth, y: s.links }, "status.thread_links"]
    : ["status.thread_links", { x: s.linksBoth, y: s.links }]);
  if (collected) {
    parts.push(compact ? ["status.short_thread_read", collected, "status.thread_read"]
      : ["status.thread_read", collected, "status.thread_read_note"]);
  }
  if (!s.borderRouters) parts.push(["status.thread_no_br", {}]);
  return parts;
}

/** The whole status line of the engine (engines/index.js): { parts, right: null, incomplete: null }. extras:
 *  { compact, collected } (the collection time and its age, formatted by the panel). */
export function statusLine(network, { compact = false, collected = null } = {}) {
  return { parts: threadParts(network, { collected, compact }), right: null, incomplete: null };
}
