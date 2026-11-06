# SPDX-License-Identifier: MIT
"""One import place for the test helpers: the package is called pytest_homeassistant from Home Assistant 2026.11 and
pytest_homeassistant_custom_component before (requirements-ha-min.txt)."""

try:
    from pytest_homeassistant.common import MockConfigEntry, async_fire_time_changed
except ImportError:  # the minimum release
    from pytest_homeassistant_custom_component.common import MockConfigEntry, async_fire_time_changed

__all__ = ["MockConfigEntry", "async_fire_time_changed"]
