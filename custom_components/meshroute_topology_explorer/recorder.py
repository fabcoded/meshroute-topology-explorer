# SPDX-License-Identifier: MIT
"""Records the reception history after ZHA's own topology scans, prunes it, and answers the read commands' questions.

When to record (owner decision 2026-11-03): ZHA's topology fires events while it scans; a listener on them records once
they have been quiet for DEBOUNCE seconds ("events"). Where that is not possible (no listener to attach, ZHA's scan
off or not running) a timer at ZHA's scan period (240 min without ZHA) records instead ("timer"). Thread has no events:
its own timer runs at ZHA's period. A network is never recorded twice within MIN_GAP seconds. Per Home Assistant run
one HistoryFiles object (the previous record per network lives in it) and one status; a config entry reload only
restarts the listener and timers. Read only: sources.py takes what ZHA and the Matter server hold and never
starts a scan. A failed or empty read writes nothing (a missing table is not a table without neighbours).
Plan: docs/spec.md section 10.2.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Callable
from datetime import timedelta
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.event import async_call_later, async_track_time_interval
from homeassistant.helpers.start import async_at_started

from .const import CONF_KEEP_DAYS, CONF_PENDING_ZHA_PERIOD, CONF_RECORD, DOMAIN, HISTORY_DIR
from .history import HistoryFiles
from .options import get_options
from .sources import collect
from .zha_scan import ScanSettings, attach, effective_period, read_settings
from .zigpy_routes import NotSupported

_LOGGER = logging.getLogger(__name__)
_KEY = f"{DOMAIN}_history"
FIRST_RECORD_DELAY = 30  # seconds after Home Assistant has started (or after a reload): the sources have their tables
DEBOUNCE = 60  # seconds without a topology event before the scan counts as finished
MIN_GAP = 600  # seconds between two records of a network, whatever triggers them (manual scans in between)
PRUNE_ONLY_HOURS = 6  # recording off: old files still expire
THREAD_PREFIX = "thread-"


class History:
    """Files, serialisation of their use, and the last problem (shown by the info command)."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.files = HistoryFiles(hass.config.path(".storage", HISTORY_DIR))
        self.lock = asyncio.Lock()  # HistoryFiles is not thread-safe: one executor job at a time
        self.last_error: str | None = None
        # Bumped by every delete: a record that was collected before it must not be written after it.
        self.generation = 0
        self.last_recorded: dict[str, float] = {}
        self.follow_mode: str | None = None  # "events" | "timer"; None while recording is off or not started
        self.options: dict[str, Any] = {}

    async def run(self, func: Callable[..., Any], *args: Any, generation: int | None = None) -> Any:
        """Run a HistoryFiles method in the executor, one at a time; with `generation`, only if no delete happened
        since (checked under the lock, so a delete and an append never interleave)."""
        async with self.lock:
            if generation is not None and generation != self.generation:
                return None
            return await self.hass.async_add_executor_job(func, *args)

    async def record(self, keep_days: int, now: float | None = None, thread_only: bool = False) -> None:
        """Take what the sources hold now, append one record per network (not within MIN_GAP of the last one), then
        drop expired day files. thread_only: the timer that runs beside the ZHA events."""
        now = time.time() if now is None else now
        generation = self.generation
        try:
            networks, problems = await collect(self.hass)
            error = "; ".join(problems) or None
            if error and error != self.last_error:
                _LOGGER.warning("Reception history: %s", error)  # once per change, not once per interval
            self.last_error = error
            for network, snapshot in networks.items():
                due = now - self.last_recorded.get(network, float("-inf")) >= MIN_GAP
                if due and not snapshot.is_empty() and (network.startswith(THREAD_PREFIX) or not thread_only):
                    self.last_recorded[network] = now
                    await self.run(self.files.append, network, now, snapshot, generation=generation)
        finally:
            await self.run(self.files.prune, now, keep_days)  # expiry must not depend on a failing source

    async def prune(self, keep_days: int) -> None:
        await self.run(self.files.prune, time.time(), keep_days)

    async def delete_all(self) -> None:
        self.generation += 1
        await self.run(self.files.delete_all)


def get_history(hass: HomeAssistant) -> History:
    """The one History per Home Assistant run."""
    if _KEY not in hass.data:
        hass.data[_KEY] = History(hass)
    return hass.data[_KEY]


def start_recording(hass: HomeAssistant, options: dict[str, Any]) -> list[Callable[[], None]]:
    """Start recording for these options (as read by get_options) once Home Assistant has started; returns the
    functions that stop everything again (for the entry's unload)."""
    history = get_history(hass)
    history.options, history.follow_mode = options, None
    keep, recording = options[CONF_KEEP_DAYS], options[CONF_RECORD]
    active: list[Callable[[], None]] = []  # what `started` set up
    debounce: list[Callable[[], None]] = []  # the pending debounce timer, if any

    async def run(thread_only: bool = False) -> None:
        try:
            await (history.record(keep, thread_only=thread_only) if recording else history.prune(keep))
        except Exception as err:  # noqa: BLE001 - a timer callback: log and try again at the next trigger
            message = f"recording failed: {type(err).__name__}: {err}"
            if message != history.last_error:  # once per change, like the source problems
                _LOGGER.exception("Reception history failed")
            history.last_error = message

    async def run_all(_now: Any = None) -> None:
        await run()

    async def run_thread(_now: Any = None) -> None:
        await run(thread_only=True)

    def on_event() -> None:
        """A topology event: record when no further one follows for DEBOUNCE seconds."""
        while debounce:
            debounce.pop()()
        debounce.append(async_call_later(hass, DEBOUNCE, run_all))

    def started(_hass: HomeAssistant) -> None:
        if not recording:
            active.append(async_track_time_interval(hass, run_all, timedelta(hours=PRUNE_ONLY_HOURS)))
            return
        settings: ScanSettings | None = None
        try:
            settings = read_settings(hass)
            if settings.enabled is False:
                raise NotSupported("scan_off", "ZHA's topology scan is off")
            active.append(attach(hass, on_event))
            history.follow_mode = "events"
        except NotSupported as err:
            history.follow_mode = "timer"
            if err.reason == "internals_changed":
                history.last_error = f"following ZHA's scans is not possible, recording on a timer: {err}"
        # Events cover ZHA; Thread (no events) and the fallback follow ZHA's period on a timer.
        timer = run_thread if history.follow_mode == "events" else run_all
        active.append(async_track_time_interval(hass, timer, timedelta(minutes=effective_period(settings))))
        active.append(async_call_later(hass, FIRST_RECORD_DELAY, run_all))

    cancel_started = async_at_started(hass, started)

    def stop() -> None:
        if cancel_started:
            cancel_started()
        for cancel in [*active, *debounce]:
            cancel()
        active.clear()
        debounce.clear()

    return [stop]


async def async_info(hass: HomeAssistant) -> dict[str, Any]:
    """Result of the info command: the history's size and how it is fed."""
    history = get_history(hass)
    try:
        zha: ScanSettings | None = read_settings(hass)
    except NotSupported:
        zha = None
    options = get_options_of(history)
    pending = options[CONF_PENDING_ZHA_PERIOD]
    reported = zha.period if zha else None
    if pending is not None and pending == reported:
        pending = None  # applied: ZHA reports it
    note = None
    if pending is not None:
        note = (f"ZHA still reports {reported} min; the snippet for {pending} min is not applied yet"
                if reported else f"ZHA is not running; the snippet for {pending} min is not applied yet")
    return {**await history.run(history.files.info), "last_error": history.last_error,
            "zha_scan_period": reported, "zha_scan_enabled": zha.enabled if zha else None,
            "follow_mode": history.follow_mode, "pending_zha_period": pending, "pending_note": note,
            "record": options[CONF_RECORD], "keep_days": options[CONF_KEEP_DAYS]}


def get_options_of(history: History) -> dict[str, Any]:
    """The options the running recording was started with (defaults before the first setup)."""
    return get_options(history.options)


async def async_delete_history(hass: HomeAssistant) -> None:
    """Remove every record (options form, entry removal)."""
    await get_history(hass).delete_all()
