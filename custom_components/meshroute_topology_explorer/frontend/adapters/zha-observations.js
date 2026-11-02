// SPDX-License-Identifier: MIT
// Observations (spec 6): ZHA publishes no scan time, so the panel keeps per router a fingerprint of its tables and
// the time a panel first saw it (zha-fingerprints.js), and stores them through the integration's commands
// meshroute_topology_explorer/observations/get and /set (spec 10; same contract as the settings: whole object,
// at most 256 KiB). "Observed unchanged since" is the newest of these times.
// Stored object: { routers: { <ieee>: { fingerprint, firstSeen } }, ...unknown keys kept }. Saves are debounced and
// read-merge-write per router: the same fingerprint keeps the earlier time (another panel saw it first), a different
// one is replaced by what this panel sees now. Stored data is untrusted input and cleaned before use. No DOM.
// Tested in Node: npm test
import { fingerprints, updateObservations, newestChange } from "./zha-fingerprints.js";
import { normalizeIeee } from "../model/parse.js";
import { MAX_BYTES, SAVE_DELAY_MS, StoreClient, setStored } from "../ui/store-client.js";

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
/** The model's fingerprint: 16 lower-case hex digits (zha-fingerprints.js). */
const FINGERPRINT = /^[0-9a-f]{16}$/;
/** A time as the panel writes it (Date.prototype.toISOString); anything else is dropped. */
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/** Router entries from untrusted input: a map without prototype, device keys only, valid fingerprint and time. */
export function sanitizeRouters(input) {
  const routers = Object.create(null);
  if (!isPlainObject(input)) return routers;
  for (const [key, entry] of Object.entries(input)) {
    const id = normalizeIeee(key);
    if (!id || !isPlainObject(entry)) continue;
    const { fingerprint, firstSeen } = entry;
    if (typeof fingerprint !== "string" || !FINGERPRINT.test(fingerprint)) continue;
    if (typeof firstSeen !== "string" || !ISO_TIME.test(firstSeen) || !Number.isFinite(Date.parse(firstSeen))) continue;
    routers[id] = { fingerprint, firstSeen };
  }
  return routers;
}

/** The stored object cleaned: known key "routers", unknown top-level keys kept (a newer version may use them). */
export function sanitizeObservations(input) {
  const src = isPlainObject(input) ? input : {};
  return { ...src, routers: sanitizeRouters(src.routers) };
}

/** Merge one router: the same fingerprint keeps the earlier time; a different one takes `mine` (what this panel sees
 *  now). */
function mergeEntry(stored, mine) {
  if (!stored) return mine;
  if (stored.fingerprint === mine.fingerprint) return stored.firstSeen < mine.firstSeen ? stored : mine;
  return mine;
}

/** Drop the routers with the oldest times until the serialized object fits; returns { object, dropped }. */
export function fitObservations(object, maxBytes = MAX_BYTES) {
  const size = (o) => new TextEncoder().encode(JSON.stringify(o)).length;
  if (size(object) <= maxBytes) return { object, dropped: 0 };
  const routers = { ...object.routers };
  const ids = Object.keys(routers).sort((a, b) => (routers[a].firstSeen < routers[b].firstSeen ? -1 : 1) || (a < b ? -1 : 1));
  let dropped = 0;
  let out = { ...object, routers };
  // One entry is about 90 bytes: drop in steps sized to the excess, then check again.
  while (ids.length && size(out) > maxBytes) {
    const step = Math.max(1, Math.ceil((size(out) - maxBytes) / 90));
    for (const id of ids.splice(0, step)) { delete routers[id]; dropped += 1; }
    out = { ...object, routers };
  }
  return { object: out, dropped };
}

/** The observed table fingerprints of one network in Home Assistant (storage modes: ui/store-client.js). */
export class ObservationsClient extends StoreClient {
  /** callWS: hass.callWS bound; network: network id; timers: { setTimeout, clearTimeout }; now(): ISO time;
   *  maxBytes: the size limit (spec 10), injectable for tests. */
  constructor({ callWS, network, timers = globalThis, delay = SAVE_DELAY_MS, now = () => new Date().toISOString(),
    maxBytes = MAX_BYTES } = {}) {
    super({ kind: "observations", callWS, network, timers, delay });
    this._now = now;
    this._maxBytes = maxBytes;
    this.routers = Object.create(null);
    this.dropped = 0; // routers dropped at the last save to stay under the size limit (shown in debug mode)
    this._changed = new Map(); // router id -> entry this panel recorded and has not saved yet
  }

  /** Read what is stored and lay this panel's unsaved observations over it. Never throws. */
  async load() {
    try {
      const stored = sanitizeObservations(await this._get());
      const routers = stored.routers;
      for (const [id, entry] of this._changed) routers[id] = mergeEntry(routers[id], entry);
      this.routers = routers;
      this._stored();
      if (this._changed.size) this._schedule();
    } catch (err) {
      this._unreadable(err);
    }
    this._emit();
    return this.routers;
  }

  /** Record the tables of a freshly read network: new or changed fingerprints get the time now. Returns the ids
   *  whose tables changed (or were seen for the first time). */
  observe(network) {
    const current = fingerprints(network);
    const { store, changed } = updateObservations(this.routers, current, this._now());
    if (!changed.length) return changed;
    const routers = Object.create(null);
    for (const [id, entry] of Object.entries(store)) routers[id] = entry;
    this.routers = routers;
    for (const id of changed) this._changed.set(id, routers[id]);
    this._schedule();
    this._emit();
    return changed;
  }

  /** Newest first-seen time among the devices whose tables the network has now (spec 6: "unchanged since"). */
  newest(network) {
    return newestChange(this.routers, Object.keys(fingerprints(network)));
  }

  /** When this panel or another first saw the current table of a device, or null. */
  firstSeen(id) {
    const entry = this.routers[id];
    return entry ? entry.firstSeen : null;
  }

  _pending() {
    return this._changed.size > 0;
  }

  /** Read, merge per router, fit to the size limit, write. */
  async _save() {
    const mine = this._changed;
    this._changed = new Map();
    const restore = () => { for (const [id, entry] of mine) if (!this._changed.has(id)) this._changed.set(id, entry); };
    try {
      const stored = sanitizeObservations(await this._get());
      for (const [id, entry] of mine) stored.routers[id] = mergeEntry(stored.routers[id], entry);
      const { object, dropped } = fitObservations({ ...stored, routers: { ...stored.routers } }, this._maxBytes);
      this.dropped = dropped;
      await setStored(this._callWS, "observations", this.network, object);
      // Adopt earlier times other panels recorded for the same tables, and routers this panel has not seen; a
      // different fingerprint stored by another panel is not taken over (this panel's view of its network decides).
      for (const [id, entry] of Object.entries(object.routers)) {
        const local = this.routers[id];
        if (!local || (local.fingerprint === entry.fingerprint && entry.firstSeen < local.firstSeen)) this.routers[id] = entry;
      }
      this.error = null;
    } catch (err) {
      restore();
      this._saveFailed(err);
    }
    this._emit();
  }
}
