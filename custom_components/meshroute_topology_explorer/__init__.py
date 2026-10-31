# SPDX-License-Identifier: MIT
"""Meshroute Topology Explorer: serves the panel files and registers one admin-only sidebar panel.

Installed through HACS or by copying this folder to config/custom_components/. Plan: docs/spec.md section 10.
"""

from __future__ import annotations

from pathlib import Path

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import DOMAIN, PANEL_ELEMENT, PANEL_URL_PATH, STATIC_URL_BASE, VERSION

# Static paths cannot be removed again in a running Home Assistant, so remember that ours is registered.
_STATIC_KEY = f"{DOMAIN}_static_registered"


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Serve the frontend folder (once per run) and add the panel."""
    if not hass.data.get(_STATIC_KEY):
        # The version is part of the URL, so a long cache time is safe: a new version is a new address.
        await hass.http.async_register_static_paths(
            [StaticPathConfig(STATIC_URL_BASE, str(Path(__file__).parent / "frontend"), True)]
        )
        hass.data[_STATIC_KEY] = True
    await panel_custom.async_register_panel(
        hass,
        webcomponent_name=PANEL_ELEMENT,
        frontend_url_path=PANEL_URL_PATH,
        module_url=f"{STATIC_URL_BASE}/panel.js",
        sidebar_title="Meshroute",
        sidebar_icon="mdi:graph-outline",
        require_admin=True,
        # The panel compares this with its own version and asks for a page reload on mismatch (stale browser cache).
        config={"version": VERSION},
    )
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Remove the panel; the static path stays until Home Assistant restarts."""
    frontend.async_remove_panel(hass, PANEL_URL_PATH)
    return True
