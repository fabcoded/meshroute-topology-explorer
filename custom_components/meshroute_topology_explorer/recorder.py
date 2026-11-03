# SPDX-License-Identifier: MIT
"""Records the reception history after ZHA's own topology scans, prunes it, and answers the read commands' questions.

When to record (owner decision 2026-11-03): ZHA's topology fires events while it scans; a listener on them records once
they have been quiet for DEBOUNCE seconds and the scan task is done ("events"); the record is dated with the end of the
scan, not with the read. Never mid-scan: zigpy replaces the stored tables router by router while it scans, so a read
waits for the scan task (`_scan_task`) to end, and a record due within MIN_GAP of the last one is postponed to
last + MIN_GAP. Where no listener can be attached (internals changed, ZHA's scan off or ZHA not running) a timer at
ZHA's scan period (240 min without ZHA) records instead, dated with the read ("timer"). Thread has no events: its own
timer runs at ZHA's period, and a snapshot is dated with the Matter server's collection time. Every ZHA (re)load builds
a new topology, so the listener is re-attached when ZHA's config entry changes and on each timer tick. Per Home
Assistant run one HistoryFiles object and one status; a config entry reload only restarts the listener and timers.
Read only: sources.py takes what ZHA and the Matter server hold and never starts a scan. A failed or empty read writes
nothing (a missing table is not a table without neighbours). Plan: docs/spec.md section 10.2.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Callable
from datetime import timedelta
from typing import Any

from homeassistant.config_entries import SIGNAL_CONFIG_ENTRY_CHANGED
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.event import async_call_later, async_track_time_interval
from homeassistant.helpers.start import async_at_started

from .const import CONF_KEEP_DAYS, CONF_PENDING_ZHA_PERIOD, CONF_RECORD, DOMAIN, HISTORY_DIR, ZHA_DEFAULT_PERIOD
from .history import HistoryFiles
from .options import get_options
from .sources import collect
from .zha_scan import ScanSettings, attach, read_settings, scan_state, topology
from .zigpy_routes import NotSupported

_LOGGER = logging.getLogger(__name__)
_KEY = f"{DOMAIN}_history"
FIRST_RECORD_DELAY = 30  # seconds after Home Assistant has started (or after a reload): the sources have their tables
DEBOUNCE = 60  # seconds without a topology event (and no running scan) before the scan counts as finished
DEBOUNCE_UNKNOWN = 300  # the same where the scan task cannot be seen: a longer quiet instead of a certain end
MIN_GAP = 600  # seconds between two records of a network, whatever triggers them (manual scans in between)
PRUNE_ONLY_HOURS = 6  # recording off: old files still expire
THREAD_PREFIX = "thread-"


class History:
    """Files, serialisation of their use, the guard against mid-scan reads, and the status the info command shows."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.files = HistoryFiles(hass.config.path(".storage", HISTORY_DIR))
        self.lock = asyncio.Lock()  # HistoryFiles is not thread-safe: one executor job at a time
        self.last_error: str | None = None
        self.follow_note: str | None = None  # why events could not be followed (kept apart: records reset last_error)
        # Bumped by every delete: a record that was collected before it must not be written after it.
        self.generation = 0
        self.clock = time.monotonic  # the gap between records; the wall clock stays for the record times
        self.last_mono: dict[str, float] = {}
        self.last_time: dict[str, float] = {}
        self.follow_mode: str | None = None  # "events" | "timer"; None while recording is off or not started
        self.options: dict[str, Any] = {}
        self.scan_busy: Callable[[], bool] = lambda: False  # set by Recording: is a ZHA scan running now?

    async def run(self, func: Callable[..., Any], *args: Any, generation: int | None = None) -> Any:
        """Run a HistoryFiles method in the executor, one at a time; with `generation`, only if no delete happened
        since (checked under the lock, so a delete and an append never interleave)."""
        async with self.lock:
            if generation is not None and generation != self.generation:
                return None
            return await self.hass.async_add_executor_job(func, *args)

    def gap_ok(self, network: str) -> bool:
        return self.clock() - self.last_mono.get(network, float("-inf")) >= MIN_GAP

    async def record(self, keep_days: int, now: float | None = None, *, zigbee: bool = True, thread: bool = True,
                     zigbee_time: float | None = None) -> None:
        """Take what the sources asked for hold now and append one record per network, then drop expired day files.

        A Zigbee read is skipped while a scan runs (and its result dropped if one started during the read). A record
        is dated `zigbee_time` (the end of the scan) or now for Zigbee, the snapshot's own time for Thread, and a Thread
        snapshot that is not newer than the last one is not written. A network is not written within MIN_GAP of its
        last record.
        """
        now = time.time() if now is None else now
        generation = self.generation
        try:
            zigbee = zigbee and not self.scan_busy()
            got = await collect(self.hass, zigbee, thread)
            zigbee = zigbee and not self.scan_busy()
            error = "; ".join(got.problems) or None
            if error and error != self.last_error:
                _LOGGER.warning("Reception history: %s", error)  # once per change, not once per interval
            self.last_error = error
            for network, snapshot in got.networks.items():
                is_thread = network.startswith(THREAD_PREFIX)
                t = got.times.get(network) if is_thread else (zigbee_time or now)
                if (is_thread or zigbee) and t is not None and not snapshot.is_empty() and self.gap_ok(network) \
                        and t > self.last_time.get(network, 0):
                    self.last_mono[network], self.last_time[network] = self.clock(), t
                    await self.run(self.files.append, network, t, snapshot, generation=generation)
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


class Recording:
    """The triggers of one config entry: follows ZHA's scans (or a timer), a Thread timer, expiry. Nothing here starts
    a scan; `stop` undoes everything."""

    def __init__(self, hass: HomeAssistant, options: dict[str, Any]) -> None:
        self.hass = hass
        self.history = get_history(hass)
        self.history.options, self.history.follow_mode, self.history.follow_note = options, None, None
        self.keep, self.recording = options[CONF_KEEP_DAYS], options[CONF_RECORD]
        self.period = ZHA_DEFAULT_PERIOD  # minutes
        self.topology: Any = None  # the topology our listener sits on
        self._detach: Callable[[], None] | None = None
        self._cancels: list[Callable[[], None]] = []  # timers and subscriptions to undo
        self._pending: Callable[[], None] | None = None  # the quiet or postponement timer
        self._waiting: Any = None  # the scan task whose end restarts the quiet timer
        self._last_event: float | None = None  # wall time of the last event or scan end
        self._trigger_start: float | None = None  # clock() of the first trigger since the last record
        self.history.scan_busy = self.scan_busy

    def start(self) -> Callable[[], None]:
        self._cancels.append(async_at_started(self.hass, self._started) or (lambda: None))
        self._cancels.append(async_dispatcher_connect(self.hass, SIGNAL_CONFIG_ENTRY_CHANGED, self._entry_changed))
        return self.stop

    def stop(self) -> None:
        for cancel in [*self._cancels, *([self._pending] if self._pending else [])]:
            cancel()
        self._cancels.clear()
        self._pending = None
        self._drop_waiting()
        self._release()
        self.history.scan_busy = lambda: False

    # -- following ZHA ----------------------------------------------------------------------------------------

    def _release(self) -> None:
        """Detach from the topology and forget it (a stale application must not stay alive through us)."""
        if self._detach:
            self._detach()
        self._detach, self.topology = None, None

    def _drop_waiting(self) -> None:
        if self._waiting is not None:
            self._waiting.remove_done_callback(self._scan_done)
            self._waiting = None

    def _follow(self) -> None:
        """(Re-)resolve ZHA's topology: attach to a new one, drop a dead one, set the follow mode and its note."""
        try:
            settings: ScanSettings = read_settings(self.hass)
            if settings.period:
                self.period = settings.period
            if settings.enabled is False:
                raise NotSupported("scan_off", "ZHA's topology scan is off")
            found = topology(self.hass)
            if found is not self.topology:
                self._release()
                self._drop_waiting()
                self._detach = attach(found, self._on_event)
                self.topology = found
            self.history.follow_mode, self.history.follow_note = "events", None
        except NotSupported as err:
            self._release()
            self.history.follow_mode = "timer"
            self.history.follow_note = (f"following ZHA's scans is not possible, recording on a timer: {err}"
                                        if err.reason == "internals_changed" else None)

    def _current(self) -> Any:
        """The topology to ask about a running scan: ours, else ZHA's current one, else None."""
        if self.topology is not None:
            return self.topology
        try:
            return topology(self.hass)
        except NotSupported:
            return None

    def scan_busy(self) -> bool:
        found = self._current()
        return found is not None and scan_state(found)[0] == "running"

    @callback
    def _entry_changed(self, _change: Any, entry: Any) -> None:
        """ZHA was (re)loaded or unloaded: its topology object is a new one or gone."""
        if getattr(entry, "domain", None) == "zha" and self.recording:
            self._follow()

    # -- triggers ---------------------------------------------------------------------------------------------

    @callback
    def _started(self, _hass: HomeAssistant) -> None:
        if not self.recording:
            self._cancels.append(async_track_time_interval(self.hass, self._tick, timedelta(hours=PRUNE_ONLY_HOURS)))
            return
        self._follow()
        self._cancels.append(async_track_time_interval(self.hass, self._tick, timedelta(minutes=self.period)))
        # Events mode: no read of ZHA at start (zigpy restores its last scan from its database; it would be dated as
        # new). Thread and the timer mode have nothing else to wait for.
        self._cancels.append(async_call_later(self.hass, FIRST_RECORD_DELAY, self._tick))

    async def _tick(self, _now: Any = None) -> None:
        """Timer: the Thread read in events mode, everything in timer mode; expiry only when recording is off."""
        try:
            if not self.recording:
                await self.history.prune(self.keep)
                return
            self._follow()  # also the identity check: a new application since the last tick
            await self.history.record(self.keep, zigbee=self.history.follow_mode != "events")
        except Exception as err:  # noqa: BLE001 - a timer callback: log and try again at the next trigger
            self._failed(err)

    def _failed(self, err: Exception) -> None:
        message = f"recording failed: {type(err).__name__}: {err}"
        if message != self.history.last_error:  # once per change, like the source problems
            _LOGGER.exception("Reception history failed")
        self.history.last_error = message

    def _delay(self) -> int:
        return DEBOUNCE if self.topology is not None and scan_state(self.topology)[0] != "unknown" else DEBOUNCE_UNKNOWN

    def _arm(self, delay: float) -> None:
        if self._pending:
            self._pending()
        self._pending = async_call_later(self.hass, delay, self._quiet)

    @callback
    def _on_event(self) -> None:
        """A topology event, inside zigpy's scan task: only note it and restart the quiet timer."""
        self._last_event = time.time()
        if self._trigger_start is None:
            self._trigger_start = self.history.clock()
        self._arm(self._delay())

    def _scan_done(self, _task: Any) -> None:
        """The scan task ended: that is the scan's end time, and the quiet period starts again."""
        self._waiting = None
        self._last_event = time.time()
        self._arm(self._delay())

    async def _quiet(self, _now: Any = None) -> None:
        """No event for a while: record the Zigbee tables when the scan is over and the last record is old enough."""
        self._pending = None
        try:
            if self._trigger_start is not None and self.history.clock() - self._trigger_start > 2 * self.period * 60:
                self._trigger_start = None
                self.history.last_error = "ZHA's scan did not end in time; nothing was recorded for it"
                return
            state, task = scan_state(self.topology) if self.topology is not None else ("idle", None)
            if state == "running":
                if task is not self._waiting:
                    self._drop_waiting()
                    self._waiting = task
                    task.add_done_callback(self._scan_done)
                return
            last = max((v for n, v in self.history.last_mono.items() if not n.startswith(THREAD_PREFIX)),
                       default=float("-inf"))
            if self.history.clock() - last < MIN_GAP:
                self._arm(MIN_GAP - (self.history.clock() - last))  # postponed, not dropped
                return
            await self.history.record(self.keep, zigbee=True, thread=False, zigbee_time=self._last_event)
            if not self.scan_busy():
                self._trigger_start = None
        except Exception as err:  # noqa: BLE001 - a timer callback
            self._failed(err)


def start_recording(hass: HomeAssistant, options: dict[str, Any]) -> list[Callable[[], None]]:
    """Start recording for these options (as read by get_options) once Home Assistant has started; returns the
    function that stops everything again (for the entry's unload)."""
    return [Recording(hass, options).start()]


async def async_info(hass: HomeAssistant) -> dict[str, Any]:
    """Result of the info command: the history's size and how it is fed."""
    history = get_history(hass)
    zha: ScanSettings | None = None
    state: str | None = None
    try:
        zha = read_settings(hass)
        state = scan_state(topology(hass))[0]
    except NotSupported:
        pass  # ZHA is not running: no period, no scan state
    options = get_options(history.options)
    pending, reported = options[CONF_PENDING_ZHA_PERIOD], zha.period if zha else None
    if pending is not None and pending == reported:
        pending = None  # applied: ZHA reports it
    note = f"ZHA still reports {reported} min; the snippet for {pending} min is not applied yet" \
        if pending is not None and reported else None
    return {**await history.run(history.files.info),
            "last_error": "; ".join(filter(None, [history.follow_note, history.last_error])) or None,
            "zha_scan_period": reported, "zha_scan_enabled": zha.enabled if zha else None,
            "follow_mode": history.follow_mode, "scan_state": state, "pending_zha_period": pending,
            "pending_note": note, "record": options[CONF_RECORD], "keep_days": options[CONF_KEEP_DAYS]}


async def async_delete_history(hass: HomeAssistant) -> None:
    """Remove every record (options form, entry removal)."""
    await get_history(hass).delete_all()
