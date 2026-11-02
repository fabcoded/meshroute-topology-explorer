# SPDX-License-Identifier: MIT
"""Options of the integration: defaults, validation of the options form, and the reading of an entry's options.

Pure functions, no Home Assistant import, so the tests run them directly. The form is in config_flow.py; the
rules are docs/spec.md section 10.1 (board M33 of the design).
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from .const import (
    CONF_CONFIRM_SHORT,
    CONF_DELETE_HISTORY,
    CONF_KEEP_DAYS,
    CONF_RADIO_ACTIONS,
    CONF_RECORD,
    CONF_RECORD_HOURS,
    CONF_SIDEBAR,
    DEFAULT_OPTIONS,
    KEEP_DAYS_RANGE,
    RECOMMENDED_RECORD_HOURS,
    RECORD_HOURS_RANGE,
)

ERR_HOURS_RANGE = "hours_range"
ERR_DAYS_RANGE = "days_range"
ERR_HOURS_SHORT = "hours_short"


def _in_range(value: Any, bounds: tuple[int, int]) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and bounds[0] <= value <= bounds[1]


def get_options(options: Mapping[str, Any] | None) -> dict[str, Any]:
    """The stored options with the defaults filled in; a value of the wrong type or out of range (a hand-edited
    entry: 0 hours would be a timer loop) falls back to its default."""
    stored = options or {}
    out = dict(DEFAULT_OPTIONS)
    bounds = {CONF_RECORD_HOURS: RECORD_HOURS_RANGE, CONF_KEEP_DAYS: KEEP_DAYS_RANGE}
    for key, default in DEFAULT_OPTIONS.items():
        value = stored.get(key, default)
        # bool is an int subclass: a stored True must not pass for a number of hours.
        if isinstance(value, bool) == isinstance(default, bool) and isinstance(value, type(default)) \
                and (key not in bounds or _in_range(value, bounds[key])):
            out[key] = value
    return out


def validate_options(user_input: Mapping[str, Any], previous: Mapping[str, Any] | None = None,
                     ) -> tuple[dict[str, Any], bool, dict[str, str]]:
    """Check a submitted form: (options to store, delete the history, errors by field).

    Out of range: error with the allowed range (the form's description placeholders carry it). An interval under
    RECOMMENDED_RECORD_HOURS is an error until the confirmation is ticked, unless it is the interval already stored
    (a later save of other options does not ask again). The delete switch and the confirmation are not stored.
    """
    merged = {**DEFAULT_OPTIONS, **{k: v for k, v in user_input.items() if k in DEFAULT_OPTIONS}}
    errors: dict[str, str] = {}
    hours, days = merged[CONF_RECORD_HOURS], merged[CONF_KEEP_DAYS]
    if not _in_range(hours, RECORD_HOURS_RANGE):
        errors[CONF_RECORD_HOURS] = ERR_HOURS_RANGE
    elif (hours < RECOMMENDED_RECORD_HOURS and hours != get_options(previous)[CONF_RECORD_HOURS]
          and not user_input.get(CONF_CONFIRM_SHORT)):
        errors[CONF_CONFIRM_SHORT] = ERR_HOURS_SHORT
    if not _in_range(days, KEEP_DAYS_RANGE):
        errors[CONF_KEEP_DAYS] = ERR_DAYS_RANGE
    for key in (CONF_SIDEBAR, CONF_RADIO_ACTIONS, CONF_RECORD):
        merged[key] = bool(merged[key])
    return merged, bool(user_input.get(CONF_DELETE_HISTORY)), errors
