# SPDX-License-Identifier: MIT
"""Meshroute Topology Explorer: serves the panel files and registers one admin-only sidebar panel.

Installed through HACS or by copying this folder to config/custom_components/. Plan: docs/spec.md section 10.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import CONF_RADIO_ACTIONS, CONF_SIDEBAR, DOMAIN, PANEL_ELEMENT, PANEL_URL_PATH, STATIC_URL_PREFIX, VERSION
from .options import get_options
from .recorder import async_delete_history, start_recording
from .thread_tables import start_observer
from .websocket_api import async_register_commands, async_remove_data

FRONTEND_DIR = Path(__file__).parent / "frontend"
# Hashes whose static path this run already serves. Home Assistant cannot remove a static path while it runs
# (core 2026.10.2 http/server.py offers only registration), so each hash is registered once and kept.
_STATIC_KEY = f"{DOMAIN}_static_hashes"
_PANEL_KEY = f"{DOMAIN}_panel_registered"


def frontend_hash(directory: Path) -> str:
    """First 12 hex digits of SHA-256 over every file below `directory`: relative path and bytes, sorted by path.

    Every file below frontend/, sources and dist/, enters the hash, although the shipped module dist/panel.js has no
    imports any more (#16). The hash is part of the panel's URL path, so a changed file gets a new address and the
    long browser cache cannot serve an old copy."""
    digest = hashlib.sha256()
    files = sorted((p.relative_to(directory).as_posix(), p) for p in directory.rglob("*") if p.is_file())
    for rel, path in files:
        name, data = rel.encode(), path.read_bytes()
        # Length prefixes keep the stream unambiguous: no other split into path and content gives the same bytes.
        digest.update(len(name).to_bytes(4, "big") + name + len(data).to_bytes(8, "big"))
        digest.update(data)
    return digest.hexdigest()[:12]


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Serve the frontend folder under its content hash and register the commands (each once per run), then add the
    panel (unless the option "sidebar" is off), start the history timers and the Thread table observer. An entry reload after changed panel
    files or options yields a new hash or state, so it ships them without a restart."""
    options = get_options(entry.options)
    digest = await hass.async_add_executor_job(frontend_hash, FRONTEND_DIR)
    base = f"{STATIC_URL_PREFIX}/{digest}"
    served = hass.data.setdefault(_STATIC_KEY, set())
    if digest not in served:
        # Content-addressed, so the long cache time of cache_headers=True is safe.
        await hass.http.async_register_static_paths([StaticPathConfig(base, str(FRONTEND_DIR), True)])
        served.add(digest)
    # Not in async_setup: hassfest demands a CONFIG_SCHEMA only from integrations that define async_setup/setup
    # (script/hassfest/config_schema.py:64-90, checked against 2026.10.2); entry setup needs none. Once per run.
    async_register_commands(hass)
    if options[CONF_SIDEBAR]:
        await panel_custom.async_register_panel(
            hass,
            webcomponent_name=PANEL_ELEMENT,
            frontend_url_path=PANEL_URL_PATH,
            # One request instead of about 100 (issue #16): the bundle built by tools/bundle.mjs; the sources beside
            # it stay for tests and the dev page. dist/ is inside FRONTEND_DIR, so the content hash covers it.
            module_url=f"{base}/dist/panel.js",
            sidebar_title="Meshroute",
            sidebar_icon="mdi:graph-outline",
            require_admin=True,
            # The panel compares the version with its own and asks for a page reload on mismatch (stale browser cache).
            # radio_actions hides the scan control and the attribute read in the panel: a switch of the panel, ZHA's
            # own commands stay reachable (spec 10.1).
            config={"version": VERSION, "radio_actions": options[CONF_RADIO_ACTIONS]},
        )
        hass.data[_PANEL_KEY] = True
    for stop in [*start_recording(hass, options), *start_observer(hass)]:
        entry.async_on_unload(stop)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Remove the panel, so that a reload can register it again under a new URL; the static paths stay until Home
    Assistant restarts."""
    if hass.data.pop(_PANEL_KEY, False):
        frontend.async_remove_panel(hass, PANEL_URL_PATH)
    return True



async def async_remove_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Delete the stored settings, observations and reception history when the user removes the integration."""
    await async_remove_data(hass)
    await async_delete_history(hass)
