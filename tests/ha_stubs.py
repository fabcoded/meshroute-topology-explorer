# SPDX-License-Identifier: MIT
"""Minimal stand-ins for the Home Assistant modules the integration imports, shaped after core 2026.10.2.

Used by test_setup.py and test_websocket_api.py (python3 -m unittest discover -s tests). Mirrored signatures:
websocket_api.async_register_command(hass, command, handler, schema) and async_response (websocket_api/__init__.py,
decorators.py); Store(hass, version, key) with async_load / async_delay_save(data_func, delay) (helpers/storage.py);
panel_custom.async_register_panel and frontend.async_remove_panel; hass.http.async_register_static_paths.
"""

import asyncio
import importlib
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
        FakeStore.instances.append(self)

    async def async_load(self):
        if FakeStore.load_error:
            raise FakeStore.load_error
        return FakeStore.stored

    def async_delay_save(self, data_func, delay=0):
        self.delay_calls.append((data_func, delay))


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
    comps.__dict__.update(websocket_api=ws, frontend=fe, panel_custom=pc, http=http)
    helpers.storage = st
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
