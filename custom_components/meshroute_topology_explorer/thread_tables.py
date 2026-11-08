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

"Unchanged since": the server reports no read time, and the `Age` fields are no read time either (the route table's
wraps every 256 s). Per node a fingerprint of both tables is kept with the time this integration first saw it, in a
store of its own that survives restarts. The neighbour table's frame counters change with every read the server
makes, so a new fingerprint means a new read; the time is when Meshroute observed it (on every command call and on
the reception history's Thread timer, recorder.py), so at most one timer period late.
Every failure answers `not_supported` with "<reason>: <text>"; nothing is raised into Home Assistant.
"""

from __future__ import annotations

import asyncio
import dataclasses
import hashlib
import json
import logging
import time
from collections.abc import Callable
from typing import Any

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .admin import check_admin
from .const import DOMAIN, STORE_SAVE_DELAY

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


def fingerprint(node: dict[str, Any]) -> str | None:
    """Hash of a node's two tables in a fixed form, or None when it reported neither."""
    tables = [node.get("neighbor_table"), node.get("route_table")]
    if tables == [None, None]:
        return None
    text = json.dumps(tables, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(text.encode()).hexdigest()[:16]


class TableTimes:
    """Per Matter node id the fingerprint of its tables and when Meshroute first saw it: {"nodes": {id: {fingerprint,
    first_seen}}}. Nodes the client no longer lists are dropped, so the file stays as small as the network."""

    def __init__(self, hass: HomeAssistant, clock: Callable[[], float] = time.time) -> None:
        self._store: Store = Store(hass, TIMES_STORE_VERSION, TIMES_STORE_KEY)
        self._nodes: dict[str, dict[str, Any]] | None = None
        self._lock = asyncio.Lock()
        self.clock = clock

    async def async_update(self, nodes: list[dict[str, Any]]) -> dict[str, float | None]:
        """Note each node's fingerprint and return per node id the time it was first seen (None without tables)."""
        async with self._lock:
            if self._nodes is None:
                try:
                    data = await self._store.async_load()
                except Exception:  # a broken file only costs the times: start over
                    _LOGGER.warning("Cannot read the stored Thread table times; starting over", exc_info=True)
                    data = None
                stored = data.get("nodes") if isinstance(data, dict) else None
                self._nodes = stored if isinstance(stored, dict) else {}
            now = self.clock()
            seen: dict[str, float | None] = {}
            changed = False
            for node in nodes:
                key = str(node["node_id"])
                mark = fingerprint(node)
                old = self._nodes.get(key)
                if mark is None:
                    seen[key] = None
                    changed |= self._nodes.pop(key, None) is not None
                    continue
                first = old.get("first_seen") if isinstance(old, dict) else None
                if not (isinstance(old, dict) and old.get("fingerprint") == mark and isinstance(first, (int, float))):
                    first = now
                    self._nodes[key] = {"fingerprint": mark, "first_seen": now}
                    changed = True
                seen[key] = first
            if nodes:  # an empty list (the client starting) is no reason to forget every node
                for key in [k for k in self._nodes if k not in seen]:
                    del self._nodes[key]
                    changed = True
            if changed:
                snapshot = dict(self._nodes)
                self._store.async_delay_save(lambda: {"nodes": snapshot}, STORE_SAVE_DELAY)
            return seen

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
    """read_tables with each node's `unchanged_since` (epoch seconds, observed) and the read's own time. Raises
    NotSupported."""
    nodes = read_tables(hass)
    times = get_times(hass)
    seen = await times.async_update(nodes)
    for node in nodes:
        node["unchanged_since"] = seen.get(str(node["node_id"]))
    return {"nodes": nodes, "read_at": times.clock()}


async def async_observe(hass: HomeAssistant) -> None:
    """Refresh the fingerprints without an answer (the reception history's Thread timer); never raises."""
    try:
        await async_read(hass)
    except NotSupported:
        return
    except Exception:  # Matter internals on a timer: never raise into Home Assistant
        _LOGGER.debug("Observing the Thread tables failed", exc_info=True)


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
