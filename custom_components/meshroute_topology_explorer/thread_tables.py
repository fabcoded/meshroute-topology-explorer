# SPDX-License-Identifier: MIT
"""Thread tables from Home Assistant's Matter client: websocket command meshroute_topology_explorer/thread_tables.

Spec 3.2 ("Routes") and 3.4. Read only and in memory: per Thread node of the Matter client's cache its role
(ThreadNetworkDiagnostics 0/53/1), neighbour table (0/53/7), route table (0/53/8), extended address (0/53/63) and
RLOC16 (0/53/64), as the Matter server last read them. Nothing is refreshed, nothing goes to the radio; the panel's
Thread engine computes the routes (frontend/engines/thread/routes.js).

Where the data lives (Home Assistant 2026.10.4 with matter-python-client 1.4.0, 2026.11.0 with 1.5.5):
- homeassistant/components/matter/helpers.py get_matter(hass) returns the MatterAdapter of the loaded entry; its
  `matter_client.get_nodes()` lists MatterNode objects (matter_server/client/models/node.py).
- A node's parsed clusters are the current cache: the client applies attribute_updated events to them
  (MatterNode.update_attribute -> MatterEndpoint.set_attribute_value), not to the raw `node_data.attributes`, which
  only holds the last full node snapshot. So values come from `get_cluster(0, 53)`; whether an attribute was reported
  at all comes from `has_attribute` (the raw paths), because an unreported table reads as the dataclass default [].
- Table entries keep the client's field names (chip.clusters ThreadNetworkDiagnostics.Structs NeighborTableStruct,
  RouteTableStruct); extended addresses go out as 16 hex digits, as a 64-bit number would lose digits in JavaScript.

Read time as an interval (owner 2026-11-09, F5 tiers C/D): the server reports no read time, and the `Age` fields are
no read time either (the route table's wraps every 256 s). Meshroute observes its copy every 10 minutes (an observer
of its own, started with the entry, no radio traffic) and on every command call, and keeps per node and per table
(0/53/7, 0/53/8) a fingerprint: the neighbour table's frame counters change with every read the server makes, so a
new fingerprint means a new read, which then lies between the last time the old one was seen (lo) and now (hi).
lo is null where unknown (first install, lost store, new node). The intervals are stored on change; when each
fingerprint was last seen only when Home Assistant stops (the pending delayed save is flushed at its final write) or
the entry unloads.
Every failure answers `not_supported` with "<reason>: <text>"; nothing is raised into Home Assistant.
"""

from __future__ import annotations

import asyncio
import copy
import dataclasses
import hashlib
import json
import logging
import time
from collections.abc import Callable
from datetime import timedelta
from typing import Any

from homeassistant.components import websocket_api
from homeassistant.config_entries import SIGNAL_CONFIG_ENTRY_CHANGED, ConfigEntryState
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.event import async_track_time_interval
from homeassistant.helpers.storage import Store

from .admin import check_admin
from .const import DOMAIN

COMMAND = f"{DOMAIN}/thread_tables"
REASON_MATTER_NOT_LOADED = "matter_not_loaded"
REASON_NO_CLIENT = "no_client"
REASON_INTERNALS_CHANGED = "internals_changed"
REASON_ERROR = "error"

CLUSTER = 53  # ThreadNetworkDiagnostics, on the root endpoint 0
ATTRIBUTES = {"routing_role": 1, "neighbor_table": 7, "route_table": 8, "ext_address": 63, "rloc16": 64}
# The client's attribute names on the cluster object (chip.clusters ThreadNetworkDiagnostics, both pinned versions).
LABELS = {"routing_role": "routingRole", "neighbor_table": "neighborTable", "route_table": "routeTable",
          "ext_address": "extAddress", "rloc16": "rloc16"}
TIMES_STORE_KEY = f"{DOMAIN}.thread_tables"
TIMES_STORE_VERSION = 1
_TIMES_KEY = f"{DOMAIN}_thread_times"

_LOGGER = logging.getLogger(__name__)


class NotSupported(Exception):
    """The tables cannot be read; carries a reason key for the panel and a text for people."""

    def __init__(self, reason: str, text: str) -> None:
        super().__init__(f"{reason}: {text}")
        self.reason = reason


def _hex64(value: Any) -> str | None:
    """A 64-bit extended address as 16 lower-case hex digits, else None."""
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value < 1 << 64:
        return None
    return f"{int(value):016x}"


def _plain(value: Any) -> int | bool | None:
    """A table field as JSON: bool, int (enums become their number), else None (null, Nullable, anything else)."""
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return int(value)
    return None


def _table(rows: Any) -> list[dict[str, Any]]:
    """A parsed table (list of the client's struct dataclasses) as plain dicts with the client's field names."""
    if not isinstance(rows, (list, tuple)):
        raise NotSupported(REASON_INTERNALS_CHANGED, "a Thread table is not a list")
    out = []
    for row in rows:
        if not dataclasses.is_dataclass(row):
            raise NotSupported(REASON_INTERNALS_CHANGED, "a Thread table entry is not a struct")
        entry = {}
        for f in dataclasses.fields(row):
            value = getattr(row, f.name)
            entry[f.name] = _hex64(value) if f.name == "extAddress" else _plain(value)
        out.append(entry)
    return out


def _client(hass: HomeAssistant) -> Any:
    """The Matter client behind Home Assistant's Matter integration, or NotSupported with the reason why not."""
    components = getattr(getattr(hass, "config", None), "components", None) or ()
    if "matter" not in components:
        raise NotSupported(REASON_MATTER_NOT_LOADED, "Matter is not loaded")
    try:
        # Imported here: the integration loads without Matter, and once Matter is loaded the module is imported.
        from homeassistant.components.matter.helpers import get_matter
    except ImportError as err:
        raise NotSupported(REASON_INTERNALS_CHANGED, f"Matter's helper is not where it was ({err})") from None
    try:
        adapter = get_matter(hass)
    except (IndexError, KeyError, AttributeError):
        # helpers.py takes the first loaded entry's runtime data: none while Matter starts, stops or has failed.
        raise NotSupported(REASON_NO_CLIENT, "Matter has no loaded entry") from None
    client = getattr(adapter, "matter_client", None)
    if client is None or not callable(getattr(client, "get_nodes", None)):
        raise NotSupported(REASON_INTERNALS_CHANGED, "the Matter adapter has no client with get_nodes")
    return client


def _node(node: Any) -> dict[str, Any] | None:
    """One node's Thread attributes, or None when its root endpoint has no ThreadNetworkDiagnostics (Wi-Fi, Ethernet)."""
    endpoint = getattr(node, "endpoints", {}).get(0)
    cluster = node.get_cluster(0, CLUSTER) if endpoint is not None else None
    if cluster is None:
        return None
    out: dict[str, Any] = {"node_id": _plain(getattr(node, "node_id", None)),
                           "available": getattr(node, "available", None) is True}
    for key, attribute in ATTRIBUTES.items():
        # Not reported at all is null, never the dataclass default (an empty table would read as "no neighbours").
        value = getattr(cluster, LABELS[key]) if endpoint.has_attribute(CLUSTER, attribute) else None
        if key in ("neighbor_table", "route_table"):
            out[key] = _table(value) if value is not None else None
        elif key == "ext_address":
            out[key] = _hex64(value)
        else:
            out[key] = _plain(value)
    return out


def read_tables(hass: HomeAssistant) -> list[dict[str, Any]]:
    """Every Thread node of the Matter client's cache: {node_id, available, routing_role, neighbor_table,
    route_table, ext_address, rloc16}; a value the node did not report is None. Raises NotSupported."""
    nodes = _client(hass).get_nodes()
    if not isinstance(nodes, (list, tuple)):
        raise NotSupported(REASON_INTERNALS_CHANGED, "get_nodes did not return a list")
    try:
        found = [_node(n) for n in nodes]
    except (AttributeError, TypeError) as err:
        raise NotSupported(REASON_INTERNALS_CHANGED, f"a node is not shaped as expected ({type(err).__name__})") from None
    return [n for n in found if n is not None and n["node_id"] is not None]


# The fingerprint's form. Raising it keeps the stored lower bounds and dates every table "between its old lo and now"
# at the first observation, never "now" alone.
FP_VERSION = 1
TABLES = ("neighbor_table", "route_table")
OBSERVE_PERIOD = timedelta(minutes=10)
# The stored "last seen" times are only written when nothing changed for this long, in practice at Home Assistant's
# final write, which flushes pending delayed saves (helpers/storage.py, _async_callback_final_write).
SEEN_SAVE_DELAY = 24 * 3600
_OBSERVER_KEY = f"{DOMAIN}_thread_observer"


def table_fingerprint(rows: list[dict[str, Any]] | None) -> str | None:
    """Hash of one table in a fixed form, or None when the node did not report it."""
    if rows is None:
        return None
    text = json.dumps(rows, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(text.encode()).hexdigest()[:16]


def _time(value: Any) -> float | None:
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None


class TableTimes:
    """Per Matter node id and table the read interval of its current content: {"nodes": {id: {table: {fp, v, lo, hi,
    seen}}}} (epoch seconds; seen: when Meshroute last saw this fingerprint). Nodes the client no longer lists are
    dropped, so the file stays as small as the network."""

    def __init__(self, hass: HomeAssistant, clock: Callable[[], float] = time.time) -> None:
        self._store: Store = Store(hass, TIMES_STORE_VERSION, TIMES_STORE_KEY)
        self._nodes: dict[str, dict[str, Any]] | None = None
        self._lock = asyncio.Lock()
        self.clock = clock
        self.last_check: float | None = None

    async def _async_load(self) -> dict[str, dict[str, Any]]:
        if self._nodes is None:
            try:
                data = await self._store.async_load()
            except Exception:  # a broken file only costs the lower bounds: start over
                _LOGGER.warning("Cannot read the stored Thread table times; starting over", exc_info=True)
                data = None
            stored = data.get("nodes") if isinstance(data, dict) else None
            # A copy: Store.async_load hands out its pending data object, which must not change under it.
            self._nodes = ({k: copy.deepcopy(v) for k, v in stored.items() if isinstance(v, dict)}
                           if isinstance(stored, dict) else {})
        return self._nodes

    def _data(self) -> dict[str, Any]:
        return {"nodes": copy.deepcopy(self._nodes or {})}

    async def async_observe(self, nodes: list[dict[str, Any]]) -> dict[str, dict[str, dict[str, float | None] | None]]:
        """Note each table's fingerprint; return per node id and table its read interval {lo, hi} (None: not
        reported). An unchanged table only updates when it was last seen, in memory."""
        async with self._lock:
            known = await self._async_load()
            now = self.clock()
            out: dict[str, dict[str, dict[str, float | None] | None]] = {}
            changed = False
            for node in nodes:
                key = str(node["node_id"])
                entry = known.get(key) if isinstance(known.get(key), dict) else {}
                out[key] = {}
                for table in TABLES:
                    mark = table_fingerprint(node.get(table))
                    old = entry.get(table) if isinstance(entry.get(table), dict) else None
                    if mark is None:
                        changed |= entry.pop(table, None) is not None
                        out[key][table] = None
                        continue
                    if old and old.get("v") == FP_VERSION and old.get("fp") == mark and _time(old.get("hi")) is not None:
                        old["seen"] = now
                    else:
                        # A new read: it happened after the old content was last seen. A changed fingerprint form
                        # cannot compare, so the interval runs from the old lower bound; nothing known: lo unknown.
                        lo = None if not old else _time(old.get("seen")) if old.get("v") == FP_VERSION else _time(old.get("lo"))
                        if lo is not None and lo > now:  # the clock went back: the bound is worthless
                            lo = None
                        entry[table] = {"fp": mark, "v": FP_VERSION, "lo": lo, "hi": now, "seen": now}
                        changed = True
                    out[key][table] = {"lo": _time(entry[table].get("lo")), "hi": _time(entry[table].get("hi"))}
                if entry:
                    known[key] = entry
            if nodes:  # an empty list (the client starting) is no reason to forget every node
                for key in [k for k in known if k not in out]:
                    del known[key]
                    changed = True
            self.last_check = now
            if changed:  # written now: a delayed save would be pushed back by the next observation
                await self._store.async_save(self._data())
            else:
                self._store.async_delay_save(self._data, SEEN_SAVE_DELAY)
            return out

    def async_flush(self) -> None:
        """Write what was last seen soon (the entry unloads)."""
        if self._nodes is not None:
            self._store.async_delay_save(self._data, 0)

    async def async_remove(self) -> None:
        """Delete the file and the memory copy."""
        async with self._lock:
            await self._store.async_remove()
            self._nodes = None


def get_times(hass: HomeAssistant) -> TableTimes:
    """The one TableTimes per Home Assistant run."""
    if _TIMES_KEY not in hass.data:
        hass.data[_TIMES_KEY] = TableTimes(hass)
    return hass.data[_TIMES_KEY]


async def async_read(hass: HomeAssistant) -> dict[str, Any]:
    """read_tables with each node's read intervals `times` ({neighbor_table, route_table}: {lo, hi} epoch seconds, lo
    null where unknown, or null for a table not reported), the observation period and this check's time. Raises
    NotSupported."""
    nodes = read_tables(hass)
    times = get_times(hass)
    seen = await times.async_observe(nodes)
    for node in nodes:
        node["times"] = seen.get(str(node["node_id"]))
    return {"nodes": nodes, "read_at": times.last_check, "observe_seconds": OBSERVE_PERIOD.total_seconds()}


async def async_observe(hass: HomeAssistant) -> None:
    """One observation without an answer (the observer, the reception history's timer); never raises."""
    try:
        await async_read(hass)
    except NotSupported:
        return
    except Exception:  # Matter internals on a timer: never raise into Home Assistant
        _LOGGER.debug("Observing the Thread tables failed", exc_info=True)


def start_observer(hass: HomeAssistant) -> list[Callable[[], None]]:
    """The observer: every OBSERVE_PERIOD, and once as soon as Matter is loaded (the baseline), whether or not the
    reception history records. Returns the cancels for the entry's unload, the last of which writes what was seen."""

    async def tick(_now: Any = None) -> None:
        await async_observe(hass)

    @callback
    def entry_changed(_change: Any, entry: Any) -> None:
        if getattr(entry, "domain", None) == "matter" and getattr(entry, "state", None) is ConfigEntryState.LOADED:
            hass.async_create_task(tick())

    cancels = [async_track_time_interval(hass, tick, OBSERVE_PERIOD),
               async_dispatcher_connect(hass, SIGNAL_CONFIG_ENTRY_CHANGED, entry_changed)]
    if "matter" in (getattr(getattr(hass, "config", None), "components", None) or ()):
        hass.async_create_task(tick())
    cancels.append(lambda: get_times(hass).async_flush())
    return cancels


@websocket_api.async_response
async def ws_thread_tables(hass: HomeAssistant, connection: Any, msg: dict[str, Any]) -> None:
    """Answer with async_read; admin only, like matter/*. Waits for no device: the cache is read in memory."""
    msg_id = msg["id"]
    if not check_admin(connection, msg_id):
        return
    try:
        result = await async_read(hass)
    except NotSupported as err:
        connection.send_error(msg_id, websocket_api.ERR_NOT_SUPPORTED, str(err))
        return
    except Exception as err:
        _LOGGER.debug("Reading the Thread tables failed", exc_info=True)
        connection.send_error(msg_id, websocket_api.ERR_NOT_SUPPORTED, f"{REASON_ERROR}: {type(err).__name__}")
        return
    connection.send_result(msg_id, result)
