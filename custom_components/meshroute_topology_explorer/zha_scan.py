# SPDX-License-Identifier: MIT
"""ZHA's topology scan, seen from outside: its configured period, whether a scan is running, and its events.

zigpy's topology runs `_scan_loop` (sleep the period, scan) when the scan is enabled, and fires the listener events
`neighbors_updated` and `routes_updated` for each device while it does. zigpy replaces the stored tables router by
router during a scan, so nothing may read them until the scan task (`_scan_task`) is done. This module only reads two
config values and the task's state, and attaches a listener to the events; it never starts a scan or changes ZHA
(tools/guard.py keeps every scan call out). Every ZHA (re)load builds a new application and topology, so the caller
re-resolves the topology (`topology()`) and attaches again when it changed. It
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
    if settings is None or settings.period is None:
        return "ZHA's scan period is unknown"
    if settings.enabled is False:
        return ("ZHA's topology scan is off (a changed period would also need `topology_scan_enabled: true` in "
                "configuration.yaml)")
    return f"ZHA scans every {settings.period} min"


def topology(hass: HomeAssistant) -> Any:
    """The running application's topology object. Raises NotSupported."""
    found = getattr(_application(hass), "topology", None)
    if found is None:
        raise NotSupported(REASON_INTERNALS_CHANGED, "the application has no topology")
    return found


def scan_state(found: Any) -> tuple[str, Any]:
    """("running" | "idle" | "unknown", the scan task): zigpy's `_scan_task` is a task while a scan is running (and
    after it, done); the attribute is internal, so a topology without it gives "unknown"."""
    task = getattr(found, "_scan_task", False)
    if task is None:
        return "idle", None
    done = getattr(task, "done", None)
    if task is False or not callable(done):
        return "unknown", None
    return ("idle" if done() else "running"), task


class _Listener:
    """zigpy calls the method named like the event on every listener."""

    def __init__(self, callback: Callable[[], None]) -> None:
        self._callback = callback

    def neighbors_updated(self, *args: Any, **kwargs: Any) -> None:
        self._callback()

    def routes_updated(self, *args: Any, **kwargs: Any) -> None:
        self._callback()


def attach(found: Any, callback: Callable[[], None]) -> Callable[[], None]:
    """Call `callback` on each event of this topology; returns the detach function (which drops the reference to the
    topology). Raises NotSupported."""
    add, remove = getattr(found, "add_listener", None), getattr(found, "remove_listener", None)
    if not (callable(add) and callable(remove)):
        raise NotSupported(REASON_INTERNALS_CHANGED, "zigpy's topology takes no listeners")
    listener = _Listener(callback)
    add(listener)

    def detach() -> None:
        nonlocal found
        try:
            found.remove_listener(listener)
        except Exception:  # noqa: BLE001 - zigpy internals; a failed removal must not break the unload
            pass
        found = None  # the old application must not be kept alive by us

    return detach
