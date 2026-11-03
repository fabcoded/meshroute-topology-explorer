# SPDX-License-Identifier: MIT
"""Options of the integration: defaults, validation of the options form, and the reading of an entry's options.

Pure functions, no Home Assistant import, so the tests run them directly. The form is in config_flow.py; the
rules are docs/spec.md section 10.1.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from .const import (
    CONF_CONFIRM_SHORT,
    CONF_DELETE_HISTORY,
    CONF_KEEP_DAYS,
    CONF_PENDING_ZHA_PERIOD,
    CONF_RADIO_ACTIONS,
    CONF_RECORD,
    CONF_SIDEBAR,
    CONF_ZHA_PERIOD,
    DEFAULT_OPTIONS,
    KEEP_DAYS_RANGE,
    ZHA_PERIOD_RANGE,
    ZHA_RECOMMENDED_PERIOD,
)

ERR_DAYS_RANGE = "days_range"
ERR_ZHA_RANGE = "zha_range"
ERR_ZHA_SHORT = "zha_short"


def _in_range(value: Any, bounds: tuple[int, int]) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and bounds[0] <= value <= bounds[1]


def get_options(options: Mapping[str, Any] | None) -> dict[str, Any]:
    """The stored options with the defaults filled in; a value of the wrong type or out of range (a hand-edited
    entry) falls back to its default. CONF_PENDING_ZHA_PERIOD is None unless a valid period is stored."""
    stored = options or {}
    out: dict[str, Any] = dict(DEFAULT_OPTIONS)
    for key, default in DEFAULT_OPTIONS.items():
        value = stored.get(key, default)
        # bool is an int subclass: a stored True must not pass for a number of days.
        if isinstance(value, bool) == isinstance(default, bool) and isinstance(value, type(default)) \
                and (key != CONF_KEEP_DAYS or _in_range(value, KEEP_DAYS_RANGE)):
            out[key] = value
    pending = stored.get(CONF_PENDING_ZHA_PERIOD)
    out[CONF_PENDING_ZHA_PERIOD] = pending if _in_range(pending, ZHA_PERIOD_RANGE) else None
    return out


def validate_options(user_input: Mapping[str, Any], previous: Mapping[str, Any] | None = None,
                     zha_current: int | None = None) -> tuple[dict[str, Any], bool, dict[str, str]]:
    """Check a submitted form: (options to store, delete the history, errors by field).

    Out of range: error (the form's description placeholders carry the range). A ZHA period different from the
    current one (`zha_current`, None when ZHA cannot be read or its scan is off: the field is ignored) is stored as the pending period;
    under ZHA_RECOMMENDED_PERIOD it is an error until the confirmation is ticked. The current value entered again, or
    a pending period that ZHA reports now, clears the pending period. The delete switch, the new period field and the confirmation are not stored as such.
    """
    merged = {**DEFAULT_OPTIONS, **{k: v for k, v in user_input.items() if k in DEFAULT_OPTIONS}}
    errors: dict[str, str] = {}
    if not _in_range(merged[CONF_KEEP_DAYS], KEEP_DAYS_RANGE):
        errors[CONF_KEEP_DAYS] = ERR_DAYS_RANGE
    for key in (CONF_SIDEBAR, CONF_RADIO_ACTIONS, CONF_RECORD):
        merged[key] = bool(merged[key])
    pending = get_options(previous)[CONF_PENDING_ZHA_PERIOD]
    period = user_input.get(CONF_ZHA_PERIOD)
    if zha_current is not None and period == zha_current:
        pending = None  # the current value entered again: the user dropped the change
    elif zha_current is not None and period is not None:
        if not _in_range(period, ZHA_PERIOD_RANGE):
            errors[CONF_ZHA_PERIOD] = ERR_ZHA_RANGE
        elif period < ZHA_RECOMMENDED_PERIOD and not user_input.get(CONF_CONFIRM_SHORT):
            errors[CONF_CONFIRM_SHORT] = ERR_ZHA_SHORT
        else:
            pending = period
    if pending is not None and pending != zha_current:
        merged[CONF_PENDING_ZHA_PERIOD] = pending
    return merged, bool(user_input.get(CONF_DELETE_HISTORY)), errors
