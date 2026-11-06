# SPDX-License-Identifier: MIT
"""Read zigpy's route records (source routes) for the panel: websocket command meshroute_topology_explorer/zigpy_routes.

Spec 3.4 and 5.1 ("read from zigpy"). Read only and in memory: the handler reads what zigpy already holds and never
sends anything to the radio, awaits nothing and touches nothing but each device's IEEE address, network address and
relay list. Network settings, keys and their saved copies stay out of reach (tools/guard.py PY_DENY).

Where the data lives (Home Assistant core 2026.10.1, zigpy 2.4.0):
- homeassistant/components/zha/helpers.py get_zha_gateway(hass) returns ZHA's gateway; its `application_controller`
  is zigpy's ControllerApplication, which core itself reads for zha/devices (helpers.py, zha_device_info).
- zigpy ControllerApplication.devices maps EUI64 to devices; a Zigbee device's `relays` is None until a route record
  arrived, then the relays from the device towards the coordinator (zigpy builds its own source route as the list
  reversed, application.py build_source_route_to). zigpy stores the list without a time, so its age is unknown.
Every failure answers the error code `not_supported` with "<reason>: <text>"; nothing is raised into Home Assistant.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from typing import Any

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from .admin import check_admin

COMMAND = "meshroute_topology_explorer/zigpy_routes"
# Reasons the panel can tell apart (the text after the colon is for people).
REASON_ZHA_NOT_LOADED = "zha_not_loaded"
REASON_NO_GATEWAY = "no_gateway"
REASON_INTERNALS_CHANGED = "internals_changed"
REASON_ERROR = "error"

_LOGGER = logging.getLogger(__name__)


class NotSupported(Exception):
    """The data cannot be read; carries a reason key for the panel and a text for people."""

    def __init__(self, reason: str, text: str) -> None:
        super().__init__(f"{reason}: {text}")
        self.reason = reason


def _nwk(value: Any) -> int | None:
    """A 16-bit network address as a plain int (zigpy's NWK is an int subclass), else None."""
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    number = int(value)
    return number if 0 <= number <= 0xFFFF else None


def _application(hass: HomeAssistant) -> Any:
    """zigpy's ControllerApplication behind ZHA, or NotSupported with the reason why not."""
    components = getattr(getattr(hass, "config", None), "components", None) or ()
    if "zha" not in components:
        raise NotSupported(REASON_ZHA_NOT_LOADED, "ZHA is not loaded")
    try:
        # Imported here, not at module level: the integration must load without ZHA, and once ZHA is loaded the module
        # is already imported, so this does not touch the disk inside the event loop.
        from homeassistant.components.zha.helpers import get_zha_gateway
    except ImportError as err:
        raise NotSupported(REASON_INTERNALS_CHANGED, f"ZHA's helper is not where it was ({err})") from None
    try:
        gateway = get_zha_gateway(hass)
    except (ValueError, KeyError, AttributeError):
        # helpers.py raises ValueError while ZHA starts, stops or has failed.
        raise NotSupported(REASON_NO_GATEWAY, "ZHA has no running gateway") from None
    app = getattr(gateway, "application_controller", None)
    if app is None:
        raise NotSupported(REASON_INTERNALS_CHANGED, "the gateway has no application_controller")
    return app


def read_routes(hass: HomeAssistant) -> dict[str, Any]:
    """Every device with a route record: {"radio", "devices": [{"ieee", "nwk", "relays": [{"nwk", "ieee"}]}]}.

    radio is the top module of zigpy's application class (zigpy_znp, bellows, ...): which radio library filled the
    records. A relay's ieee is the device that holds that network address now, or None if none or several do.
    Raises NotSupported.
    """
    app = _application(hass)
    devices = getattr(app, "devices", None)
    if not isinstance(devices, Mapping):
        raise NotSupported(REASON_INTERNALS_CHANGED, "the application has no device dictionary")
    snapshot = list(devices.values())
    owner: dict[int, str | None] = {}
    for dev in snapshot:
        nwk = _nwk(getattr(dev, "nwk", None))
        if nwk is not None:
            # Two devices with one address (a stale entry next to a rejoined device): the relay cannot be named.
            owner[nwk] = None if nwk in owner else str(getattr(dev, "ieee", None))
    out = []
    with_attribute = 0
    for dev in snapshot:
        # Green Power devices have no relays attribute: only Zigbee devices take part in routing.
        if not hasattr(dev, "relays"):
            continue
        with_attribute += 1
        relays = dev.relays
        if relays is None:
            continue
        try:
            hops = [_nwk(r) for r in relays]
        except TypeError:
            raise NotSupported(REASON_INTERNALS_CHANGED, "a relay list is not a list") from None
        if any(h is None for h in hops):
            raise NotSupported(REASON_INTERNALS_CHANGED, "a relay is not a network address")
        out.append({
            "ieee": str(getattr(dev, "ieee", None)),
            "nwk": _nwk(getattr(dev, "nwk", None)),
            "relays": [{"nwk": h, "ieee": owner.get(h)} for h in hops],
        })
    if snapshot and not with_attribute:
        # The coordinator itself is a Zigbee device, so at least one device must know the attribute.
        raise NotSupported(REASON_INTERNALS_CHANGED, "no device has a relays attribute")
    return {"radio": type(app).__module__.split(".")[0], "devices": out}


@websocket_api.async_response
async def ws_zigpy_routes(hass: HomeAssistant, connection: Any, msg: dict[str, Any]) -> None:
    """Answer with read_routes; admin only, like zha/*. Awaits nothing, so it never waits for the radio."""
    msg_id = msg["id"]
    if not check_admin(connection, msg_id):
        return
    try:
        result = read_routes(hass)
    except NotSupported as err:
        connection.send_error(msg_id, websocket_api.ERR_NOT_SUPPORTED, str(err))
        return
    except Exception as err:
        _LOGGER.debug("Reading zigpy's route records failed", exc_info=True)
        connection.send_error(msg_id, websocket_api.ERR_NOT_SUPPORTED, f"{REASON_ERROR}: {type(err).__name__}")
        return
    connection.send_result(msg_id, result)
