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
    CONF_PENDING_ZHA_PERIOD,
    CONF_RADIO_ACTIONS,
    CONF_RECORD,
    CONF_SIDEBAR,
    CONF_ZHA_PERIOD,
    DOMAIN,
    KEEP_DAYS_RANGE,
    TITLE,
    ZHA_PERIOD_RANGE,
    ZHA_RECOMMENDED_PERIOD,
)
from .options import ERR_ZHA_SHORT, get_options, validate_options
from .recorder import async_delete_history
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
    top of the form (the frontend's mapping of section field errors is not guaranteed). A changed ZHA scan period
    is not applied: a second step shows the YAML snippet for configuration.yaml, which this integration never writes."""

    _options: dict[str, Any]

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        try:
            zha: ScanSettings | None = read_settings(self.hass)
        except NotSupported:
            zha = None
        # No period field where ZHA cannot be read or scans nothing (a snippet would also need the switch on).
        current_period = zha.period if zha and zha.enabled is not False else None
        errors: dict[str, str] = {}
        flat: dict[str, Any] = {}
        if user_input is not None:
            # The sections' fields arrive nested; flatten before validating.
            flat = {**{k: v for k, v in user_input.items() if k not in SECTIONS},
                    **{k: v for name in SECTIONS for k, v in user_input.get(name, {}).items()}}
            options, delete, errors = validate_options(flat, self.config_entry.options, current_period)
            if not errors:
                if delete:
                    await async_delete_history(self.hass)
                self._options = options
                if current_period is not None and flat.get(CONF_ZHA_PERIOD) not in (None, current_period):
                    return await self.async_step_snippet()
                return self.async_create_entry(data=options)
            # One base error (the first); the texts carry the numbers. Keep what the user typed.
            errors = {"base": next(iter(errors.values()))}
            current = {**get_options(None), **flat}
        else:
            current = get_options(self.config_entry.options)
        history = vol.Schema({
            vol.Required(CONF_RECORD, default=current[CONF_RECORD]): bool,
            vol.Required(CONF_KEEP_DAYS, default=current[CONF_KEEP_DAYS]): int,
            vol.Required(CONF_DELETE_HISTORY, default=False): bool,
        })
        zha_fields: dict[Any, Any] = {}
        if current_period is not None:
            pending = get_options(self.config_entry.options)[CONF_PENDING_ZHA_PERIOD]
            default = flat.get(CONF_ZHA_PERIOD, pending if pending not in (None, current_period) else current_period)
            zha_fields[vol.Required(CONF_ZHA_PERIOD, default=default)] = int
            # The confirmation box exists only after the warning: the form comes back with it, unticked.
            if ERR_ZHA_SHORT in errors.values() or CONF_CONFIRM_SHORT in flat:
                zha_fields[vol.Required(CONF_CONFIRM_SHORT, default=False)] = bool
        schema = {
            vol.Required(CONF_SIDEBAR, default=current[CONF_SIDEBAR]): bool,
            vol.Required(CONF_RADIO_ACTIONS, default=current[CONF_RADIO_ACTIONS]): bool,
            vol.Required(SECTIONS[0]): section(history, {"collapsed": False}),
        }
        if zha_fields:
            schema[vol.Required(SECTIONS[1])] = section(vol.Schema(zha_fields), {"collapsed": False})
        return self.async_show_form(step_id="init", data_schema=vol.Schema(schema), errors=errors,
                                    description_placeholders={
            "zha_scan": describe(zha),
            "days_range": f"{KEEP_DAYS_RANGE[0]} to {KEEP_DAYS_RANGE[1]}",
            "zha_range": f"{ZHA_PERIOD_RANGE[0]} to {ZHA_PERIOD_RANGE[1]}",
            "recommended": str(ZHA_RECOMMENDED_PERIOD), "minutes": str(flat.get(CONF_ZHA_PERIOD, ""))})

    async def async_step_snippet(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Show the configuration.yaml snippet for the new ZHA period; Submit saves the options (with the pending
        period, which the info command compares with what ZHA reports after the restart)."""
        if user_input is not None:
            return self.async_create_entry(data=self._options)
        period = self._options[CONF_PENDING_ZHA_PERIOD]
        return self.async_show_form(step_id="snippet", data_schema=vol.Schema({}), description_placeholders={
            "snippet": f"zha:\n  zigpy_config:\n    topology_scan_period: {period}", "minutes": str(period)})
