# SPDX-License-Identifier: MIT
"""Config flow: a single confirmation step that creates the one allowed entry (manifest: single_config_entry), and the
options flow behind "Configure" (administrators only: Home Assistant offers it to them). Rules: docs/spec.md 10.1."""

from __future__ import annotations

from typing import Any

import voluptuous as vol
from homeassistant.config_entries import ConfigEntry, ConfigFlow, ConfigFlowResult, OptionsFlow, OptionsFlowWithReload
from homeassistant.core import callback
from homeassistant.data_entry_flow import section

from .const import (
    CONF_CONFIRM_SHORT,
    CONF_DELETE_HISTORY,
    CONF_KEEP_DAYS,
    CONF_RADIO_ACTIONS,
    CONF_RECORD,
    CONF_RECORD_HOURS,
    CONF_SIDEBAR,
    DOMAIN,
    KEEP_DAYS_RANGE,
    RECORD_HOURS_RANGE,
    RECOMMENDED_RECORD_HOURS,
    TITLE,
)
from .options import ERR_HOURS_SHORT, get_options, validate_options
from .recorder import async_delete_history

SECTION = "history"  # the form's "Reception history" section; its fields are stored flat in the options


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
    top of the form (the frontend's mapping of section field errors is not guaranteed)."""

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        flat: dict[str, Any] = {}
        if user_input is not None:
            # The history fields arrive nested in their section; flatten before validating.
            flat = {**{k: v for k, v in user_input.items() if k != SECTION}, **user_input.get(SECTION, {})}
            options, delete, errors = validate_options(flat, self.config_entry.options)
            if not errors:
                if delete:
                    await async_delete_history(self.hass)
                return self.async_create_entry(data=options)
            # One base error (the first); the texts carry the numbers. Keep what the user typed.
            errors = {"base": next(iter(errors.values()))}
            current = {**get_options(None), **flat}
        else:
            current = get_options(self.config_entry.options)
        fields = {
            vol.Required(CONF_RECORD, default=current[CONF_RECORD]): bool,
            vol.Required(CONF_RECORD_HOURS, default=current[CONF_RECORD_HOURS]): int,
            vol.Required(CONF_KEEP_DAYS, default=current[CONF_KEEP_DAYS]): int,
        }
        # The confirmation box exists only after the warning (board M33): the form comes back with it, unticked.
        if ERR_HOURS_SHORT in errors.values() or (user_input is not None and CONF_CONFIRM_SHORT in flat):
            fields[vol.Required(CONF_CONFIRM_SHORT, default=False)] = bool
        fields[vol.Required(CONF_DELETE_HISTORY, default=False)] = bool
        history = vol.Schema(fields)
        schema = vol.Schema({
            vol.Required(CONF_SIDEBAR, default=current[CONF_SIDEBAR]): bool,
            vol.Required(CONF_RADIO_ACTIONS, default=current[CONF_RADIO_ACTIONS]): bool,
            vol.Required(SECTION): section(history, {"collapsed": False}),
        })
        hours = int(current[CONF_RECORD_HOURS]) if isinstance(current[CONF_RECORD_HOURS], int) else 0
        return self.async_show_form(step_id="init", data_schema=schema, errors=errors, description_placeholders={
            "hours_range": f"{RECORD_HOURS_RANGE[0]} to {RECORD_HOURS_RANGE[1]}",
            "days_range": f"{KEEP_DAYS_RANGE[0]} to {KEEP_DAYS_RANGE[1]}",
            "recommended": str(RECOMMENDED_RECORD_HOURS), "hours": str(hours)})
