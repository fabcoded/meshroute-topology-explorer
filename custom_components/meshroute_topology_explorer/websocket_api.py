# SPDX-License-Identifier: MIT
"""Websocket commands of the panel: settings and observations per network (docs/spec.md section 10).

Commands: meshroute_topology_explorer/{settings,observations}/{get,set}, and zigpy_routes (zigpy_routes.py: zigpy's
route records, read only), history/series, history/records and history/info (recorder.py, reception history, read only). Registered once per Home Assistant run
(commands cannot be unregistered). They stay answerable after the config entry is unloaded: the store lives in
hass.data and the panel is simply gone, so nobody calls them.
"""

from __future__ import annotations

import re
import time
from typing import Any

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant
from homeassistant.helpers.json import json_bytes

from .admin import check_admin
from .const import DOMAIN, MAX_PAYLOAD_BYTES, NETWORK_ID_PATTERN
from .recorder import async_info, get_history
from .store import KINDS, PanelStore, StoreUnavailable
from .zigpy_routes import COMMAND as ZIGPY_ROUTES_COMMAND
from .zigpy_routes import ws_zigpy_routes

ERR_PAYLOAD_TOO_LARGE = "payload_too_large"
ERR_STORAGE_UNAVAILABLE = "storage_unavailable"

_REGISTERED_KEY = f"{DOMAIN}_ws_registered"
_STORE_KEY = f"{DOMAIN}_store"
_NETWORK_RE = re.compile(NETWORK_ID_PATTERN)
SERIES_COMMAND = f"{DOMAIN}/history/series"
INFO_COMMAND = f"{DOMAIN}/history/info"
RECORDS_COMMAND = f"{DOMAIN}/history/records"


def _passthrough(msg: dict[str, Any]) -> dict[str, Any]:
    """Message schema that accepts everything: the handler validates itself and answers with specific codes.

    Home Assistant calls the registered schema as schema(msg) (websocket_api/connection.py, async_handle) and
    maps only its own Invalid exception to invalid_format; a plain callable keeps this module independent of
    which validation library the core uses, and lets the handler report payload_too_large separately.
    """
    return msg


def _serialized_size(value: Any) -> int:
    """UTF-8 size of the payload as Home Assistant's own JSON writer sees it; raises if that writer would fail.

    The store is written with orjson (helpers/json.py:189-196, prepare_save_json 199-233); a payload orjson cannot
    write (nesting beyond its limit, unserializable values) would make every later save of the whole file fail,
    and storage.py:588-589 only logs that and drops the data. json_bytes (helpers/json.py:61-66) is the same
    orjson with the same options, minus indentation, so it fails exactly when the store write would.
    """
    return len(json_bytes(value))


def _make_handler(kind: str, writing: bool):
    """Build the async handler for one (kind, get/set) pair; one body instead of four copies."""

    async def handler(hass: HomeAssistant, connection: Any, msg: dict[str, Any]) -> None:
        msg_id = msg["id"]
        # Own admin check on top of the panel's require_admin: the commands carry data of the whole house.
        if not check_admin(connection, msg_id):
            return
        network = msg.get("network")
        if not isinstance(network, str) or not _NETWORK_RE.fullmatch(network):
            connection.send_error(msg_id, websocket_api.ERR_INVALID_FORMAT, "network must be 1-64 characters of A-Za-z0-9_.:-")
            return
        store: PanelStore = _get_store(hass)
        try:
            if not writing:
                connection.send_result(msg_id, {kind: await store.async_get(network, kind)})
                return
            payload = msg.get(kind)
            if not isinstance(payload, dict):
                connection.send_error(msg_id, websocket_api.ERR_INVALID_FORMAT, f"{kind} must be an object")
                return
            try:
                size = _serialized_size(payload)
            except (ValueError, TypeError, RecursionError):  # orjson.JSONEncodeError is a TypeError
                connection.send_error(msg_id, websocket_api.ERR_INVALID_FORMAT, f"{kind} is not valid JSON")
                return
            if size > MAX_PAYLOAD_BYTES:
                connection.send_error(msg_id, ERR_PAYLOAD_TOO_LARGE, f"{kind} is {size} bytes, limit is {MAX_PAYLOAD_BYTES}")
                return
            await store.async_set(network, kind, payload)
            connection.send_result(msg_id, {})
        except StoreUnavailable:
            connection.send_error(msg_id, ERR_STORAGE_UNAVAILABLE, "Stored data cannot be read; see the Home Assistant log")

    handler.__name__ = f"ws_{kind}_{'set' if writing else 'get'}"
    return websocket_api.async_response(handler)


@websocket_api.async_response
async def ws_history_series(hass: HomeAssistant, connection: Any, msg: dict[str, Any]) -> None:
    """Reception values of one lane since a time: {sender_to_receiver, receiver_to_sender}, each a list of
    [time, lqi(, rssi)]. sender_to_receiver is what the receiver's table reported for the sender (it hears it)."""
    msg_id = msg["id"]
    if not check_admin(connection, msg_id):
        return
    network, sender, receiver, since = (msg.get(k) for k in ("network", "sender", "receiver", "since"))
    fields_ok = all(isinstance(v, str) and _NETWORK_RE.fullmatch(v) for v in (network, sender, receiver))
    if not fields_ok or isinstance(since, bool) or not isinstance(since, (int, float)) or since < 0:
        connection.send_error(msg_id, websocket_api.ERR_INVALID_FORMAT,
                              "network, sender and receiver: 1-64 characters of A-Za-z0-9_.:-; since: epoch seconds")
        return
    history = get_history(hass)
    # Device keys are stored in lower case (IEEE, Thread extended address); ask the same way.
    sender, receiver = sender.lower(), receiver.lower()
    connection.send_result(msg_id, {
        "sender_to_receiver": await history.run(history.files.series, network, receiver, sender, since),
        "receiver_to_sender": await history.run(history.files.series, network, sender, receiver, since)})


def _is_time(value: Any) -> bool:
    return not isinstance(value, bool) and isinstance(value, (int, float)) and value >= 0


@websocket_api.async_response
async def ws_history_records(hass: HomeAssistant, connection: Any, msg: dict[str, Any]) -> None:
    """All tables of a network for a time range, in the file format with one key table: {k, records} (spec 10.2).
    `until` is optional (default: now). A record `{t}` alone repeats the previous one; the first is full."""
    msg_id = msg["id"]
    if not check_admin(connection, msg_id):
        return
    network, since = msg.get("network"), msg.get("since")
    until = msg.get("until", time.time())
    if not (isinstance(network, str) and _NETWORK_RE.fullmatch(network) and _is_time(since) and _is_time(until)):
        connection.send_error(msg_id, websocket_api.ERR_INVALID_FORMAT,
                              "network: 1-64 characters of A-Za-z0-9_.:-; since and until: epoch seconds")
        return
    history = get_history(hass)
    connection.send_result(msg_id, await history.run(history.files.records, network, since, until))


@websocket_api.async_response
async def ws_history_info(hass: HomeAssistant, connection: Any, msg: dict[str, Any]) -> None:
    """Size of the history: records, first and last time (epoch seconds), bytes on disk, the last problem."""
    if check_admin(connection, msg["id"]):
        connection.send_result(msg["id"], await async_info(hass))


def _get_store(hass: HomeAssistant) -> PanelStore:
    """The one store object per Home Assistant run; kept across unload and reload of the entry."""
    if _STORE_KEY not in hass.data:
        hass.data[_STORE_KEY] = PanelStore(hass)
    return hass.data[_STORE_KEY]


async def async_remove_data(hass: HomeAssistant) -> None:
    """Delete everything the panel stored; called when the integration is removed."""
    await _get_store(hass).async_remove()


def async_register_commands(hass: HomeAssistant) -> None:
    """Register the eight commands, once per run."""
    if hass.data.get(_REGISTERED_KEY):
        return
    for kind in KINDS:
        for writing in (False, True):
            command = f"{DOMAIN}/{kind}/{'set' if writing else 'get'}"
            websocket_api.async_register_command(hass, command, _make_handler(kind, writing), _passthrough)
    websocket_api.async_register_command(hass, ZIGPY_ROUTES_COMMAND, ws_zigpy_routes, _passthrough)
    websocket_api.async_register_command(hass, SERIES_COMMAND, ws_history_series, _passthrough)
    websocket_api.async_register_command(hass, RECORDS_COMMAND, ws_history_records, _passthrough)
    websocket_api.async_register_command(hass, INFO_COMMAND, ws_history_info, _passthrough)
    hass.data[_REGISTERED_KEY] = True
