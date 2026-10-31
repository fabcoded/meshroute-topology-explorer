# SPDX-License-Identifier: MIT
"""Minimal stand-ins for the Home Assistant modules the integration imports, shaped after core 2026.10.2.

Used by test_setup.py and test_websocket_api.py (python3 -m unittest discover -s tests). Mirrored signatures:
websocket_api.async_register_command(hass, command, handler, schema) and async_response (websocket_api/__init__.py,
decorators.py); Store(hass, version, key) with async_load / async_delay_save(data_func, delay) (helpers/storage.py);
helpers.json.json_bytes (orjson, helpers/json.py:61-66); panel_custom.async_register_panel and frontend.async_remove_panel; hass.http.async_register_static_paths.
"""

import asyncio
import importlib
import json
import sys
import types
from unittest import mock

COMPONENT = "custom_components.meshroute_topology_explorer"


class FakeStore:
    """Records what the integration does; `stored` is the pretend file content (None = no file)."""

    instances = []
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
        if isinstance(o, float) and o != o or o in (float("inf"), float("-inf")):
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


class FakeHass:
    def __init__(self):
        self.data = {}
        self.http = types.SimpleNamespace(async_register_static_paths=mock.AsyncMock())


def install():
    """Put fake modules into sys.modules; returns (module dict, recorders). Caller restores sys.modules."""
    FakeStore.instances, FakeStore.stored, FakeStore.load_error = [], None, None
    rec = types.SimpleNamespace(commands={}, panels=[], removed=[])

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
             ERR_INVALID_FORMAT="invalid_format")
    fe = mod("homeassistant.components.frontend", async_remove_panel=async_remove_panel)
    pc = mod("homeassistant.components.panel_custom", async_register_panel=async_register_panel)
    http = mod("homeassistant.components.http", StaticPathConfig=lambda url, path, cache: (url, path, cache))
    mod("homeassistant.config_entries", ConfigEntry=object)
    mod("homeassistant.core", HomeAssistant=object)
    helpers = mod("homeassistant.helpers")
    st = mod("homeassistant.helpers.storage", Store=FakeStore)
    hjson = mod("homeassistant.helpers.json", json_bytes=fake_json_bytes)
    comps.__dict__.update(websocket_api=ws, frontend=fe, panel_custom=pc, http=http)
    helpers.storage, helpers.json = st, hjson
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
