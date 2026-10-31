// SPDX-License-Identifier: MIT
// Settings per network (spec 11) and the client that stores them through the integration's own websocket commands
// (spec 10): meshroute_topology_explorer/settings/get answers { settings: object | null }, /settings/set takes the
// whole object and answers {}. Saves are debounced; if the integration does not know the commands (an older version)
// the settings live in memory and the Settings tab says so. No DOM. Tested in Node: node --test tests/
import { DENSITY } from "../graph/layout.js";
import { FILLS } from "../graph/palette.js";
import { errorText, isConnectionLost } from "./controller.js";

/** Defaults of spec 11. openDetailsOnSelect null means "by screen width" (on for wide, off for narrow, spec 9.2). */
export const DEFAULTS = Object.freeze({ view: "quality", density: "medium", fill: "reception", openDetailsOnSelect: null,
  pins: Object.freeze({}) });
export const DENSITY_NAMES = Object.freeze(Object.keys(DENSITY)); // dense, medium, spread
/** The integration rejects larger payloads (spec 10); checked here so the user learns why nothing is saved. */
export const MAX_BYTES = 256 * 1024;
/** Saves wait for this long after the last change, so a burst of changes (dragging pins, trying densities) becomes
 *  one write. Own choice. */
export const SAVE_DELAY_MS = 1000;
/** Pins are stored in base lengths (graph-view.js) rounded to this many decimals: a thousandth of a base length is
 *  far below a pixel, and short numbers keep the stored object small. */
const PIN_DECIMALS = 3;

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const round = (v) => Math.round(v * 10 ** PIN_DECIMALS) / 10 ** PIN_DECIMALS;

/** A valid settings object from whatever was stored: known keys with wrong values fall back to the defaults, broken
 *  pins are dropped, unknown keys are kept as they are (a newer version may have written them, and a save replaces
 *  the whole object, so dropping them would erase its settings). */
export function sanitizeSettings(input) {
  const src = isPlainObject(input) ? input : {};
  const out = { ...src };
  out.view = src.view === "quality" ? "quality" : DEFAULTS.view; // the only view of v1; the route view comes in v1.1
  out.density = DENSITY_NAMES.includes(src.density) ? src.density : DEFAULTS.density;
  out.fill = FILLS.includes(src.fill) ? src.fill : DEFAULTS.fill;
  out.openDetailsOnSelect = typeof src.openDetailsOnSelect === "boolean" ? src.openDetailsOnSelect : null;
  const pins = {};
  if (isPlainObject(src.pins)) {
    for (const [id, p] of Object.entries(src.pins)) {
      if (Array.isArray(p) && p.length === 2 && p.every((v) => typeof v === "number" && Number.isFinite(v))) pins[id] = [p[0], p[1]];
    }
  }
  out.pins = pins;
  return out;
}

/** Stored pins { id: [x, y] } as the graph view takes them: Map id -> { x, y } in base lengths. */
export function pinsForView(pins) {
  return new Map(Object.entries(pins || {}).map(([id, [x, y]]) => [id, { x, y }]));
}

/** Whether the server said it does not know the command (Home Assistant's websocket error "unknown_command"). */
export function isUnknownCommand(err) {
  const e = err && (err.error || err);
  return Boolean(e) && e.code === "unknown_command";
}

/** Storage modes: "loading"; "stored" (in Home Assistant); "memory" with reason "unsupported" (the integration lacks
 *  the commands), "unauthorized" or "unreadable" (reading failed, so saving would overwrite what is stored). */
export class SettingsClient extends EventTarget {
  /** callWS: hass.callWS bound; network: network id; timers: { setTimeout, clearTimeout } (injectable). */
  constructor({ callWS, network, timers = globalThis, delay = SAVE_DELAY_MS } = {}) {
    super();
    this._callWS = callWS;
    this.network = network;
    this._timers = timers;
    this._delay = delay;
    this.settings = sanitizeSettings(null);
    this.mode = "loading";
    this.reason = null;
    this.error = null; // last save problem: { kind: "error" | "too-large", message, bytes }
    this._timer = null;
    this._dirty = false;
    this._saving = null;
  }

  /** Read the stored settings. Never throws; falls back to memory and says why. */
  async load() {
    try {
      const answer = await this._callWS({ type: "meshroute_topology_explorer/settings/get", network: this.network });
      this.settings = sanitizeSettings(answer && answer.settings);
      this.mode = "stored";
      this.reason = null;
    } catch (err) {
      this.mode = "memory";
      this.reason = isUnknownCommand(err) ? "unsupported" : err && (err.code === "unauthorized") ? "unauthorized" : "unreadable";
      this.error = this.reason === "unreadable" ? { kind: "error", message: errorText(err) } : null;
    }
    this._changed();
    return this.settings;
  }

  /** Merge a patch into the settings and schedule a save. */
  update(patch) {
    this.settings = sanitizeSettings({ ...this.settings, ...patch });
    this._schedule();
    this._changed();
  }

  setPin(id, x, y) {
    this.update({ pins: { ...this.settings.pins, [id]: [round(x), round(y)] } });
  }

  removePin(id) {
    if (!(id in this.settings.pins)) return;
    const pins = { ...this.settings.pins };
    delete pins[id];
    this.update({ pins });
  }

  clearPins() {
    if (Object.keys(this.settings.pins).length) this.update({ pins: {} });
  }

  /** Save now if anything is pending (the panel is hidden, or the connection came back). */
  async flush() {
    if (this._timer !== null) this._timers.clearTimeout(this._timer);
    this._timer = null;
    if (!this._dirty || this.mode !== "stored") return;
    if (this._saving) await this._saving;
    if (!this._dirty) return;
    this._saving = this._save().finally(() => { this._saving = null; });
    await this._saving;
  }

  /** Stop the timer without saving (the panel is torn down for good). */
  dispose() {
    if (this._timer !== null) this._timers.clearTimeout(this._timer);
    this._timer = null;
  }

  _schedule() {
    if (this.mode !== "stored") return;
    this._dirty = true;
    if (this._timer !== null) this._timers.clearTimeout(this._timer);
    this._timer = this._timers.setTimeout(() => { this._timer = null; this.flush(); }, this._delay);
  }

  async _save() {
    const settings = this.settings;
    const bytes = new TextEncoder().encode(JSON.stringify(settings)).length;
    if (bytes > MAX_BYTES) {
      this.error = { kind: "too-large", bytes };
      this._dirty = false; // saving again would fail the same way until something is removed
      this._changed();
      return;
    }
    this._dirty = false;
    try {
      await this._callWS({ type: "meshroute_topology_explorer/settings/set", network: this.network, settings });
      this.error = null;
    } catch (err) {
      if (isUnknownCommand(err)) {
        this.mode = "memory";
        this.reason = "unsupported";
        this.error = null;
      } else {
        // Kept dirty: the next change or flush() tries again; a lost connection is retried on reconnect.
        this._dirty = true;
        this.error = { kind: "error", message: errorText(err), connection: isConnectionLost(err) };
      }
    }
    this._changed();
  }

  _changed() {
    this.dispatchEvent(new Event("change"));
  }
}
