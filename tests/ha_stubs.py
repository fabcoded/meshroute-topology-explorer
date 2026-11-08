# SPDX-License-Identifier: MIT
"""Minimal stand-ins for the Home Assistant modules the integration imports, shaped after core 2026.10.2.

Used by test_setup.py and test_websocket_api.py (python3 -m unittest discover -s tests). Mirrored signatures:
websocket_api.async_register_command(hass, command, handler, schema) and async_response (websocket_api/__init__.py,
decorators.py); Store(hass, version, key) with async_load / async_delay_save(data_func, delay) (helpers/storage.py);
helpers.json.json_bytes (orjson, helpers/json.py:61-66); panel_custom.async_register_panel and
frontend.async_remove_panel; hass.http.async_register_static_paths; hass.async_add_executor_job.
"""

import asyncio
import importlib
import json
import os
import sys
import types
from unittest import mock

COMPONENT = "custom_components.meshroute_topology_explorer"


class FakeStore:
    """Records what the integration does; `stored` is the pretend file content (None = no file)."""

    instances = []  # noqa: RUF012 - shared on purpose: tests inspect what every instance recorded
    stored = None
    load_error = None

    def __init__(self, hass, version, key, *args, **kwargs):
        self.version, self.key = version, key
        self.delay_calls = []
        self.removed = False
        FakeStore.instances.append(self)

    async def async_load(self):
        if FakeStore.load_error:
            raise FakeStore.load_error
        return FakeStore.stored

    def async_delay_save(self, data_func, delay=0):
        self.delay_calls.append((data_func, delay))

    async def async_remove(self):
        self.removed = True


ORJSON_MAX_DEPTH = 254  # orjson refuses to serialize deeper nesting (it raises JSONEncodeError, a TypeError)


def fake_json_bytes(obj):
    """Behaves like helpers/json.py json_bytes (orjson, OPT_NON_STR_KEYS) for what the tests need.

    NaN/Infinity become null (orjson does not raise), non-string keys become strings, depth above 254 raises.
    """

    def walk(o, depth):
        if depth > ORJSON_MAX_DEPTH:
            raise TypeError("Recursion limit reached")
        if isinstance(o, dict):
            return {str(k): walk(v, depth + 1) for k, v in o.items()}
        if isinstance(o, list):
            return [walk(v, depth + 1) for v in o]
        if (isinstance(o, float) and o != o) or o in (float("inf"), float("-inf")):
            return None
        if not isinstance(o, (str, int, float, bool, type(None))):
            raise TypeError("Type is not JSON serializable")
        return o

    return json.dumps(walk(obj, 0), separators=(",", ":"), ensure_ascii=False).encode("utf-8")


class FakeConnection:
    """ActiveConnection with the three members the handlers use."""

    def __init__(self, admin=True, user=True):
        self.user = types.SimpleNamespace(is_admin=admin) if user else None
        self.results, self.errors = [], []

    def send_result(self, msg_id, result=None):
        self.results.append((msg_id, result))

    def send_error(self, msg_id, code, message, **kwargs):
        self.errors.append((msg_id, code, message))


class FakeEntry:
    """ConfigEntry with the members the integration uses: options, entry_id, update listener and unload callbacks."""

    def __init__(self, options=None, entry_id="entry1"):
        self.options, self.entry_id = dict(options or {}), entry_id
        self.listeners, self.unloads = [], []

    def add_update_listener(self, listener):
        self.listeners.append(listener)
        return lambda: self.listeners.remove(listener)

    def async_on_unload(self, func):
        self.unloads.append(func)

    def unload(self):
        """What Home Assistant does on unload: call the registered callbacks."""
        for func in self.unloads:
            func()
        self.unloads.clear()


class FakeHass:
    def __init__(self, components=(), config_dir="/nonexistent"):
        self.data = {}
        # hass.config.components: the loaded integrations (zigpy_routes.py asks whether "zha" is among them).
        self.config = types.SimpleNamespace(components=set(components),
                                            path=lambda *parts: os.path.join(config_dir, *parts))
        self.zha_entries = []
        self.config_entries = types.SimpleNamespace(
            # include_ignore / include_disabled: the stub's entries are all set up; the filter is tested in tests_ha.
            async_entries=lambda domain, include_ignore=True, include_disabled=True:
            list(self.zha_entries) if domain == "zha" else [], async_reload=mock.AsyncMock())
        self.http = types.SimpleNamespace(async_register_static_paths=mock.AsyncMock())

    async def async_add_executor_job(self, func, *args):
        # Home Assistant runs func in a worker thread (core.py); the tests run it inline.
        return func(*args)


class _Interval(tuple):
    """(period, action) of one interval timer, equal only to itself: a timer created again with the same period and
    action is never taken for the cancelled one (`in rec.cancelled_intervals`)."""

    __eq__, __ne__, __hash__ = object.__eq__, object.__ne__, object.__hash__


def _interval(rec, action, period):
    """Record an interval timer as (period, action); its cancel is recorded in rec.cancelled_intervals."""
    entry = _Interval((period, action))
    rec.intervals.append(entry)
    return lambda: rec.cancelled_intervals.append(entry)


def install():  # noqa: C901 - existing; see plan-qualitaet S6
    """Put fake modules into sys.modules; returns (module dict, recorders). Caller restores sys.modules."""
    FakeStore.instances, FakeStore.stored, FakeStore.load_error = [], None, None
    rec = types.SimpleNamespace(commands={}, panels=[], removed=[], later=[], intervals=[], started=[], signals=[],
                                cancelled_intervals=[])

    def mod(name, **attrs):
        m = types.ModuleType(name)
        m.__dict__.update(attrs)
        sys.modules[name] = m
        return m

    def async_response(func):
        # The real decorator schedules a background task; here the test awaits the coroutine function directly.
        return func

    def async_register_command(hass, command, handler, schema):
        rec.commands[command] = (handler, schema)

    async def async_register_panel(hass, **kwargs):
        rec.panels.append(kwargs)

    def async_remove_panel(hass, url_path):
        rec.removed.append(url_path)

    ha = mod("homeassistant")
    comps = mod("homeassistant.components")
    ws = mod("homeassistant.components.websocket_api", async_response=async_response,
             async_register_command=async_register_command, ERR_UNAUTHORIZED="unauthorized",
             ERR_INVALID_FORMAT="invalid_format", ERR_NOT_SUPPORTED="not_supported")
    fe = mod("homeassistant.components.frontend", async_remove_panel=async_remove_panel)
    pc = mod("homeassistant.components.panel_custom", async_register_panel=async_register_panel)
    http = mod("homeassistant.components.http", StaticPathConfig=lambda url, path, cache: (url, path, cache))
    class ConfigFlow:
        def __init_subclass__(cls, domain=None, **kwargs):
            super().__init_subclass__(**kwargs)

    class OptionsFlow:
        """Just enough of the real one: forms and entries are returned as dicts for the tests to inspect."""

        config_entry = None
        hass = None

        def async_show_form(self, **kwargs):
            return {"type": "form", **kwargs}

        def async_create_entry(self, **kwargs):
            return {"type": "create_entry", **kwargs}

    class OptionsFlowWithReload(OptionsFlow):
        """Home Assistant reloads the entry after a create_entry of this flow."""

    class Schema(dict):
        def __init__(self, schema):
            super().__init__({getattr(k, "schema", k): (k, v) for k, v in schema.items()})

    class Required:
        """Like probatio's marker: the default is stored as a zero-argument factory."""

        def __init__(self, schema, default=None):
            self.schema = schema
            self.default = lambda: default

    mod("probatio", Schema=Schema, Required=Required)
    mod("homeassistant.config_entries", ConfigEntry=object, SIGNAL_CONFIG_ENTRY_CHANGED="config_entry_changed", ConfigFlow=ConfigFlow, ConfigFlowResult=dict,
        OptionsFlow=OptionsFlow, OptionsFlowWithReload=OptionsFlowWithReload)
    mod("homeassistant.data_entry_flow", section=lambda schema, options=None: ("section", schema, options))
    def callback(func):
        func._is_callback = True  # like core's is_callback: a plain def given to a helper would run in an executor
        return func

    def checked(func):
        assert getattr(func, "_is_callback", False) or asyncio.iscoroutinefunction(func), f"{func} is not a callback"
        return func

    mod("homeassistant.core", HomeAssistant=object, callback=callback)
    def later(delay, action):
        """Record a one-shot timer; the returned cancel marks it, the test runs `action` itself."""
        timer = types.SimpleNamespace(delay=delay, action=action, cancelled=False)
        rec.later.append(timer)
        return lambda: setattr(timer, "cancelled", True)

    event = mod("homeassistant.helpers.event",
                async_call_later=lambda hass, delay, action: later(delay, action),
                async_track_time_interval=lambda hass, action, period: _interval(rec, action, period))
    helpers = mod("homeassistant.helpers")
    st = mod("homeassistant.helpers.storage", Store=FakeStore)
    hjson = mod("homeassistant.helpers.json", json_bytes=fake_json_bytes)
    start = mod("homeassistant.helpers.start",
                async_at_started=lambda hass, cb: rec.started.append(checked(cb)) or (lambda: None))
    dispatcher = mod("homeassistant.helpers.dispatcher", async_dispatcher_connect=lambda hass, signal, target:
                     rec.signals.append(checked(target)) or (lambda: rec.signals.remove(target)))
    comps.__dict__.update(websocket_api=ws, frontend=fe, panel_custom=pc, http=http)
    helpers.storage, helpers.json, helpers.event, helpers.start = st, hjson, event, start
    helpers.dispatcher = dispatcher
    ha.components, ha.helpers = comps, helpers
    # config_flow.py imports more of Home Assistant; the tests never load it.
    for name in list(sys.modules):
        if name.startswith("custom_components"):
            del sys.modules[name]
    return rec


def load(name=""):
    return importlib.import_module(COMPONENT + name)


def run(coro):
    return asyncio.run(coro)
