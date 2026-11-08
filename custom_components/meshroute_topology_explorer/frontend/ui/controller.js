// SPDX-License-Identifier: MIT
// State machine of the panel (spec 9.4, 10): reads the network once, decides which empty or error state applies,
// notices a lost connection and reloads by itself when Home Assistant is back. No DOM: the panel element renders
// whatever `state` says and listens for "change". Tested with a fake hass: npm test
//
// Why a separate controller: Home Assistant assigns a new `hass` object on every state change in the house. Only the
// first one may start a load (spec 10); later ones are checked for a lost or restored connection only. The reads
// themselves are the adapters' (adapters/index.js); this module composes them in their order.
import { ADAPTERS, adapterFor } from "../adapters/index.js";
import { errorText, isConnectionLost } from "../adapters/ws.js";
import { engineFor } from "../engines/index.js";

/** One read of the networks through hass.callWS, one adapter per data source (adapters/index.js), in their order.
 *  Returns { phase, network?, raw?, networks?: { <adapter key>: network | null }, reads?: { <adapter key>: the
 *  adapter's read }, registriesFailed?, message?, reasons? }; never throws. `network` is the first adapter's network that could be read; the
 *  panel picks which of `networks` it shows (ui/network-switch.js). keys: read only these adapters, the others are
 *  "skipped" (the scan's re-reads follow their own source only). A source whose read fails is that source's "error"
 *  read, and the others are still shown (#15); only a lost connection fails the whole read. Without any network
 *  (spec 9.4) `reasons` lists the empty-state phase of each source that is set up ({ phase, message }, menu order) and
 *  phase is the first one's; with no source set up the phase is "no_network". */
export async function readNetwork(hass, { keys = null } = {}) {
  try {
    // The adapters' commands are admin only, so the cheap check comes first and nothing is sent without it.
    if (!(hass.user && hass.user.is_admin)) return { phase: "not_admin" };
    // Names and areas are a nicety: without the registries the models fall back to the integrations' own names, and
    // the status line says so (registriesFailed).
    let registriesFailed = false;
    const optional = (type) => hass.callWS({ type }).catch((err) => {
      if (isConnectionLost(err)) throw err;
      registriesFailed = true;
      return [];
    });
    let registries = null;
    const readRegistries = async () => {
      if (!registries) {
        const [deviceRegistry, areaRegistry] = await Promise.all(
          [optional("config/device_registry/list"), optional("config/area_registry/list")]);
        registries = { deviceRegistry, areaRegistry };
      }
      return registries;
    };
    const readOne = async (adapter) => {
      try {
        return await adapter.read(hass, { registries: readRegistries });
      } catch (err) {
        if (isConnectionLost(err)) throw err;
        return { status: "error", network: null, raw: null, message: errorText(err) };
      }
    };
    const reads = {};
    for (const adapter of ADAPTERS) {
      reads[adapter.key] = keys && !keys.includes(adapter.key) ? { status: "skipped", network: null } : await readOne(adapter);
    }
    const networks = Object.fromEntries(ADAPTERS.map((a) => [a.key, reads[a.key].network || null]));
    const first = ADAPTERS.find((a) => networks[a.key]);
    if (!first) {
      const reasons = ADAPTERS.map((a) => ({ phase: a.emptyState(reads[a.key]), message: reads[a.key].message || null }))
        .filter((r) => r.phase);
      if (!reasons.length) return { phase: "no_network", reads };
      return { phase: reasons[0].phase, message: reasons[0].message, reasons, reads };
    }
    return { phase: "ready", network: networks[first.key], raw: reads[first.key].raw || [], networks, reads, registriesFailed };
  } catch (err) {
    if (isConnectionLost(err)) return { phase: "disconnected" };
    return { phase: "error", message: errorText(err) };
  }
}

/** Why a ready read cannot be shown, or null: every network it carries must name a known engine and declare its
 *  capabilities (engines/index.js engineFor). There is no default engine; such a read becomes the error state. */
function engineProblem(networks) {
  for (const network of networks) {
    if (!network) continue;
    try { engineFor(network); } catch (err) { return errorText(err); }
  }
  return null;
}

export class PanelController extends EventTarget {
  /** read: the function that reads the network (injectable for tests); defaults to readNetwork. */
  constructor({ read = readNetwork } = {}) {
    super();
    this._read = read;
    this.hass = null;
    this.attached = false;
    this.started = false;
    /** phase ("loading", "not_admin", "no_network", an adapter's empty-state phase, "disconnected", "error" or "ready",
     *  which carries a network; the others are messages, spec 9.4), network (kept while a reload runs or the connection
     *  is down), raw (the shown source's own answer, for the Details' raw tables), reads (each adapter's read), message,
     *  reasons (every set-up source's empty-state phase and message, when no network is left), connection "ok" |
     *  "lost", loading (a reload is running while the old picture stays). */
    this.state = { phase: "loading", network: null, raw: null, networks: null, reads: null, message: null, reasons: null,
      registriesFailed: false, connection: "ok", loading: false };
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
    const problem = result.phase === "ready"
      ? engineProblem([result.network, ...Object.values(result.networks || {})]) : null;
    if (problem) {
      this._set({ phase: "error", network: null, raw: null, networks: null, reads: result.reads || null,
        message: problem, loading: false });
      return;
    }
    this._set({ phase: result.phase, network: result.network || null, raw: result.raw || null,
      networks: result.networks || null, reads: result.reads || null, message: result.message || null,
      reasons: result.reasons || null, registriesFailed: result.registriesFailed === true, loading: false });
  }

  /** A network read elsewhere (the re-reads that follow a scan) becomes the one shown; a load under way is superseded. */
  adopt(network, raw) {
    this._token += 1;
    const problem = engineProblem([network]);
    if (problem) {
      this._set({ phase: "error", network: null, raw: null, networks: null, message: problem, loading: false });
      return;
    }
    // A followed scan reads its own source only: the other networks stay as they were.
    const networks = { ...(this.state.networks || {}), [adapterFor(network).key]: network };
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
