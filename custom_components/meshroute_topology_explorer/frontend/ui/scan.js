// SPDX-License-Identifier: MIT
// Following a topology scan (spec 6): the user starts it in debug mode; the panel sends zha/topology/update without
// waiting (ZHA never answers it), then reads zha/devices again every 15 s for 2 minutes and every 60 s up to
// 15 minutes, counting the tables that changed since the start. It never claims the scan finished: ZHA does not say,
// and a table that did not change may have been answered too. No DOM; timers and clock injectable.
// Tested in Node: node --test tests/
import { fingerprints } from "../model/index.js";

/** Re-read schedule of spec 6, in ms after the start. */
export const SCAN_SCHEDULE = Object.freeze({ fastEvery: 15000, fastUntil: 120000, slowEvery: 60000, stopAt: 900000 });

/** The re-read times after the start: 15, 30, ... 120 s, then 180, 240, ... 900 s. */
export function readTimes(schedule = SCAN_SCHEDULE) {
  const times = [];
  for (let t = schedule.fastEvery; t <= schedule.fastUntil; t += schedule.fastEvery) times.push(t);
  for (let t = schedule.fastUntil + schedule.slowEvery; t <= schedule.stopAt; t += schedule.slowEvery) times.push(t);
  return times;
}

/** Tables changed since the start, over the available routers (the coordinator is not counted, as in the status
 *  line's "tables x of y"). A router counts as changed when its table's fingerprint differs from the one at the
 *  start, including a router that had no table then and has one now. */
export function changedTables(baseline, network) {
  const now = fingerprints(network);
  const routers = network.devices.filter((d) => d.role === "router" && d.available);
  const changed = routers.filter((d) => now[d.id] && now[d.id] !== baseline[d.id]).length;
  return { changed, total: routers.length };
}

/** Whether two networks differ in what the map shows from the tables: fingerprints and availability. A re-read
 *  that changes neither is not handed to the map (no new layout every 15 s). */
export function tablesDiffer(a, b) {
  if (!a || !b) return true;
  const key = (n) => JSON.stringify([fingerprints(n), n.devices.map((d) => [d.id, d.available]).sort()]);
  return key(a) !== key(b);
}

/** States: "idle", "running", "stopped" (by the user or the panel leaving), "ended" (15 minutes over),
 *  "not-sent" (the command could not be sent: no connection). Events: "change" after every step, "read" with
 *  detail { network } after each successful re-read. */
export class ScanFollower extends EventTarget {
  /** send(): sends the scan command, may throw if there is no connection; read(): resolves to a Network or null;
   *  timers: { setTimeout, clearTimeout }; now(): ms. */
  constructor({ send, read, timers = globalThis, now = () => Date.now(), schedule = SCAN_SCHEDULE }) {
    super();
    this._send = send;
    this._read = read;
    this._timers = timers;
    this._now = now;
    this._times = readTimes(schedule);
    this.state = { status: "idle", startedAt: null, reads: 0, failedReads: 0, changed: 0, total: 0, message: null };
    this._timer = null;
    this._token = 0;
  }

  get running() { return this.state.status === "running"; }

  /** Start a scan from the network on screen (its tables are the baseline). Ignored while one runs. */
  start(network) {
    if (this.running) return;
    this._baseline = fingerprints(network);
    const { total } = changedTables(this._baseline, network);
    const token = ++this._token;
    try {
      this._send();
    } catch (err) {
      this._set({ status: "not-sent", startedAt: null, reads: 0, failedReads: 0, changed: 0, total,
        message: String((err && (err.message || (err.error && err.error.message))) || err) });
      return;
    }
    this._set({ status: "running", startedAt: this._now(), reads: 0, failedReads: 0, changed: 0, total, message: null });
    this._next(token, 0);
  }

  /** Stop following (the scan itself goes on in ZHA; it cannot be cancelled). */
  stop() {
    if (!this.running) return;
    this._clear();
    this._token += 1;
    this._set({ status: "stopped" });
  }

  /** Forget a stopped or ended scan (its line leaves the status line). */
  clear() {
    if (this.running) return;
    this._set({ status: "idle", startedAt: null, reads: 0, failedReads: 0, changed: 0, total: 0, message: null });
  }

  _next(token, index) {
    if (index >= this._times.length) {
      this._set({ status: "ended" });
      return;
    }
    const delay = Math.max(0, this._times[index] - (this._now() - this.state.startedAt));
    this._timer = this._timers.setTimeout(() => this._tick(token, index), delay);
  }

  async _tick(token, index) {
    this._timer = null;
    let network = null;
    try { network = await this._read(); } catch { network = null; }
    if (token !== this._token) return; // stopped meanwhile
    if (network) {
      const { changed, total } = changedTables(this._baseline, network);
      this._set({ reads: this.state.reads + 1, changed, total });
      this.dispatchEvent(Object.assign(new Event("read"), { detail: { network } }));
    } else {
      // A failed read (connection lost, ZHA busy) is skipped; the schedule goes on.
      this._set({ reads: this.state.reads + 1, failedReads: this.state.failedReads + 1 });
    }
    this._next(token, index + 1);
  }

  _clear() {
    if (this._timer !== null) this._timers.clearTimeout(this._timer);
    this._timer = null;
  }

  _set(patch) {
    this.state = { ...this.state, ...patch };
    this.dispatchEvent(new Event("change"));
  }
}
