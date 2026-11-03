# SPDX-License-Identifier: MIT
"""Options of the integration: defaults, validation of the options form, and the reading of an entry's options.

Pure functions, no Home Assistant import, so the tests run them directly. The form is in config_flow.py; the
rules are docs/spec.md section 10.1.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from .const import (
    CONF_DELETE_HISTORY,
    CONF_KEEP_DAYS,
    CONF_RADIO_ACTIONS,
    CONF_RECORD,
    CONF_SCAN_AFTER_START,
    CONF_SIDEBAR,
    DEFAULT_OPTIONS,
    KEEP_DAYS_RANGE,
)

ERR_DAYS_RANGE = "days_range"


def _in_range(value: Any, bounds: tuple[int, int]) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and bounds[0] <= value <= bounds[1]


def get_options(options: Mapping[str, Any] | None) -> dict[str, Any]:
    """The stored options with the defaults filled in; a value of the wrong type or out of range (a hand-edited
    entry) falls back to its default."""
    stored = options or {}
    out: dict[str, Any] = dict(DEFAULT_OPTIONS)
    for key, default in DEFAULT_OPTIONS.items():
        value = stored.get(key, default)
        # bool is an int subclass: a stored True must not pass for a number of days.
        if isinstance(value, bool) == isinstance(default, bool) and isinstance(value, type(default)) \
                and (key != CONF_KEEP_DAYS or _in_range(value, KEEP_DAYS_RANGE)):
            out[key] = value
    return out


def validate_options(user_input: Mapping[str, Any]) -> tuple[dict[str, Any], bool, dict[str, str]]:
    """Check a submitted form: (options to store, delete the history, errors by field).

    Out of range: error (the form's description placeholders carry the range). The delete switch is not stored."""
    merged = {**DEFAULT_OPTIONS, **{k: v for k, v in user_input.items() if k in DEFAULT_OPTIONS}}
    errors: dict[str, str] = {}
    if not _in_range(merged[CONF_KEEP_DAYS], KEEP_DAYS_RANGE):
        errors[CONF_KEEP_DAYS] = ERR_DAYS_RANGE
    for key in (CONF_SIDEBAR, CONF_RADIO_ACTIONS, CONF_RECORD, CONF_SCAN_AFTER_START):
        merged[key] = bool(merged[key])
    return merged, bool(user_input.get(CONF_DELETE_HISTORY)), errors
