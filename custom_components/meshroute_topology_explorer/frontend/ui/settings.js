// SPDX-License-Identifier: MIT
// Settings per network (spec 11) and the client that stores them through the integration's own websocket commands
// (spec 10): meshroute_topology_explorer/settings/get answers { settings: object | null }, /settings/set takes the
// whole object and answers {}. Saves are debounced and read-merge-write: the client reads what is stored and writes
// back only the keys it changed, pins per device, so two panels open at once do not wipe each other's pins. If the
// integration does not know the commands (an older version) the settings live in memory and the Settings tab says
// so; after a lost connection the client reads again on reconnect. Stored data is untrusted input: it is cleaned
// before use. No DOM. Tested in Node: node --test tests/
import { DENSITY } from "../graph/layout.js";
import { DEFAULT_LINKS } from "../graph/links.js";
import { FILLS } from "../graph/palette.js";
import { normalizeIeee } from "../model/parse.js";
import { errorText, isConnectionLost } from "./controller.js";

/** Defaults of spec 11. openDetailsOnSelect and legendOpen null mean "by screen width": details open on select and
 *  the legend is expanded on wide panels, both off on narrow ones (spec 9.1, 9.2). */
export const DEFAULTS = Object.freeze({ view: "quality", density: "medium", fill: "reception", openDetailsOnSelect: null,
  legendOpen: null, links: DEFAULT_LINKS, pins: Object.freeze({}) });
export const DENSITY_NAMES = Object.freeze(Object.keys(DENSITY)); // dense, medium, spread
/** The integration rejects larger payloads (spec 10); checked here so the user learns why nothing is saved. */
export const MAX_BYTES = 256 * 1024;
/** Saves wait for this long after the last change, so a burst of changes (dragging pins, trying densities) becomes
 *  one write. Own choice. */
export const SAVE_DELAY_MS = 1000;
/** Pins are stored in base lengths (graph-view.js) rounded to this many decimals: a thousandth of a base length is
 *  far below a pixel, and short numbers keep the stored object small. */
const PIN_DECIMALS = 3;
/** Stored pin coordinates are clamped to this many base lengths from the centre: a network of a few hundred devices
 *  spans some tens; anything far beyond is a broken or hostile value that would wreck the fitted view. Own choice. */
export const PIN_LIMIT = 1000;

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const round = (v) => Math.round(v * 10 ** PIN_DECIMALS) / 10 ** PIN_DECIMALS;
const clamp = (v) => Math.max(-PIN_LIMIT, Math.min(PIN_LIMIT, v));

/** Pins as a map without prototype (keys such as "__proto__" or "constructor" are plain data, never inherited
 *  members), only under device keys (EUI-64), only with two finite numbers, clamped and rounded. */
export function sanitizePins(input) {
  const pins = Object.create(null);
  if (!isPlainObject(input)) return pins;
  for (const [key, p] of Object.entries(input)) {
    const id = normalizeIeee(key);
    if (!id || !Array.isArray(p) || p.length !== 2 || !p.every((v) => typeof v === "number" && Number.isFinite(v))) continue;
    pins[id] = [round(clamp(p[0])), round(clamp(p[1]))];
  }
  return pins;
}

/** The link class switches { up, route, heard }: a boolean per class, anything else falls back to on. */
export function sanitizeLinks(input) {
  const src = isPlainObject(input) ? input : {};
  return Object.fromEntries(Object.keys(DEFAULT_LINKS).map((c) => [c, typeof src[c] === "boolean" ? src[c] : DEFAULT_LINKS[c]]));
}

/** A valid settings object from whatever was stored: known keys with wrong values fall back to the defaults, broken
 *  pins are dropped, unknown keys are kept as they are (a newer version may have written them). */
export function sanitizeSettings(input) {
  const src = isPlainObject(input) ? input : {};
  const out = { ...src };
  out.view = src.view === "quality" ? "quality" : DEFAULTS.view; // the only view of v1; the route view comes in v1.1
  out.density = DENSITY_NAMES.includes(src.density) ? src.density : DEFAULTS.density;
  out.fill = FILLS.includes(src.fill) ? src.fill : DEFAULTS.fill;
  out.openDetailsOnSelect = typeof src.openDetailsOnSelect === "boolean" ? src.openDetailsOnSelect : null;
  out.legendOpen = typeof src.legendOpen === "boolean" ? src.legendOpen : null;
  out.links = sanitizeLinks(src.links);
  out.pins = sanitizePins(src.pins);
  return out;
}

/** Stored pins { id: [x, y] } as the graph view takes them: Map id -> { x, y } in base lengths. */
export function pinsForView(pins) {
  return new Map(Object.entries(pins || {}).map(([id, [x, y]]) => [id, { x, y }]));
}

/** Pinned ids of devices that are in the network: what "release all pins (n)" counts and releases. Pins of devices
 *  that left the network stay stored (the device may come back) but are neither shown nor counted. */
export function presentPins(pins, network) {
  const ids = new Set(network ? network.devices.map((d) => d.id) : []);
  return Object.keys(pins || {}).filter((id) => ids.has(id)).sort();
}

/** Whether the server said it does not know the command (Home Assistant's websocket error "unknown_command"). */
export function isUnknownCommand(err) {
  const e = err && (err.error || err);
  return Boolean(e) && e.code === "unknown_command";
}

/** Storage modes: "loading"; "stored" (in Home Assistant); "memory" with reason "unsupported" (the integration lacks
 *  the commands), "unauthorized", "offline" (the connection was lost: read again on reconnect) or "unreadable"
 *  (reading failed, so saving would overwrite what is stored). */
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
    this.error = null; // last save problem: { kind: "error" | "too-large", message, bytes, connection }
    this._timer = null;
    this._saving = null;
    // What this panel changed since its last successful save: top-level keys, and pins per device (null = released).
    this._keys = new Set();
    this._pins = new Map();
  }

  /** Read the stored settings (again: on reconnect, to pick up other panels' changes). Local changes not saved yet
   *  are laid over what is stored and saved. Never throws; falls back to memory and says why. */
  async load() {
    try {
      const answer = await this._get();
      this.settings = this._merge(answer);
      this.mode = "stored";
      this.reason = null;
      this.error = null;
      if (this._pending()) this._schedule();
    } catch (err) {
      this.mode = "memory";
      this.reason = isUnknownCommand(err) ? "unsupported" : err && err.code === "unauthorized" ? "unauthorized"
        : isConnectionLost(err) ? "offline" : "unreadable";
      this.error = this.reason === "unreadable" ? { kind: "error", message: errorText(err) } : null;
    }
    this._changed();
    return this.settings;
  }

  /** Whether reading again may help: the first read met a lost connection. */
  get retryable() { return this.mode === "memory" && this.reason === "offline"; }

  /** Merge a patch of top-level keys (not pins) into the settings and schedule a save. */
  update(patch) {
    for (const key of Object.keys(patch)) if (key !== "pins") this._keys.add(key);
    const { pins, ...rest } = patch; // pins only through setPin / removePin, so they merge per device
    this.settings = sanitizeSettings({ ...this.settings, ...rest, pins: this.settings.pins });
    this._schedule();
    this._changed();
  }

  setPin(id, x, y) {
    const key = normalizeIeee(id);
    if (!key || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const value = [round(clamp(x)), round(clamp(y))];
    this._pins.set(key, value);
    this.settings.pins[key] = value; // a map without prototype (sanitizePins), so any key is plain data
    this._schedule();
    this._changed();
  }

  removePin(id) {
    this.releasePins([id]);
  }

  /** Release several pins in one change. */
  releasePins(ids) {
    const pins = sanitizePins(this.settings.pins);
    let any = false;
    for (const id of ids) {
      const key = normalizeIeee(id);
      if (!key || !(key in pins)) continue;
      delete pins[key];
      this._pins.set(key, null);
      any = true;
    }
    if (!any) return;
    this.settings.pins = pins;
    this._schedule();
    this._changed();
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

  _pending() {
    return this._keys.size > 0 || this._pins.size > 0;
  }

  async _get() {
    const answer = await this._callWS({ type: "meshroute_topology_explorer/settings/get", network: this.network });
    return answer && answer.settings;
  }

  /** The stored object with this panel's unsaved changes laid over it: last write wins per key, pins per device. */
  _merge(stored, keys = this._keys, pins = this._pins) {
    const out = sanitizeSettings(stored);
    for (const key of keys) out[key] = this.settings[key];
    const merged = sanitizePins(out.pins);
    for (const [id, value] of pins) { if (value) merged[id] = value; else delete merged[id]; }
    out.pins = merged;
    return sanitizeSettings(out);
  }

  _schedule() {
    if (this.mode !== "stored") return; // changes are still tracked and go out after a successful read
    if (this._timer !== null) this._timers.clearTimeout(this._timer);
    this._timer = this._timers.setTimeout(() => { this._timer = null; this.flush(); }, this._delay);
  }

  /** Read, merge, write. Changes made while the write is under way stay pending for the next save. */
  async _save() {
    const keys = this._keys;
    const pins = this._pins;
    this._keys = new Set();
    this._pins = new Map();
    const restore = () => {
      for (const key of keys) this._keys.add(key);
      for (const [id, value] of pins) if (!this._pins.has(id)) this._pins.set(id, value);
    };
    try {
      const merged = this._merge(await this._get(), keys, pins);
      const bytes = new TextEncoder().encode(JSON.stringify(merged)).length;
      if (bytes > MAX_BYTES) {
        // Not sent: saving again would fail the same way. The changes stay pending; the next change tries again.
        restore();
        this.error = { kind: "too-large", bytes };
        this._changed();
        return;
      }
      await this._callWS({ type: "meshroute_topology_explorer/settings/set", network: this.network, settings: merged });
      this.error = null;
    } catch (err) {
      restore();
      if (isUnknownCommand(err)) {
        this.mode = "memory";
        this.reason = "unsupported";
        this.error = null;
      } else {
        // Pending changes go out with the next change, the next flush or after a reconnect.
        this.error = { kind: "error", message: errorText(err), connection: isConnectionLost(err) };
      }
    }
    this._changed();
  }

  _changed() {
    this.dispatchEvent(new Event("change"));
  }
}
