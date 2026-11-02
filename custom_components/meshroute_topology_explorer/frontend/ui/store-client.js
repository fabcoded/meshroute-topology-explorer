// SPDX-License-Identifier: MIT
// What the three clients of the integration's storage commands share (spec 10): the two commands per kind
// (<kind>/get and /set, whole object per network id), the size limit, and the base client
// with the debounced save, the classification of a failed read and the pending-change bookkeeping. The settings
// (ui/settings.js) and the observations (adapters/zha-observations.js) extend it; the chosen network
// (ui/network-switch.js) uses the two command helpers. No DOM. npm test
import { errorText, isConnectionLost } from "../adapters/ws.js";

/** The integration rejects larger payloads (spec 10); checked by the clients so the user learns why nothing is saved. */
export const MAX_BYTES = 256 * 1024;
/** Saves wait for this long after the last change, so a burst of changes becomes one write. Own choice. */
export const SAVE_DELAY_MS = 1000;

/** The integration's own commands per kind, as plain literals (tools/guard.py checks every command against its list). */
const COMMANDS = Object.freeze({
  settings: Object.freeze({ get: "meshroute_topology_explorer/settings/get", set: "meshroute_topology_explorer/settings/set" }),
  observations: Object.freeze({ get: "meshroute_topology_explorer/observations/get",
    set: "meshroute_topology_explorer/observations/set" }),
});

/** The stored object of one kind ("settings" or "observations") of a network, or null when never set. */
export async function getStored(callWS, kind, network) {
  const answer = await callWS({ type: COMMANDS[kind].get, network });
  return answer && answer[kind];
}

/** Replace the stored object of one kind of a network. */
export function setStored(callWS, kind, network, value) {
  return callWS({ type: COMMANDS[kind].set, network, [kind]: value });
}

/** Storage modes: "loading"; "stored" (in Home Assistant); "memory" with reason "unauthorized", "offline" (the
 *  connection was lost: read again on reconnect) or "unreadable" (reading failed, so saving would overwrite what is
 *  stored). A subclass sets `kind`, implements _pending() (whether anything awaits saving) and _save(), and calls
 *  _schedule() after a change. Events: "change". */
export class StoreClient extends EventTarget {
  /** kind: "settings" | "observations"; callWS: hass.callWS bound; network: network id; timers: { setTimeout,
   *  clearTimeout } (injectable). */
  constructor({ kind, callWS, network, timers = globalThis, delay = SAVE_DELAY_MS }) {
    super();
    this.kind = kind;
    this._callWS = callWS;
    this.network = network;
    this._timers = timers;
    this._delay = delay;
    this.mode = "loading";
    this.reason = null;
    this.error = null; // last problem: { kind: "error" | "too-large", message, bytes, connection }
    this._timer = null;
    this._saving = null;
  }

  /** Whether reading again may help: the first read met a lost connection. */
  get retryable() { return this.mode === "memory" && this.reason === "offline"; }

  _get() { return getStored(this._callWS, this.kind, this.network); }

  /** Leave "loading" after a successful read. */
  _stored() {
    this.mode = "stored";
    this.reason = null;
    this.error = null;
  }

  /** Fall back to memory after a failed read and say why. */
  _unreadable(err) {
    this.mode = "memory";
    this.reason = err && err.code === "unauthorized" ? "unauthorized" : isConnectionLost(err) ? "offline" : "unreadable";
    this.error = this.reason === "unreadable" ? { kind: "error", message: errorText(err) } : null;
  }

  /** A failed save: the changes stay pending and go out with the next change, flush or reconnect. */
  _saveFailed(err) {
    this.error = { kind: "error", message: errorText(err), connection: isConnectionLost(err) };
  }

  _schedule() {
    if (this.mode !== "stored") return; // changes are still tracked and go out after a successful read
    if (this._timer !== null) this._timers.clearTimeout(this._timer);
    this._timer = this._timers.setTimeout(() => { this._timer = null; this.flush(); }, this._delay);
  }

  /** Save now if anything is pending (the panel is hidden, the page goes away). */
  async flush() {
    if (this._timer !== null) this._timers.clearTimeout(this._timer);
    this._timer = null;
    if (!this._pending() || this.mode !== "stored") return;
    if (this._saving) await this._saving;
    if (!this._pending() || this.mode !== "stored") return;
    this._saving = this._save().finally(() => { this._saving = null; });
    await this._saving;
  }

  /** Stop the timer without saving (the panel is torn down for good). */
  dispose() {
    if (this._timer !== null) this._timers.clearTimeout(this._timer);
    this._timer = null;
  }

  _emit() {
    this.dispatchEvent(new Event("change"));
  }
}
