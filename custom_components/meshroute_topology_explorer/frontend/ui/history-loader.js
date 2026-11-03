// SPDX-License-Identifier: MIT
// Loads the reception history for the path history window and the Details sparklines (spec 9.5, 10.2): the admin
// commands records (one range) and info (recording on or off, how long records are kept, the last
// problem), the histories cached per network and range, and the state the UI shows. Pure but for the injected
// callWS. npm test
import { createHistoryCache, historyFor, RANGES } from "../engines/index.js";

/** Ranges in display order. */
export const RANGE_KEYS = Object.freeze(Object.keys(RANGES));
/** A loaded range is read again after this long (records keep arriving while the panel is open). Own choice. */
export const MAX_AGE_S = 300;
/** Records below this count draw points only (board M35: "fewer than 3 records"). */
export const MIN_LINE_RECORDS = 3;

/** The ranges the window offers: those the kept days hold ("Keep for", spec 10.1), at least 48 h; unknown keeps all. */
export function rangesFor(keepDays) {
  if (!Number.isFinite(keepDays)) return [...RANGE_KEYS];
  return RANGE_KEYS.filter((k, i) => i === 0 || RANGES[k] <= keepDays * 86400);
}

/** A loader for one panel. callWS: hass.callWS bound; network(): the shown network (id, engine, `live` for Zigbee);
 *  now(): epoch seconds. get(range) resolves { state, history, info, error }: state "ok", "sparse" (1 or 2 records),
 *  "empty" (no record, recording on), "off" (no record, recording off), "unsupported" (no record, the source reported a
 *  problem: info.lastError) or "failed" (a command was refused). `info` = { record, keepDays, lastError } with null
 *  for fields an older integration does not send. */
export function createLoader({ callWS, network, now = () => Date.now() / 1000, cache = createHistoryCache() }) {
  let infoPromise = null;
  const readInfo = () => {
    if (!infoPromise) {
      infoPromise = callWS({ type: "meshroute_topology_explorer/history/info" }).then((a) => ({
        record: typeof a.record === "boolean" ? a.record : null,
        keepDays: Number.isFinite(a.keep_days) ? a.keep_days : null,
        lastError: typeof a.last_error === "string" && a.last_error ? a.last_error : null }))
        .catch((error) => { infoPromise = null; throw error; });
    }
    return infoPromise;
  };
  const read = async (range) => {
    const net = network();
    const until = now();
    const [response, info] = await Promise.all([
      callWS({ type: "meshroute_topology_explorer/history/records", network: net.id, since: until - RANGES[range], until }),
      readInfo().catch(() => ({ record: null, keepDays: null, lastError: null }))]);
    const history = historyFor(net, response);
    const n = history.snapshots.length;
    const state = n >= MIN_LINE_RECORDS ? "ok" : n ? "sparse" : info.lastError ? "unsupported" : info.record === false ? "off" : "empty";
    return { state, history, info, error: null };
  };
  return {
    /** The history of a range (cached per network and range for MAX_AGE_S). */
    async get(range) {
      const id = network().id;
      const hit = cache.get(id, range);
      if (hit && now() - hit.at < MAX_AGE_S) return hit.result;
      let result;
      try { result = await read(range); } catch (err) {
        return { state: "failed", history: null, info: null, error: err && err.message ? err.message : String(err ?? "error") };
      }
      cache.set(id, range, { at: now(), result });
      return result;
    },
    /** The info alone (for the window's range list before anything is loaded). */
    info: () => readInfo().catch(() => ({ record: null, keepDays: null, lastError: null })),
    /** Forget what was loaded: a new capture, a changed recording. */
    clear() { cache.clear(); infoPromise = null; },
  };
}
