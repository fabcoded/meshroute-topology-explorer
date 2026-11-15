# SPDX-License-Identifier: MIT
"""Websocket command meshroute_topology_explorer/thread_border_agents (#21), called by the panel's Matter adapter: per
`_meshcop._udp` border agent in Home Assistant's mDNS cache its extended address, extended PAN id, partition id and
the age of its TXT record (spec 3.2 "Partitions", 3.4). It reads the cache of the zeroconf instance Home Assistant
runs and never sends, announces, browses, looks up a service, or creates or closes an instance (tools/guard.py
PY_DENY). Failures answer `not_supported` with "<reason>: <text>"."""

from __future__ import annotations

import logging
import time
from typing import Any

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from .admin import check_admin
from .const import DOMAIN
from .thread_tables import REASON_ERROR, REASON_INTERNALS_CHANGED, NotSupported

COMMAND = f"{DOMAIN}/thread_border_agents"
REASON_ZEROCONF_NOT_LOADED = "zeroconf_not_loaded"
SERVICE_TYPE = "_meshcop._udp.local."
# DNS record types and class (RFC 1035 3.2.2 and 3.2.4), as Home Assistant's Thread discovery spells them.
TYPE_PTR, TYPE_TXT, CLASS_IN = 12, 16, 1

_LOGGER = logging.getLogger(__name__)


def txt_values(text: bytes) -> dict[bytes, bytes | None]:
    """The key=value strings of TXT data (RFC 6763 6.1-6.4): keys in lower case, first occurrence only, None without
    '='; an empty key and a string cut short by the end are left out."""
    values: dict[bytes, bytes | None] = {}
    pos = 0
    while pos < len(text):
        end = pos + 1 + text[pos]
        if end > len(text):
            break
        key, sep, value = text[pos + 1:end].partition(b"=")
        if key and key.lower() not in values:
            values[key.lower()] = value if sep else None
        pos = end
    return values


def _agent(txt: Any, now_ms: float) -> dict[str, Any] | None:
    """One border agent from its TXT record, or None without an 8-byte extended address and extended PAN id."""
    values = txt_values(bytes(txt.text))
    xa, xp, pt = values.get(b"xa"), values.get(b"xp"), values.get(b"pt")
    if xa is None or len(xa) != 8 or xp is None or len(xp) != 8:
        return None
    created = txt.created
    age = (now_ms - created) / 1000 if isinstance(created, (int, float)) and not isinstance(created, bool) else None
    return {"ext_address": xa.hex(), "ext_pan_id": xp.hex(),
            # Big-endian is an assumption from one measurement (spec 3.2 "Partitions").
            "partition_id": int.from_bytes(pt, "big") if pt is not None and len(pt) == 4 else None,
            "age": round(age, 1) if age is not None and age >= 0 else None}


def read_agents(hass: HomeAssistant) -> dict[str, Any]:
    """{agents: [{ext_address, ext_pan_id, partition_id, age}], read_at}, sorted by address, then age. Raises
    NotSupported."""
    # Only while zeroconf is loaded: its accessor creates an instance where none exists.
    if "zeroconf" not in (getattr(getattr(hass, "config", None), "components", None) or ()):
        raise NotSupported(REASON_ZEROCONF_NOT_LOADED, "zeroconf is not loaded")
    try:
        # Imported here: only a loaded zeroconf integration needs the library.
        from homeassistant.components.zeroconf import async_get_async_zeroconf
        from zeroconf import current_time_millis
    except ImportError as err:
        raise NotSupported(REASON_INTERNALS_CHANGED, f"zeroconf's helpers are not where they were ({err})") from None
    now_ms = current_time_millis()
    agents = []
    try:
        cache = async_get_async_zeroconf(hass).zeroconf.cache
        for pointer in cache.async_all_by_details(SERVICE_TYPE, TYPE_PTR, CLASS_IN):
            txt = None if pointer.is_expired(now_ms) else cache.get_by_details(pointer.alias, TYPE_TXT, CLASS_IN)
            if txt is not None and not txt.is_expired(now_ms) and (agent := _agent(txt, now_ms)) is not None:
                agents.append(agent)
    except (AttributeError, TypeError) as err:
        raise NotSupported(REASON_INTERNALS_CHANGED, f"zeroconf is not shaped as expected ({type(err).__name__})") from None
    agents.sort(key=lambda a: (a["ext_address"], a["age"] is None, a["age"] or 0))
    return {"agents": agents, "read_at": time.time()}


@websocket_api.async_response
async def ws_thread_border_agents(hass: HomeAssistant, connection: Any, msg: dict[str, Any]) -> None:
    """Answer with read_agents; admin only, like thread/*. Waits for nothing: the cache is read in memory."""
    msg_id = msg["id"]
    if not check_admin(connection, msg_id):
        return
    try:
        result = read_agents(hass)
    except NotSupported as err:
        connection.send_error(msg_id, websocket_api.ERR_NOT_SUPPORTED, str(err))
        return
    except Exception as err:
        _LOGGER.debug("Reading the border agents from the zeroconf cache failed", exc_info=True)
        connection.send_error(msg_id, websocket_api.ERR_NOT_SUPPORTED, f"{REASON_ERROR}: {type(err).__name__}")
        return
    connection.send_result(msg_id, result)
