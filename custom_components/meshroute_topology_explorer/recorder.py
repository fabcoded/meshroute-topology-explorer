# SPDX-License-Identifier: MIT
"""Records the reception history after ZHA's own topology scans, prunes it, and answers the read commands' questions.

When to record (owner decision 2026-11-03): ZHA's topology fires events while it scans; a listener on them records once
they have been quiet for DEBOUNCE seconds and the scan task is done ("events"); the record is dated with the end of the
scan, not with the read. Never mid-scan: zigpy replaces the stored tables router by router while it scans, so a read
waits for the scan task (`_scan_task`) to end, and a record due within MIN_GAP of the last one is postponed to
last + MIN_GAP. Where no listener can be attached (internals changed, ZHA's scan off or ZHA not running) the Zigbee
timer at ZHA's scan period (240 min without ZHA) records instead, dated with the read ("timer"). Thread has no events:
its own timer runs every THREAD_PERIOD, independent of ZHA (owner 2026-11-08, #15), and a snapshot is dated with its
`collected_at`: when the Matter server answered Meshroute's request, not when it read the tables (spec 3.2). Every ZHA (re)load builds a new topology, so the listener is re-attached, and the
Zigbee timer set to ZHA's period, when ZHA's config entry changes and on each Zigbee tick. Problems are kept per source
("zha", "thread"), so one network's problem never shows in the other's history. Per Home Assistant run one
HistoryFiles object and one status; a config entry reload only restarts the listener and timers. Read only: sources.py
takes what ZHA and the Matter server hold and never starts a scan. A failed or empty read writes nothing (a missing
table is not a table without neighbours). Plan: docs/spec.md section 10.2.
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

from .const import (
    CONF_KEEP_DAYS,
    CONF_RADIO_ACTIONS,
    CONF_RECORD,
    CONF_SCAN_AFTER_START,
    DOMAIN,
    HISTORY_DIR,
    ZHA_DEFAULT_PERIOD,
)
from .history import HistoryFiles
from .options import get_options
from .sources import collect, request_update, set_up_entries
from .thread_tables import async_observe
from .zha_scan import ScanSettings, attach, read_settings, scan_state, topology
from .zigpy_routes import NotSupported

_LOGGER = logging.getLogger(__name__)
_KEY = f"{DOMAIN}_history"
FIRST_RECORD_DELAY = 30  # seconds after Home Assistant has started (or after a reload): the sources have their tables
DEBOUNCE = 60  # seconds without a topology event (and no running scan) before the scan counts as finished
DEBOUNCE_UNKNOWN = 300  # the same where the scan task cannot be seen: a longer quiet instead of a certain end
MIN_GAP = 600  # seconds between two records of a network, whatever triggers them (manual scans in between)
PRUNE_ONLY_HOURS = 6  # recording off: old files still expire
FORCED_SCAN_DELAY = 1800  # seconds after Home Assistant has started: the optional one-time scan
_FORCED_KEY = f"{DOMAIN}_forced_scan_done"  # per Home Assistant run: reloads of the entry do not repeat the scan
THREAD_PREFIX = "thread-"
# Minutes. Thread's own fixed interval until #12/#14 bring a schedule of their own (owner 2026-11-08, #15); 4 hours is
# also the age at which the panel's dot turns amber for a Thread snapshot (spec 6).
THREAD_PERIOD = 240
SOURCES = ("zha", "thread")  # the panel's source keys (network.source): problems are kept and answered per source


class History:
    """Files, serialisation of their use, the guard against mid-scan reads, and the status the info command shows."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.files = HistoryFiles(hass.config.path(".storage", HISTORY_DIR))
        self.lock = asyncio.Lock()  # HistoryFiles is not thread-safe: one executor job at a time
        self.problems: dict[str, str | None] = dict.fromkeys(SOURCES)  # the last problem of each source, or None
        self.follow_note: str | None = None  # why ZHA's events could not be followed (kept apart: reads reset problems)
        # Bumped by every delete: a record that was collected before it must not be written after it.
        self.generation = 0
        self.clock = time.monotonic  # the gap between records; the wall clock stays for the record times
        self.last_mono: dict[str, float] = {}
        self.last_time: dict[str, float] = {}
        self.follow_mode: str | None = None  # "events" | "timer"; None while recording is off or not started
        self.options: dict[str, Any] = {}
        self.scan_busy: Callable[[], bool] = lambda: False  # set by Recording: is a ZHA scan running now?
        self.forced_scan_time: float | None = None  # the optional one-time scan: when it was asked for ...
        self.forced_scan_note: str | None = None  # ... or why it was not

    async def run(self, func: Callable[..., Any], *args: Any, generation: int | None = None) -> Any:
        """Run a HistoryFiles method in the executor, one at a time; with `generation`, only if no delete happened
        since (checked under the lock, so a delete and an append never interleave)."""
        async with self.lock:
            if generation is not None and generation != self.generation:
                return None
            return await self.hass.async_add_executor_job(func, *args)

    def gap_ok(self, network: str) -> bool:
        return self.clock() - self.last_mono.get(network, float("-inf")) >= MIN_GAP

    def note(self, source: str, problem: str | None) -> None:
        """Keep a source's last problem; logged once per change, not once per interval."""
        if problem and problem != self.problems[source]:
            _LOGGER.warning("Reception history (%s): %s", source, problem)
        self.problems[source] = problem

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
            for source, asked in zip(SOURCES, (zigbee, thread), strict=True):
                if asked:  # a source not read keeps its problem: a Thread read must not clear ZHA's
                    self.note(source, "; ".join(got.problems[source]) or None)
            zigbee = zigbee and not self.scan_busy()
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
    """The triggers of one config entry: follows ZHA's scans (or the Zigbee timer), the Thread timer, expiry. Nothing
    here starts a scan; `stop` undoes everything."""

    def __init__(self, hass: HomeAssistant, options: dict[str, Any]) -> None:
        self.hass = hass
        self.history = get_history(hass)
        self.history.options, self.history.follow_mode, self.history.follow_note = options, None, None
        self.keep, self.recording = options[CONF_KEEP_DAYS], options[CONF_RECORD]
        self.scan_after_start, self.radio_actions = options[CONF_SCAN_AFTER_START], options[CONF_RADIO_ACTIONS]
        self.period = ZHA_DEFAULT_PERIOD  # minutes: ZHA's scan period as last read
        self._zigbee_timer: Callable[[], None] | None = None  # the Zigbee timer, running at _zigbee_period
        self._zigbee_period: int | None = None
        self.topology: Any = None  # the topology our listener sits on
        self._detach: Callable[[], None] | None = None
        self._cancels: list[Callable[[], None]] = []  # timers and subscriptions to undo
        self._pending: Callable[[], None] | None = None  # the quiet or postponement timer
        self._waiting: Any = None  # the scan task whose end restarts the quiet timer
        self._last_event: float | None = None  # wall time of the last event or scan end
        self._trigger_start: float | None = None  # clock() of the first trigger since the last record
        # Set by stop(): a callback still awaiting a read (the first one) must not attach or start anything after the
        # unload (the one-time scan skips by itself: stop() drops the topology).
        self._stopped = False
        self.history.scan_busy = self.scan_busy

    def start(self) -> Callable[[], None]:
        self._cancels.append(async_at_started(self.hass, self._started) or (lambda: None))
        self._cancels.append(async_dispatcher_connect(self.hass, SIGNAL_CONFIG_ENTRY_CHANGED, self._entry_changed))
        return self.stop

    def stop(self) -> None:
        self._stopped = True
        for cancel in [*self._cancels, *(c for c in (self._pending, self._zigbee_timer) if c)]:
            cancel()
        self._cancels.clear()
        self._pending, self._zigbee_timer = None, None
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
        """(Re-)resolve ZHA's topology: attach to a new one, drop a dead one, set the follow mode, its note and the
        period (ZHA's, kept while ZHA does not name one; its default once ZHA is gone, spec 10.2). Nothing after stop."""
        if self._stopped:
            return
        settings: ScanSettings | None = None
        try:
            settings = read_settings(self.hass)
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
            if settings is None:
                self.period = ZHA_DEFAULT_PERIOD
        self._schedule_zigbee()

    def _schedule_zigbee(self) -> None:
        """Run the Zigbee timer at ZHA's period; restart it when the period changed (ZHA came up later or was reloaded
        with another period, #15)."""
        if self._stopped or (self._zigbee_timer is not None and self._zigbee_period == self.period):
            return
        if self._zigbee_timer is not None:
            self._zigbee_timer()
        self._zigbee_period = self.period
        self._zigbee_timer = async_track_time_interval(self.hass, self._tick, timedelta(minutes=self.period))

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
        self._follow()  # also starts the Zigbee timer
        self._cancels.append(async_track_time_interval(self.hass, self._tick_thread, timedelta(minutes=THREAD_PERIOD)))
        self._cancels.append(async_call_later(self.hass, FIRST_RECORD_DELAY, self._first))
        if self.scan_after_start and not self.hass.data.get(_FORCED_KEY):
            self._cancels.append(async_call_later(self.hass, FORCED_SCAN_DELAY, self._one_time))

    async def _one_time(self, _now: Any = None) -> None:
        """The optional one-time scan, 30 min after the start: only with scan and attribute reads on, ZHA running, no scan under
        way and no Zigbee record younger than ZHA's period. The scan is ZHA's own (its command handler); the records
        follow from its events by the normal path. Why not is kept for the info command."""
        self.hass.data[_FORCED_KEY] = True  # once per run, whatever the outcome
        history = self.history
        try:
            self._follow()
            zha = set_up_entries(self.hass, "zha")
            state = scan_state(self.topology)[0] if self.topology is not None else None
            last = await history.run(history.files.last_time, zha[0].entry_id) if zha else None
            age = None if last is None else (time.time() - last) / 60
            if not self.radio_actions:
                history.forced_scan_note = "skipped: scan and attribute reads are off"
            elif not zha or self.topology is None:
                history.forced_scan_note = "skipped: ZHA is not running"
            elif state != "idle":
                history.forced_scan_note = f"skipped: scan state is {state}"
            elif age is not None and age < self.period:
                history.forced_scan_note = f"skipped: the last Zigbee record is {age:.0f} min old (period {self.period})"
            else:
                request_update(self.hass)
                history.forced_scan_time, history.forced_scan_note = time.time(), None
        except Exception as err:  # noqa: BLE001 - a timer callback: never raise into Home Assistant
            history.forced_scan_note = f"failed: {type(err).__name__}: {err}"

    async def _first(self, _now: Any = None) -> None:
        """30 s after the start: Thread, and Zigbee in timer mode. Events mode reads no Zigbee then: zigpy restores its
        last scan from its database, and it would be dated as new."""
        await self._tick_thread()
        await self._tick()  # returns at once when the entry was unloaded during the Thread read

    async def _tick(self, _now: Any = None) -> None:
        """Zigbee timer: the identity check (a new application since the last tick), the Zigbee read in timer mode;
        expiry alone when recording is off."""
        if self._stopped:
            return
        try:
            if not self.recording:
                await self.history.prune(self.keep)
                return
            self._follow()
            if self.history.follow_mode != "events":
                await self.history.record(self.keep, zigbee=True, thread=False)
        except Exception as err:  # noqa: BLE001 - a timer callback: log and try again at the next trigger
            self._failed(err, "zha")

    async def _tick_thread(self, _now: Any = None) -> None:
        """Thread timer, every THREAD_PERIOD whatever ZHA does: Thread has no events to follow. It also refreshes the
        Thread table fingerprints (thread_tables.py, in memory), so "unchanged since" is at most one period late."""
        await async_observe(self.hass)
        try:
            await self.history.record(self.keep, zigbee=False, thread=True)
        except Exception as err:  # noqa: BLE001 - a timer callback
            self._failed(err, "thread")

    def _failed(self, err: Exception, source: str) -> None:
        message = f"recording failed: {type(err).__name__}: {err}"
        if message != self.history.problems[source]:  # once per change, like the source problems
            _LOGGER.exception("Reception history failed")
        self.history.problems[source] = message

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
                self.history.problems["zha"] = "ZHA's scan did not end in time; nothing was recorded for it"
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
            self._failed(err, "zha")


def start_recording(hass: HomeAssistant, options: dict[str, Any]) -> list[Callable[[], None]]:
    """Start recording for these options (as read by get_options) once Home Assistant has started; returns the
    function that stops everything again (for the entry's unload)."""
    return [Recording(hass, options).start()]


async def async_info(hass: HomeAssistant) -> dict[str, Any]:
    """Result of the info command: the history's size, how it is fed, and the last problem per source (`problems`, read
    by the panel; `last_error` joins them, kept for older readers)."""
    history = get_history(hass)
    zha: ScanSettings | None = None
    state: str | None = None
    try:
        zha = read_settings(hass)
        state = scan_state(topology(hass))[0]
    except NotSupported:
        pass  # ZHA is not running: no period, no scan state
    options = get_options(history.options)
    problems = {**history.problems, "zha": "; ".join(filter(None, [history.follow_note, history.problems["zha"]])) or None}
    return {**await history.run(history.files.info),
            "last_error": "; ".join(filter(None, problems.values())) or None, "problems": problems,
            "zha_scan_period": zha.period if zha else None, "zha_scan_enabled": zha.enabled if zha else None,
            "follow_mode": history.follow_mode, "scan_state": state,
            "last_forced_scan": history.forced_scan_time,
            "forced_scan_note": history.forced_scan_note, "record": options[CONF_RECORD], "keep_days": options[CONF_KEEP_DAYS]}


async def async_delete_history(hass: HomeAssistant) -> None:
    """Remove every record (options form, entry removal)."""
    await get_history(hass).delete_all()
