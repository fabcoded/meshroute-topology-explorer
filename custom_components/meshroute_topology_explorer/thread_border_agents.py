# SPDX-License-Identifier: MIT
"""Thread border agents as Home Assistant's mDNS cache holds them: websocket command
meshroute_topology_explorer/thread_border_agents (#21).

Spec 3.2 ("Partitions") and 3.4. Read only and in memory: for every `_meshcop._udp.local.` service in the cache of
Home Assistant's shared zeroconf instance, the border agent's extended address (TXT key `xa`), extended PAN id (`xp`),
partition id (`pt`) and the age of its TXT record. Nothing is sent: no query, no browser, no service lookup of its own;
the panel's Thread engine compares the partition ids (frontend/engines/thread/split.js).

Where the data lives (zeroconf 0.151.5 in Home Assistant 2026.10.4, 0.152.0 in 2026.11.0; contract test
tests_ha/test_zeroconf_contract.py):
- homeassistant.components.zeroconf.async_get_async_zeroconf(hass) returns the shared instance; it creates one where
  none exists (zeroconf/__init__.py _async_get_instance), so it is called only while the zeroconf integration is
  loaded, which has created it.
- `.zeroconf.cache.async_all_by_details(type, PTR, IN)` lists the type's pointer records, one per service instance
  (`alias`); `cache.get_by_details(alias, TXT, IN)` is that instance's TXT record, the one zeroconf's ServiceInfo loads
  from the cache (_services/info.py _load_from_cache). Home Assistant's Thread diagnostics read the cache the same way
  (homeassistant/components/thread/discovery.py async_read_zeroconf_cache). Expired records are skipped.
- A record's `created` is when Home Assistant last received it, in zeroconf's monotonic milliseconds
  (zeroconf.current_time_millis); a record received again replaces the cached one (_handlers/record_manager.py
  async_updates_from_response, _cache.py _async_add).
- Home Assistant keeps the cache current itself: its zeroconf integration browses every type of
  homeassistant/generated/zeroconf.py for as long as it runs (zeroconf/discovery.py ZeroconfDiscovery.async_setup), and
  `_meshcop._udp.local.` is among them because the Thread integration's manifest lists it.
- TXT keys (OpenThread API reference, Border Agent, OT_BORDER_AGENT_MESHCOP_SERVICE_TXT_DATA_MAX_LENGTH, read
  2026-11-15): Extended Address `xa` and ExtendedPanId `xp` 8 bytes, Partition Id `pt` 4 bytes. Assumption: `pt` is
  big-endian; the reference names no byte order, and read so it equalled the routers' own partition id on the owner's
  network on 2026-11-15 (two border routers of different vendors). The state bitmap `sb` is not read: no public
  source this project may use gives its bit layout (maintainer 2026-11-15).
Nothing else of a record leaves: no addresses, host or instance names, border agent id, prefixes or domain names.
Every failure answers `not_supported` with "<reason>: <text>"; nothing is raised into Home Assistant.
"""

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
    """The key=value strings of a TXT record's data (RFC 6763 6.1-6.4): each string a length byte and its bytes; keys
    in lower case (6.4: case-insensitive) and only their first occurrence (6.4: later ones are ignored); a key without
    '=' has no value (None); an empty key and a string cut short by the end of the data are left out."""
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
    """One border agent from its TXT record, or None where the record names no 8-byte extended address and extended
    PAN id (it cannot be placed in a network)."""
    values = txt_values(bytes(txt.text))
    xa, xp, pt = values.get(b"xa"), values.get(b"xp"), values.get(b"pt")
    if xa is None or len(xa) != 8 or xp is None or len(xp) != 8:
        return None
    created = txt.created
    age = (now_ms - created) / 1000 if isinstance(created, (int, float)) and not isinstance(created, bool) else None
    return {"ext_address": xa.hex(), "ext_pan_id": xp.hex(),
            "partition_id": int.from_bytes(pt, "big") if pt is not None and len(pt) == 4 else None,
            "age": round(age, 1) if age is not None and age >= 0 else None}


def _cache(hass: HomeAssistant) -> tuple[Any, Any]:
    """Zeroconf's record cache and its clock, or NotSupported with the reason why not."""
    if "zeroconf" not in (getattr(getattr(hass, "config", None), "components", None) or ()):
        raise NotSupported(REASON_ZEROCONF_NOT_LOADED, "zeroconf is not loaded")
    try:
        # Imported here: the module pulls in the zeroconf library, which only a loaded zeroconf integration needs.
        from homeassistant.components.zeroconf import async_get_async_zeroconf
        from zeroconf import current_time_millis
    except ImportError as err:
        raise NotSupported(REASON_INTERNALS_CHANGED, f"zeroconf's helpers are not where they were ({err})") from None
    cache = getattr(getattr(async_get_async_zeroconf(hass), "zeroconf", None), "cache", None)
    if not all(callable(getattr(cache, name, None)) for name in ("async_all_by_details", "get_by_details")):
        raise NotSupported(REASON_INTERNALS_CHANGED, "the zeroconf instance has no record cache as expected")
    return cache, current_time_millis


def read_agents(hass: HomeAssistant) -> dict[str, Any]:
    """{agents: [{ext_address, ext_pan_id (16 hex digits, lower case), partition_id (uint32 or null), age (seconds
    since Home Assistant received the TXT record, or null)}], read_at (epoch seconds)}, sorted by extended address,
    then age. Raises NotSupported."""
    cache, clock = _cache(hass)
    now_ms = clock()
    agents = []
    try:
        for pointer in cache.async_all_by_details(SERVICE_TYPE, TYPE_PTR, CLASS_IN):
            if pointer.is_expired(now_ms):
                continue
            txt = cache.get_by_details(pointer.alias, TYPE_TXT, CLASS_IN)
            if txt is not None and not txt.is_expired(now_ms) and (agent := _agent(txt, now_ms)) is not None:
                agents.append(agent)
    except (AttributeError, TypeError) as err:
        raise NotSupported(REASON_INTERNALS_CHANGED, f"a record is not shaped as expected ({type(err).__name__})") from None
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
