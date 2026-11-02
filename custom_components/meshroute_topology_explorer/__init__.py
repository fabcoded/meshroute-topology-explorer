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

from .const import DOMAIN, PANEL_ELEMENT, PANEL_URL_PATH, STATIC_URL_PREFIX, VERSION
from .websocket_api import async_register_commands, async_remove_data

FRONTEND_DIR = Path(__file__).parent / "frontend"
# Hashes whose static path this run already serves. Home Assistant cannot remove a static path while it runs
# (core 2026.10.2 http/server.py offers only registration), so each hash is registered once and kept.
_STATIC_KEY = f"{DOMAIN}_static_hashes"


def frontend_hash(directory: Path) -> str:
    """First 12 hex digits of SHA-256 over every file below `directory`: relative path and bytes, sorted by path.

    The hash is part of the panel's URL path, so the relative ES-module imports resolve under it too (a query string
    on panel.js would not reach them). Changed files get new addresses and the long browser cache cannot serve an
    old mix; unchanged files keep theirs."""
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
    panel. An entry reload after changed panel files yields a new hash, so it ships them without a restart."""
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
    await panel_custom.async_register_panel(
        hass,
        webcomponent_name=PANEL_ELEMENT,
        frontend_url_path=PANEL_URL_PATH,
        module_url=f"{base}/panel.js",
        sidebar_title="Meshroute",
        sidebar_icon="mdi:graph-outline",
        require_admin=True,
        # The panel compares this with its own version and asks for a page reload on mismatch (stale browser cache).
        config={"version": VERSION},
    )
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Remove the panel, so that a reload can register it again under a new URL; the static paths stay until Home
    Assistant restarts."""
    frontend.async_remove_panel(hass, PANEL_URL_PATH)
    return True


async def async_remove_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Delete the stored settings and observations when the user removes the integration (single entry)."""
    await async_remove_data(hass)
