# SPDX-License-Identifier: MIT
"""Websocket commands of the panel: settings and observations per network (docs/spec.md section 10).

Commands: meshroute_topology_explorer/{settings,observations}/{get,set}. Registered once per Home Assistant run
(commands cannot be unregistered). They stay answerable after the config entry is unloaded: the store lives in
hass.data and the panel is simply gone, so nobody calls them.
"""

from __future__ import annotations

import json
import re
from typing import Any

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from .const import DOMAIN, MAX_PAYLOAD_BYTES, NETWORK_ID_PATTERN
from .store import KINDS, PanelStore, StoreUnavailable

ERR_PAYLOAD_TOO_LARGE = "payload_too_large"
ERR_STORAGE_UNAVAILABLE = "storage_unavailable"

_REGISTERED_KEY = f"{DOMAIN}_ws_registered"
_STORE_KEY = f"{DOMAIN}_store"
_NETWORK_RE = re.compile(NETWORK_ID_PATTERN)


def _passthrough(msg: dict[str, Any]) -> dict[str, Any]:
    """Message schema that accepts everything: the handler validates itself and answers with specific codes.

    Home Assistant calls the registered schema as schema(msg) (websocket_api/connection.py, async_handle) and
    maps only its own Invalid exception to invalid_format; a plain callable keeps this module independent of
    which validation library the core uses, and lets the handler report payload_too_large separately.
    """
    return msg


def _serialized_size(value: Any) -> int:
    """UTF-8 size of the compact JSON form; raises ValueError for NaN/Infinity or unserializable values."""
    return len(json.dumps(value, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode("utf-8"))


def _make_handler(kind: str, writing: bool):
    """Build the async handler for one (kind, get/set) pair; one body instead of four copies."""

    async def handler(hass: HomeAssistant, connection: Any, msg: dict[str, Any]) -> None:
        msg_id = msg["id"]
        # Own admin check on top of the panel's require_admin: the commands carry data of the whole house.
        user = connection.user
        if user is None or not user.is_admin:
            connection.send_error(msg_id, websocket_api.ERR_UNAUTHORIZED, "Unauthorized")
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
            except (ValueError, TypeError):
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


def _get_store(hass: HomeAssistant) -> PanelStore:
    """The one store object per Home Assistant run; kept across unload and reload of the entry."""
    if _STORE_KEY not in hass.data:
        hass.data[_STORE_KEY] = PanelStore(hass)
    return hass.data[_STORE_KEY]


def async_register_commands(hass: HomeAssistant) -> None:
    """Register the four commands, once per run."""
    if hass.data.get(_REGISTERED_KEY):
        return
    for kind in KINDS:
        for writing in (False, True):
            command = f"{DOMAIN}/{kind}/{'set' if writing else 'get'}"
            websocket_api.async_register_command(hass, command, _make_handler(kind, writing), _passthrough)
    hass.data[_REGISTERED_KEY] = True
