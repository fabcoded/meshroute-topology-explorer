# SPDX-License-Identifier: MIT
"""Config flow: a single confirmation step that creates the one allowed entry (manifest: single_config_entry), and the
options flow behind "Configure" (administrators only: Home Assistant offers it to them). Rules: docs/spec.md 10.1."""

from __future__ import annotations

from typing import Any

import probatio  # replaced voluptuous in Home Assistant 2026.10; the minimum version follows
from homeassistant.config_entries import ConfigEntry, ConfigFlow, ConfigFlowResult, OptionsFlow, OptionsFlowWithReload
from homeassistant.core import callback
from homeassistant.data_entry_flow import section

from .const import (
    CONF_DELETE_HISTORY,
    CONF_KEEP_DAYS,
    CONF_RADIO_ACTIONS,
    CONF_RECORD,
    CONF_SCAN_AFTER_START,
    CONF_SIDEBAR,
    DOMAIN,
    KEEP_DAYS_RANGE,
    TITLE,
)
from .options import get_options, validate_options
from .recorder import async_delete_history
from .sources import set_up_entries
from .zha_scan import ScanSettings, describe, read_settings
from .zigpy_routes import NotSupported

SECTIONS = ("history", "zha")  # the form's sections; their fields are stored flat in the options


class MeshrouteConfigFlow(ConfigFlow, domain=DOMAIN):
    """Nothing to configure at setup: the panel reads what Home Assistant already knows."""

    VERSION = 1

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        return MeshrouteOptionsFlow()

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Show a bare confirmation form, then create the entry."""
        if user_input is not None:
            return self.async_create_entry(title=TITLE, data={})
        return self.async_show_form(step_id="user")


class MeshrouteOptionsFlow(OptionsFlowWithReload):
    """One form; saving reloads the entry (never Home Assistant). Home Assistant checks values only on Submit, so
    problems come back as errors. Those of the section's fields are returned as `base` errors, which always show at the
    top of the form (the frontend's mapping of section field errors is not guaranteed). The ZHA section appears only
    when ZHA has a config entry that is neither ignored nor disabled (owner 2026-11-08, #15); its stored values are
    kept while it is hidden. ZHA's scan
    period is only shown, with a note how to change it in configuration.yaml, which this integration never writes."""

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        try:
            zha: ScanSettings | None = read_settings(self.hass)
        except NotSupported:
            zha = None
        errors: dict[str, str] = {}
        stored = get_options(self.config_entry.options)
        current = stored
        if user_input is not None:
            # The sections' fields arrive nested; flatten before validating. A hidden section sends nothing.
            flat = {**{k: v for k, v in user_input.items() if k not in SECTIONS},
                    **{k: v for name in SECTIONS for k, v in user_input.get(name, {}).items()}}
            options, delete, errors = validate_options(flat, stored)
            if not errors:
                if delete:
                    await async_delete_history(self.hass)
                return self.async_create_entry(data=options)
            # One base error (the first); the texts carry the numbers. Keep what the user typed.
            errors = {"base": next(iter(errors.values()))}
            current = {**stored, **flat}
        history = probatio.Schema({
            probatio.Required(CONF_RECORD, default=current[CONF_RECORD]): bool,
            probatio.Required(CONF_KEEP_DAYS, default=current[CONF_KEEP_DAYS]): int,
            probatio.Required(CONF_DELETE_HISTORY, default=False): bool,
        })
        schema = {
            probatio.Required(CONF_SIDEBAR, default=current[CONF_SIDEBAR]): bool,
            probatio.Required(SECTIONS[0]): section(history, {"collapsed": False}),
        }
        if set_up_entries(self.hass, "zha"):  # ignored or disabled entries do not count
            schema[probatio.Required(SECTIONS[1])] = section(probatio.Schema({
                probatio.Required(CONF_RADIO_ACTIONS, default=current[CONF_RADIO_ACTIONS]): bool,
                probatio.Required(CONF_SCAN_AFTER_START, default=current[CONF_SCAN_AFTER_START]): bool,
            }), {"collapsed": False})
        return self.async_show_form(step_id="init", data_schema=probatio.Schema(schema), errors=errors,
                                    description_placeholders={
            "zha_scan": describe(zha), "days_range": f"{KEEP_DAYS_RANGE[0]} to {KEEP_DAYS_RANGE[1]}"})
