// SPDX-License-Identifier: MIT
// State machine of the panel (spec 9.4, 10): reads the network once, decides which empty or error state applies,
// notices a lost connection and reloads by itself when Home Assistant is back. No DOM: the panel element renders
// whatever `state` says and listens for "change". Tested with a fake hass: node --test tests/
//
// Why a separate controller: Home Assistant assigns a new `hass` object on every state change in the house. Only the
// first one may start a load (spec 10); later ones are checked for a lost or restored connection only.
import { buildNetwork } from "../model/index.js";
import { buildThreadNetwork } from "../model/thread.js";
import { blockingState } from "./status.js";
import { readZigpyRoutes } from "./zigpy-routes.js";

/** Code of home-assistant-js-websocket for a command that died with the connection (ERR_CONNECTION_LOST in its
 *  lib/errors.ts). Pending commands are rejected with { type: "result", success: false, error: { code: 3 } }, results
 *  of the server with { code, message }; both forms are accepted, as its own isConnectionLost() does. */
const ERR_CONNECTION_LOST = 3;

export function isConnectionLost(err) {
  return Boolean(err) && (err.code === ERR_CONNECTION_LOST || (err.error && err.error.code === ERR_CONNECTION_LOST));
}

/** Readable text of a websocket error ({ code, message }, { error: { ... } }, Error or anything else). */
export function errorText(err) {
  if (!err) return "unknown error";
  const e = err.error || err;
  return String(e.message || e.code || e);
}

/** The Thread network through Matter (spec 3.2): read only when the Matter integration is loaded, with refresh false
 *  (the server's cached snapshot; refresh true reads every node's tables over the radio and is never sent from here).
 *  Returns { status: "ok" | "not_loaded" | "not_supported" | "empty" | "error", network?, message? }; a lost
 *  connection is thrown to the caller. Home Assistant before 2026.9 has no such command (unknown_command), a Matter
 *  server too old for it answers not_supported (spec 3.2): both are "not_supported". */
export async function readThread(hass, registries = {}) {
  let entries;
  try {
    entries = await hass.callWS({ type: "config_entries/get", domain: "matter" });
  } catch (err) {
    if (isConnectionLost(err)) throw err;
    return { status: "not_loaded" };
  }
  if (!(Array.isArray(entries) && entries.some((e) => e && e.domain === "matter" && e.state === "loaded"))) {
    return { status: "not_loaded" };
  }
  let topology;
  try {
    topology = await hass.callWS({ type: "matter/network_topology", refresh: false });
  } catch (err) {
    if (isConnectionLost(err)) throw err;
    const code = String((err && (err.code || (err.error && err.error.code))) || "");
    if (code === "not_supported" || code === "unknown_command") return { status: "not_supported" };
    return { status: "error", message: errorText(err) };
  }
  const network = buildThreadNetwork(topology, registries);
  return network ? { status: "ok", network } : { status: "empty" };
}

/** One read of the networks through hass.callWS. Returns { phase, network?, raw?, networks?: { zha, thread },
 *  thread?: readThread's status, message? }; never throws. `network` is the ZHA network, else the Thread one; the
 *  panel picks which of `networks` it shows (ui/network-switch.js). matter: false skips the Matter topology (the
 *  scan's re-reads, which only follow ZHA's tables). */
export async function readNetwork(hass, { matter = true } = {}) {
  try {
    const isAdmin = Boolean(hass.user && hass.user.is_admin);
    // The zha/* commands are admin only and fail without ZHA, so the cheap checks come first.
    const configEntries = isAdmin ? await hass.callWS({ type: "config_entries/get", domain: "zha" }) : [];
    if (!isAdmin) return { phase: "not_admin" };
    // Names and areas are a nicety: without the registries the models fall back to the integrations' own names.
    const optional = (type) => hass.callWS({ type }).catch((err) => { if (isConnectionLost(err)) throw err; return []; });
    let registries = null;
    const readRegistries = async () => {
      if (!registries) {
        const [deviceRegistry, areaRegistry] = await Promise.all(
          [optional("config/device_registry/list"), optional("config/area_registry/list")]);
        registries = { deviceRegistry, areaRegistry };
      }
      return registries;
    };
    const blocked = blockingState({ isAdmin, configEntries });
    let raw = null;
    let zha = null;
    if (!blocked) {
      raw = await hass.callWS({ type: "zha/devices" });
      if (Array.isArray(raw) && raw.length) {
        zha = buildNetwork(raw, { ...(await readRegistries()), configEntries });
        // zigpy's route records for the source-route stage "zigpy" (ui/zigpy-routes.js): read only, never fails the
        // load; ZHA only, never for Thread.
        zha.zigpy = await readZigpyRoutes(hass);
      }
    }
    // The scan's re-reads (matter: false) follow ZHA only: no Matter read every 15 seconds.
    const thread = matter ? await readThread(hass, await readRegistries()) : { status: "skipped" };
    const networks = { zha, thread: thread.network || null };
    const network = zha || networks.thread;
    if (!network) return { phase: blocked || "no_devices", thread };
    return { phase: "ready", network, raw: zha ? raw : [], networks, thread };
  } catch (err) {
    if (isConnectionLost(err)) return { phase: "disconnected" };
    return { phase: "error", message: errorText(err) };
  }
}

export class PanelController extends EventTarget {
  /** read: the function that reads the network (injectable for tests); defaults to readNetwork. */
  constructor({ read = readNetwork } = {}) {
    super();
    this._read = read;
    this.hass = null;
    this.attached = false;
    this.started = false;
    /** phase ("loading", "not_admin", "zha_not_loaded", "no_devices", "disconnected", "error" or "ready", which
     *  carries a network; the others are messages, spec 9.4), network (kept while a reload runs or the connection is
     *  down), raw zha/devices list, message,
     *  connection "ok" | "lost", loading (a reload is running while the old picture stays). */
    this.state = { phase: "loading", network: null, raw: null, networks: null, thread: null, message: null,
      connection: "ok", loading: false };
    this._token = 0;
    this._conn = null;
    this._onDisconnected = () => this._lost();
    this._onReady = () => this._back();
  }

  /** Called for every new hass object. Starts the first load once a user is known (without hass.user the admin check
   *  would wrongly say "needs an administrator"), then only follows the connection. */
  setHass(hass) {
    this.hass = hass;
    if (!hass) return;
    if (this.attached && hass.connection !== this._conn) this._bind(hass.connection);
    if (hass.connected === false) this._lost();
    else if (hass.connected === true && this.state.connection === "lost") this._back();
    this._maybeStart();
  }

  /** The panel is in the document again: listen to the connection, catch up on a reconnect missed while hidden. */
  attach() {
    this.attached = true;
    if (this.hass) this._bind(this.hass.connection);
    if (this.hass && this.hass.connected !== false && this.state.connection === "lost") this._back();
    this._maybeStart();
  }

  /** The panel left the document (another sidebar entry): stop listening (spec 10). */
  detach() {
    this.attached = false;
    this._bind(null);
  }

  /** Read the network again (retry button, menu, reconnect). The old picture stays while the new one loads. */
  async reload() {
    if (!this.hass || !this.hass.user) return;
    this.started = true;
    const token = ++this._token;
    const keep = this.state.phase === "ready";
    this._set(keep ? { loading: true } : { phase: "loading", loading: true });
    const result = await this._read(this.hass);
    if (token !== this._token) return; // a newer load was started meanwhile
    if (result.phase === "disconnected") {
      // Keep the last picture if there is one; the reconnect starts the next try.
      this._set(keep ? { connection: "lost", loading: false } : { phase: "disconnected", connection: "lost", loading: false });
      return;
    }
    this._set({ phase: result.phase, network: result.network || null, raw: result.raw || null,
      networks: result.networks || null, thread: result.thread || null, message: result.message || null, loading: false });
  }

  /** A network read elsewhere (the re-reads that follow a scan) becomes the one shown; a load under way is superseded. */
  adopt(network, raw) {
    this._token += 1;
    // A followed scan reads ZHA only: the Thread network stays as it was.
    const networks = { ...(this.state.networks || {}), zha: network };
    this._set({ phase: "ready", network, raw: raw || null, networks, message: null, loading: false });
  }

  _maybeStart() {
    if (!this.started && this.attached && this.hass && this.hass.user) this.reload();
  }

  _bind(conn) {
    if (this._conn && this._conn.removeEventListener) {
      this._conn.removeEventListener("disconnected", this._onDisconnected);
      this._conn.removeEventListener("ready", this._onReady);
    }
    this._conn = conn || null;
    if (this._conn && this._conn.addEventListener) {
      this._conn.addEventListener("disconnected", this._onDisconnected);
      this._conn.addEventListener("ready", this._onReady);
    }
  }

  _lost() {
    if (this.state.connection === "lost") return;
    this._set({ connection: "lost" });
  }

  /** The connection is back: read again (spec 9.4: retry automatically). */
  _back() {
    if (this.state.connection !== "lost") return;
    this._set({ connection: "ok" });
    this.dispatchEvent(new Event("reconnected"));
    if (this.started) this.reload();
  }

  _set(patch) {
    this.state = { ...this.state, ...patch };
    this.dispatchEvent(new Event("change"));
  }
}
