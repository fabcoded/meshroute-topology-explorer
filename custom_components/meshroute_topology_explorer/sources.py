# SPDX-License-Identifier: MIT
"""What ZHA and the Matter server already hold: neighbour-table values per network, for the reception history.

Read only, never a scan: the data comes from two Home Assistant websocket commands that the panel reads as well, called
in-process through the registry Home Assistant keeps (hass.data["websocket_api"][command] = (handler, schema)):
`zha/devices` (ZHA's cached tables) and `matter/network_topology` with `refresh` forced to False (the Matter server's
cached snapshot; refresh true would read every node over the radio). Nothing else is ever called (ALLOWED). The only
fragile part is that registry layout and the handler calling convention; every mismatch raises SourceError, which the
recorder logs and the info command reports, never an exception into Home Assistant. Plan: docs/spec.md section 10.2.
Zigbee also takes the routing tables of the same answer and zigpy's route records (zigpy_routes.read_routes: in
memory, no await, no radio, so safe on a timer). Field mapping follows the panel (frontend/engines/zigbee/from-zha.js, thread/from-matter.js).
"""

from __future__ import annotations

import asyncio
import re
from typing import Any, NamedTuple

from homeassistant.core import HomeAssistant

from .history import Entries, Snapshot
from .zigpy_routes import NotSupported, read_routes

# Exactly these two read commands, with exactly these parameters (SCAN_COMMAND is handled by request_update alone).
ALLOWED: dict[str, dict[str, Any]] = {"zha/devices": {}, "matter/network_topology": {"refresh": False}}
# The one command that causes radio traffic: ZHA's own topology scan, asked for once after a start if the owner chose so.
SCAN_COMMAND = "zha/topology/update"
CALL_TIMEOUT = 30  # seconds; the handlers answer from memory, a slow answer is a broken one
_EUI64 = re.compile(r"^[0-9a-f]{2}(?::[0-9a-f]{2}){7}$")
_RSSI_RANGE = (-128, 10)  # the panel's bounds (from-matter.js); 127 (no value) lies outside
_PENDING_KEY = "meshroute_topology_explorer_pending_reads"


class SourceError(Exception):
    """A source cannot be read now; the text is for the log and the info command."""


class _Connection:
    """The few members the handler decorators use (require_admin, async_response, async_handle_failed_command)."""

    def __init__(self, future: asyncio.Future) -> None:
        self.user = type("User", (), {"is_admin": True})()
        self._future = future

    def send_result(self, msg_id: int, result: Any = None) -> None:
        if not self._future.done():
            self._future.set_result(result)

    def send_error(self, msg_id: int, code: str, message: str, *args: Any, **kwargs: Any) -> None:
        if not self._future.done():
            self._future.set_exception(SourceError(f"{code}: {message}"))

    def async_handle_exception(self, msg: Any, err: Exception) -> None:
        if not self._future.done():
            self._future.set_exception(SourceError(f"{type(err).__name__}"))


async def call_command(hass: HomeAssistant, command: str) -> Any:
    """Run one allowed command through Home Assistant's registry and return its result; raises SourceError."""
    if command not in ALLOWED:
        raise SourceError(f"{command} is not an allowed command")
    registry = hass.data.get("websocket_api")
    entry = registry.get(command) if isinstance(registry, dict) else None
    if entry is None:
        raise SourceError(f"{command} is not registered")
    if not (isinstance(entry, tuple) and len(entry) == 2 and callable(entry[0])):
        raise SourceError("the websocket registry has another layout")
    pending = hass.data.setdefault(_PENDING_KEY, set())
    if command in pending:
        raise SourceError(f"{command}: the previous read has not answered yet")
    future: asyncio.Future = asyncio.get_running_loop().create_future()
    pending.add(command)
    # Done (answer or error) frees the command and marks an error as retrieved; a handler that never answers keeps
    # it pending, so that slow reads do not pile up (the next interval skips with a problem text).
    future.add_done_callback(lambda f: (pending.discard(command), f.cancelled() or f.exception()))
    try:
        # async_response handlers return at once and answer through the connection later.
        entry[0](hass, _Connection(future), {"id": 1, "type": command, **ALLOWED[command]})
        return await asyncio.wait_for(asyncio.shield(future), CALL_TIMEOUT)  # shield: a timeout must not cancel it
    except TimeoutError:
        raise SourceError(f"{command} did not answer within {CALL_TIMEOUT} s") from None
    except SourceError:
        raise
    except Exception as err:  # noqa: BLE001 - another integration's handler: never raise into Home Assistant
        raise SourceError(f"{command} failed: {type(err).__name__}") from None


def request_update(hass: HomeAssistant) -> None:
    """Ask ZHA to scan, through its registered `zha/topology/update` handler (never the topology's own scan method).
    ZHA answers that command only when the scan is over, so nothing is awaited: the handler's task runs on its own and
    the scan's events reach the normal recording path. Raises SourceError when the handler is not there."""
    registry = hass.data.get("websocket_api")
    entry = registry.get(SCAN_COMMAND) if isinstance(registry, dict) else None
    if not (isinstance(entry, tuple) and len(entry) == 2 and callable(entry[0])):
        raise SourceError(f"{SCAN_COMMAND} is not registered or the websocket registry has another layout")
    future: asyncio.Future = asyncio.get_running_loop().create_future()
    future.add_done_callback(lambda f: f.cancelled() or f.exception())
    try:
        entry[0](hass, _Connection(future), {"id": 1, "type": SCAN_COMMAND})
    except Exception as err:  # noqa: BLE001 - another integration's handler: never raise into Home Assistant
        raise SourceError(f"{SCAN_COMMAND} failed: {type(err).__name__}") from None


def _ieee(value: Any) -> str | None:
    """Lower-case colon form of an EUI-64, or None (all-zero and all-ones are not devices)."""
    if not isinstance(value, str):
        return None
    text = value.strip().lower()
    if not _EUI64.match(text) or text in ("00:00:00:00:00:00:00:00", "ff:ff:ff:ff:ff:ff:ff:ff"):
        return None
    return text


def _nwk(value: Any) -> str | None:
    """A network address as "0xABCD" text (ZHA gives text, a number is formatted the same way), or None."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int) and 0 <= value <= 0xFFFF:
        return f"0x{value:04X}"
    if isinstance(value, str) and re.fullmatch(r"0[xX][0-9a-fA-F]{1,4}", value.strip()):
        return f"0x{int(value.strip(), 16):04X}"
    return None


def parse_zha(devices: Any) -> Snapshot:
    """Neighbour entries, routing entries and parent links of zha/devices.

    Neighbours: (device whose table it is, listed neighbour) -> (lqi, None). Routes: (holder, destination, next hop,
    ZHA's route status); an address that exactly one device holds becomes that device's IEEE, else it stays "0xABCD".
    Tables of unavailable devices are skipped (stale: ZHA keeps the last table of a device that left). A neighbour
    listed twice in one table keeps the higher LQI; an entry without a readable LQI is left out (unknown, not 0).
    """
    if not isinstance(devices, list):
        raise SourceError("zha/devices did not return a list")
    owner: dict[str, str | None] = {}
    for device in devices:
        nwk = _nwk(device.get("nwk")) if isinstance(device, dict) else None
        if nwk:
            owner[nwk] = None if nwk in owner else _ieee(device.get("ieee"))
    entries: Entries = {}
    routes: set[tuple[str, str, str, str]] = set()
    parents: set[tuple[str, str]] = set()
    for device in devices:
        holder = _ieee(device.get("ieee")) if isinstance(device, dict) else None
        if not holder or device.get("available") is False:
            continue
        for n in device.get("neighbors") if isinstance(device.get("neighbors"), list) else []:
            sender = _ieee(n.get("ieee")) if isinstance(n, dict) else None
            lqi = n.get("lqi") if sender else None
            if isinstance(lqi, str) and lqi.strip().isdigit():
                lqi = int(lqi)
            if sender is None or sender == holder or isinstance(lqi, bool) or not isinstance(lqi, int) or lqi < 0:
                continue
            # Parent links are those of end devices (spec 4.5): the holder lists an end device as its "Child", seen
            # from the holder's side. A router's own join parent ("Parent") is not one.
            if n.get("relationship") == "Child" and n.get("device_type") == "EndDevice":
                parents.add((sender, holder))
            old = entries.get((holder, sender))
            if old is None or lqi > old[0]:
                entries[(holder, sender)] = (lqi, None)
        for r in device.get("routes") if isinstance(device.get("routes"), list) else []:
            dest, hop = (_nwk(r.get(k)) for k in ("dest_nwk", "next_hop")) if isinstance(r, dict) else (None, None)
            status = r.get("route_status") if isinstance(r, dict) else None
            if dest and hop and isinstance(status, str):
                routes.add((holder, owner.get(dest) or dest, owner.get(hop) or hop, status))
    return Snapshot(entries, tuple(sorted(routes)), (), tuple(sorted(parents)))


def parse_relays(answer: dict[str, Any]) -> tuple[tuple[str, tuple[str, ...]], ...]:
    """zigpy_routes.read_routes' answer as (device, relays) pairs: a relay is the IEEE of the device holding that network
    address, else the address text. A device whose record lists no relay is kept (a direct route is a finding)."""
    out = []
    for d in answer.get("devices") or []:
        device = _ieee(d.get("ieee")) if isinstance(d, dict) else None
        if device and isinstance(d.get("relays"), list):
            hops = [_ieee(r.get("ieee")) or _nwk(r.get("nwk")) for r in d["relays"] if isinstance(r, dict)]
            if None not in hops and len(hops) == len(d["relays"]):
                out.append((device, tuple(hops)))
    return tuple(sorted(out))


def _thread_value(direction: Any) -> tuple[int | None, int | None] | None:
    """(lqi 0-3, rssi dBm) of one direction object, or None unless the panel counts it as measured
    (from-matter.js reading): strength "unknown" and link quality 0 without a valid RSSI are no values."""
    if not isinstance(direction, dict) or direction.get("strength") == "unknown":
        return None
    lqi, rssi = direction.get("lqi"), direction.get("rssi")
    lqi = lqi if isinstance(lqi, int) and not isinstance(lqi, bool) and 0 <= lqi <= 3 else None
    rssi = rssi if isinstance(rssi, int) and not isinstance(rssi, bool) and _RSSI_RANGE[0] <= rssi <= _RSSI_RANGE[1] \
        else None
    return (lqi, rssi) if (lqi is not None and lqi > 0) or rssi is not None else None


def _seconds(value: Any) -> float | None:
    """A snapshot time as epoch seconds (milliseconds or seconds, like the panel's isoTime), or None."""
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not value > 0:
        return None
    return value / 1000 if value >= 1e12 else float(value)


def parse_thread(topology: Any) -> tuple[str, Snapshot, float | None] | None:
    """(network id, snapshot, time the Matter server collected it) of the largest Thread network in matter/network_topology, or None without a Thread node.

    Mirrors the panel (from-matter.js): Thread nodes that are no Wi-Fi access point; the largest extended PAN id wins
    and nodes without one stay; a duplicate node or connection is ignored (first wins). Network id and device keys as
    the panel builds them: `thread-` plus the extended PAN id without separators; the EUI-64 of a node, else
    `thread:<node id>`. A connection's source_to_target is "source hears target".
    """
    if not isinstance(topology, dict):
        raise SourceError("matter/network_topology did not return an object")
    nodes = [n for n in topology.get("nodes") or [] if isinstance(n, dict)
             and n.get("network_type") == "thread" and n.get("kind") != "wifi_ap"]
    if not nodes:
        return None
    pans: dict[str, int] = {}
    for n in nodes:
        pan = n.get("ext_pan_id")
        if isinstance(pan, str) and pan.strip():
            pans[pan.strip().lower()] = pans.get(pan.strip().lower(), 0) + 1
    pan = sorted(pans.items(), key=lambda p: (-p[1], p[0]))[0][0] if pans else ""
    keys: dict[str, tuple[str, bool]] = {}  # node id -> (device key, available)
    for n in nodes:
        node_pan = str(n.get("ext_pan_id") or "").strip().lower()
        if n.get("id") is None or str(n["id"]) in keys or (pan and node_pan and node_pan != pan):
            continue
        raw = str(n.get("ext_address") or "").strip().lower().removeprefix("0x").replace(":", "").replace("-", "")
        key = (_ieee(":".join(raw[i:i + 2] for i in range(0, 16, 2))) if len(raw) == 16 else None) \
            or f"thread:{n['id']}"
        if any(key == k for k, _ in keys.values()):
            continue
        keys[str(n["id"])] = (key, n.get("available") is not False)
    entries: Entries = {}
    seen: set[tuple[str, str]] = set()
    for c in topology.get("connections") or []:
        if not isinstance(c, dict) or c.get("network") != "thread":
            continue
        a, b = keys.get(str(c.get("source"))), keys.get(str(c.get("target")))
        if not a or not b or a[0] == b[0] or tuple(sorted((a[0], b[0]))) in seen:
            continue
        seen.add(tuple(sorted((a[0], b[0]))))
        for (receiver, ok), sender, direction in ((a, b[0], "source_to_target"), (b, a[0], "target_to_source")):
            value = _thread_value(c.get(direction)) if ok else None  # an unavailable node's table is stale
            if value is not None:
                entries[(receiver, sender)] = value
    return ("thread-" + (re.sub(r"[^A-Za-z0-9]", "", pan)[:32] or "unknown"), Snapshot(entries),
            _seconds(topology.get("collected_at")))


class Collected(NamedTuple):
    """networks by id, problems as text per source ("zha", "thread": the panel's source keys, so one network's problem
    never shows in the other's history, #15), and the time of each snapshot the source dates itself (Thread)."""

    networks: dict[str, Snapshot]
    problems: dict[str, list[str]]
    times: dict[str, float | None]


async def collect(hass: HomeAssistant, zigbee: bool = True, thread: bool = True) -> Collected:
    """Snapshots of the loaded sources asked for. A source that is not loaded is skipped silently; one that fails adds
    a problem text and does not stop the other."""
    out = Collected({}, {"zha": [], "thread": []}, {})
    components = getattr(getattr(hass, "config", None), "components", None) or ()
    if zigbee and "zha" in components:
        try:
            zha = hass.config_entries.async_entries("zha")
            if zha:
                snapshot = parse_zha(await call_command(hass, "zha/devices"))
                try:
                    snapshot = snapshot._replace(relays=parse_relays(read_routes(hass)))
                except NotSupported as err:  # no route records: the rest of the record stays valid
                    out.problems["zha"].append(f"zigpy route records: {err}")
                except Exception as err:  # noqa: BLE001 - zigpy internals: never raise into Home Assistant
                    out.problems["zha"].append(f"zigpy route records: {type(err).__name__}")
                out.networks[zha[0].entry_id] = snapshot
        except SourceError as err:
            out.problems["zha"].append(f"zha: {err}")
    if thread and "matter" in components:
        try:
            found = parse_thread(await call_command(hass, "matter/network_topology"))
            if found:
                out.networks[found[0]] = found[1]
                out.times[found[0]] = found[2]
        except SourceError as err:
            out.problems["thread"].append(f"matter: {err}")
    return out
