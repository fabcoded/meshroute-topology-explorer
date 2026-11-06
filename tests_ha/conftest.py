# SPDX-License-Identifier: MIT
"""Fixtures of the L2 tests: the integration under test is loaded from this repository into a real Home Assistant
test instance (pytest-homeassistant, requirements-ha-latest.txt). Run: python3 -m pytest tests_ha"""

import pytest
from .compat import MockConfigEntry


from custom_components.meshroute_topology_explorer.const import DOMAIN


@pytest.fixture(autouse=True)
def _enable_custom_integrations(enable_custom_integrations):
    """Let Home Assistant find custom_components/ of this repository."""


@pytest.fixture(autouse=True)
def _own_config_dir(hass, tmp_path):
    """The reception history writes below the config folder; keep it out of the repository (tests/testing_config)."""
    hass.config.config_dir = str(tmp_path)


@pytest.fixture
def entry(hass):
    """The one allowed config entry, added but not yet set up."""
    entry = MockConfigEntry(domain=DOMAIN, data={}, options={})
    entry.add_to_hass(hass)
    return entry
