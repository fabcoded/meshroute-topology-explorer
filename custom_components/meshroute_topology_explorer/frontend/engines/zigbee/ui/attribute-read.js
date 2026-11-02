// SPDX-License-Identifier: MIT
// Reading attribute values from a device, once, on the user's request (spec 1, 3.4): besides the topology scan this is the only thing the panel may cause radio traffic with. Never
// automatic, never a write, no reporting, no binding. ZHA's command `zha/devices/clusters/attributes/value` reads one
// attribute, uncached, and answers the value as text, "None" when the device gave none (home-assistant/core
// homeassistant/components/zha/websocket_api.py, websocket_read_zigbee_cluster_attributes; message shape as in
// home-assistant/frontend src/data/zha.ts readAttributeValue). Attributes are read one after another, so a sleepy or
// busy device is not flooded; the first timeout or error stops the rest, which would fail the same way.
// No DOM. npm test

/** How long one read may take before the panel stops waiting. A device that sleeps answers only when awake; ZHA's own
 *  request gives up earlier and then answers with an error. Own choice. */
export const READ_TIMEOUT_MS = 15000;

/** Read `attributes` (ids) of one cluster of one device, in order. ctx: { callWS, ieee, endpoint, cluster, direction
 *  ("in" | "out": ZHA's cluster_type), attributes, timeoutMs, timers ({ setTimeout, clearTimeout }), onResult(result)
 *  after each attribute, cancelled() (true once the dialog is closed: nothing more is sent) }. Resolves to the results
 *  in order: { id, state: "ok" | "none" | "error" | "timeout" | "skipped", value (text), message }. Never throws. */
export async function readAttributes(ctx) {
  const { callWS, ieee, endpoint, cluster, direction, attributes } = ctx;
  const timers = ctx.timers || globalThis;
  const timeoutMs = ctx.timeoutMs ?? READ_TIMEOUT_MS;
  const cancelled = ctx.cancelled || (() => false);
  const results = [];
  let stop = null;
  for (const id of attributes) {
    if (cancelled()) break;
    if (stop) {
      const skipped = { id, state: "skipped", value: null, message: stop };
      results.push(skipped);
      if (ctx.onResult) ctx.onResult(skipped);
      continue;
    }
    let timer = null;
    const timeout = new Promise((resolve) => { timer = timers.setTimeout(() => resolve({ timeout: true }), timeoutMs); });
    let result;
    try {
      const answer = await Promise.race([
        callWS({ type: "zha/devices/clusters/attributes/value", ieee, endpoint_id: endpoint, cluster_id: cluster,
          cluster_type: direction === "out" ? "out" : "in", attribute: id }).then((value) => ({ value })),
        timeout,
      ]);
      if (answer.timeout) {
        result = { id, state: "timeout", value: null, message: null };
        stop = "timeout";
      } else {
        const text = answer.value === null || answer.value === undefined ? "None" : String(answer.value);
        result = text === "None" ? { id, state: "none", value: null, message: null } : { id, state: "ok", value: text, message: null };
      }
    } catch (err) {
      const e = err && (err.error || err);
      result = { id, state: "error", value: null, message: (e && (e.message || e.code)) || String(err) };
      stop = "error";
    } finally {
      timers.clearTimeout(timer);
    }
    if (cancelled()) break; // the dialog is gone: the answer has nowhere to go
    results.push(result);
    if (ctx.onResult) ctx.onResult(result);
  }
  return results;
}
