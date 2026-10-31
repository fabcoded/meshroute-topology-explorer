# SPDX-License-Identifier: MIT
"""Config flow: a single confirmation step that creates the one allowed entry (manifest: single_config_entry)."""

from __future__ import annotations

from typing import Any

from homeassistant.config_entries import ConfigFlow, ConfigFlowResult

from .const import DOMAIN, TITLE


class MeshrouteConfigFlow(ConfigFlow, domain=DOMAIN):
    """Nothing to configure: the panel reads what Home Assistant already knows."""

    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Show a bare confirmation form, then create the entry."""
        if user_input is not None:
            return self.async_create_entry(title=TITLE, data={})
        return self.async_show_form(step_id="user")
