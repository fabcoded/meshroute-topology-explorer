# SPDX-License-Identifier: MIT
"""ZHA's topology scan, seen from outside: its configured period, and the events it fires while it scans.

zigpy's topology runs `_scan_loop` (sleep the period, scan) when the scan is enabled, and fires the listener events
`neighbors_updated` and `routes_updated` for each device while it does. This module only reads two config values and
attaches a listener to those events; it never starts a scan or changes ZHA (tools/guard.py keeps every scan call out). It
reaches zigpy through the same gateway access as zigpy_routes.py and fails the same way: NotSupported with a reason.
The period lives in ZHA's configuration.yaml (`zha: zigpy_config: topology_scan_period`, minutes, default 240, minimum
20); changing it needs a restart of Home Assistant Core, which this integration never does. Plan: docs/spec.md 10.1/10.2.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any, NamedTuple

from homeassistant.core import HomeAssistant

from .const import ZHA_DEFAULT_PERIOD
from .zigpy_routes import REASON_INTERNALS_CHANGED, NotSupported, _application

# zigpy.config CONF_TOPO_SCAN_PERIOD / CONF_TOPO_SCAN_ENABLED (read as plain keys: no zigpy import).
KEY_PERIOD = "topology_scan_period"
KEY_ENABLED = "topology_scan_enabled"


class ScanSettings(NamedTuple):
    """period in minutes and enabled; None where the application does not say."""

    period: int | None
    enabled: bool | None


def read_settings(hass: HomeAssistant) -> ScanSettings:
    """ZHA's configured scan period and switch. Raises NotSupported when ZHA has no running gateway."""
    config = getattr(_application(hass), "config", None)
    if not isinstance(config, Mapping):
        return ScanSettings(None, None)
    period, enabled = config.get(KEY_PERIOD), config.get(KEY_ENABLED)
    ok = isinstance(period, int) and not isinstance(period, bool) and period > 0
    return ScanSettings(period if ok else None, enabled if isinstance(enabled, bool) else None)


def effective_period(settings: ScanSettings | None) -> int:
    """The period a timer should follow: ZHA's, else its default."""
    return settings.period if settings and settings.period else ZHA_DEFAULT_PERIOD


def describe(settings: ScanSettings | None) -> str:
    """The read-only line of the options form."""
    if settings is None:
        return "ZHA's scan period cannot be read (ZHA is not running)"
    if settings.enabled is False:
        return "ZHA's topology scan is off"
    return f"ZHA scans every {settings.period or ZHA_DEFAULT_PERIOD} min" + ("" if settings.period else " (default)")


class _Listener:
    """zigpy calls the method named like the event on every listener."""

    def __init__(self, callback: Callable[[], None]) -> None:
        self._callback = callback

    def neighbors_updated(self, *args: Any, **kwargs: Any) -> None:
        self._callback()

    def routes_updated(self, *args: Any, **kwargs: Any) -> None:
        self._callback()


def attach(hass: HomeAssistant, callback: Callable[[], None]) -> Callable[[], None]:
    """Call `callback` on each topology event; returns the detach function. Raises NotSupported."""
    topology = getattr(_application(hass), "topology", None)
    add, remove = getattr(topology, "add_listener", None), getattr(topology, "remove_listener", None)
    if not (callable(add) and callable(remove)):
        raise NotSupported(REASON_INTERNALS_CHANGED, "zigpy's topology takes no listeners")
    listener = _Listener(callback)
    add(listener)

    def detach() -> None:
        try:
            remove(listener)
        except Exception:  # noqa: BLE001 - zigpy internals; a failed removal must not break the unload
            pass

    return detach
