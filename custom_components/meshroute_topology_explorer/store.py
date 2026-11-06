# SPDX-License-Identifier: MIT
"""Persistent per-network data of the panel: settings and observations, one Home Assistant store for all networks.

Layout on disk (version 1): {"networks": {<network id>: {"settings": {...}, "observations": {...}}}}.
Reads are served from memory after the first load; writes are delayed. Plan: docs/spec.md sections 10 and 11.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import DOMAIN, STORE_SAVE_DELAY, STORE_VERSION

_LOGGER = logging.getLogger(__name__)

KINDS = ("settings", "observations")


class StoreUnavailable(Exception):
    """The stored file could not be read; writing now would overwrite data that may still be intact."""


class PanelStore:
    """In-memory copy of the store file with delayed saving."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._store: Store = Store(hass, STORE_VERSION, DOMAIN)
        self._networks: dict[str, dict[str, Any]] | None = None
        # Two panels may ask at once on the first call; Store.async_load is safe for that, but the
        # result must be assigned only once or a fast set() could be overwritten by a slow second load.
        self._lock = asyncio.Lock()

    async def _async_ensure_loaded(self) -> dict[str, dict[str, Any]]:
        """Load the file once; raise StoreUnavailable if that fails, so the next call tries again."""
        async with self._lock:
            if self._networks is None:
                try:
                    data = await self._store.async_load()
                except Exception as err:
                    # E.g. a file written by a newer version. Never replace it with an empty one.
                    _LOGGER.error("Cannot read the stored panel data: %s", err)
                    raise StoreUnavailable from err
                networks = data.get("networks") if isinstance(data, dict) else None
                self._networks = networks if isinstance(networks, dict) else {}
            return self._networks

    async def async_get(self, network: str, kind: str) -> dict[str, Any] | None:
        """Return the stored object of one kind for a network, or None if never set."""
        networks = await self._async_ensure_loaded()
        entry = networks.get(network)
        # A hand-edited file may hold anything; a wrong type counts as never set instead of crashing the command.
        value = entry.get(kind) if isinstance(entry, dict) else None
        return value if isinstance(value, dict) else None

    async def async_set(self, network: str, kind: str, value: dict[str, Any]) -> None:
        """Replace one object of a network and schedule the save."""
        networks = await self._async_ensure_loaded()
        if not isinstance(networks.get(network), dict):
            networks[network] = {}
        networks[network][kind] = value
        # data_func runs at write time, so a burst of changes becomes one write of the latest state.
        self._store.async_delay_save(lambda: {"networks": networks}, STORE_SAVE_DELAY)

    async def async_remove(self) -> None:
        """Delete the file and the memory copy (Store.async_remove, storage.py:624, also cancels a pending save)."""
        async with self._lock:
            await self._store.async_remove()
            self._networks = None
