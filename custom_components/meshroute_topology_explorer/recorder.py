# SPDX-License-Identifier: MIT
"""Records the reception history on a timer, prunes it, and answers the read commands' questions.

Per Home Assistant run one HistoryFiles object (the previous record per network lives in it) and one status dict; a
config entry reload only restarts the timers. Read only: sources.py takes what ZHA and the Matter server hold and never
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

from .const import CONF_KEEP_DAYS, CONF_RECORD, CONF_RECORD_HOURS, DOMAIN, HISTORY_DIR
from .history import HistoryFiles
from .sources import collect

_LOGGER = logging.getLogger(__name__)
_KEY = f"{DOMAIN}_history"
FIRST_RECORD_DELAY = 60  # seconds after setup: ZHA and Matter have loaded their tables by then
PRUNE_ONLY_HOURS = 6  # recording off: old files still expire


class History:
    """Files, serialisation of their use, and the last problem (shown by the info command)."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.files = HistoryFiles(hass.config.path(".storage", HISTORY_DIR))
        self.lock = asyncio.Lock()  # HistoryFiles is not thread-safe: one executor job at a time
        self.last_error: str | None = None

    async def run(self, func: Callable[..., Any], *args: Any) -> Any:
        """Run a HistoryFiles method in the executor, one at a time."""
        async with self.lock:
            return await self.hass.async_add_executor_job(func, *args)

    async def record(self, keep_days: int, now: float | None = None) -> None:
        """Take what the sources hold now, append one record per network, then drop expired day files."""
        now = time.time() if now is None else now
        networks, problems = await collect(self.hass)
        error = "; ".join(problems) or None
        if error != self.last_error and error:
            _LOGGER.warning("Reception history: %s", error)  # once per change, not once per interval
        self.last_error = error
        for network, snapshot in networks.items():
            if not snapshot.is_empty():
                await self.run(self.files.append, network, now, snapshot)
        await self.run(self.files.prune, now, keep_days)

    async def prune(self, keep_days: int) -> None:
        await self.run(self.files.prune, time.time(), keep_days)

    async def delete_all(self) -> None:
        await self.run(self.files.delete_all)


def get_history(hass: HomeAssistant) -> History:
    """The one History per Home Assistant run."""
    if _KEY not in hass.data:
        hass.data[_KEY] = History(hass)
    return hass.data[_KEY]


def start_recording(hass: HomeAssistant, options: dict[str, Any]) -> list[Callable[[], None]]:
    """Start the timers for these options (as read by get_options); returns the unsubscribers for the entry."""
    history = get_history(hass)
    keep = options[CONF_KEEP_DAYS]
    recording = options[CONF_RECORD]

    async def tick(_now: Any = None) -> None:
        try:
            await (history.record(keep) if recording else history.prune(keep))
        except Exception:  # noqa: BLE001 - a timer callback: log and try again at the next interval
            history.last_error = "recording failed, see the log"
            _LOGGER.exception("Reception history failed")

    hours = options[CONF_RECORD_HOURS] if recording else PRUNE_ONLY_HOURS
    return [async_call_later(hass, FIRST_RECORD_DELAY, tick),
            async_track_time_interval(hass, tick, timedelta(hours=hours))]


async def async_info(hass: HomeAssistant) -> dict[str, Any]:
    """Result of the info command."""
    history = get_history(hass)
    info = await history.run(history.files.info)
    return {**info, "last_error": history.last_error}


async def async_delete_history(hass: HomeAssistant) -> None:
    """Remove every record (options form, entry removal)."""
    await get_history(hass).delete_all()
