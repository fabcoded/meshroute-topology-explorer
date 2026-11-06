# SPDX-License-Identifier: MIT
"""L2: the integration against a real Home Assistant, one test per seam where the stubs of tests/ could be wrong
(quality plan S4). Run: python3 -m pytest tests_ha (see requirements-ha-latest.txt)."""

from datetime import timedelta

import pytest
from homeassistant.components import websocket_api
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.util import dt as dt_util

from custom_components.meshroute_topology_explorer import recorder
from custom_components.meshroute_topology_explorer.const import DOMAIN, PANEL_URL_PATH

from .compat import MockConfigEntry, async_fire_time_changed

INFO = {"type": f"{DOMAIN}/history/info"}


async def setup(hass: HomeAssistant, entry: MockConfigEntry) -> None:
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert entry.state is ConfigEntryState.LOADED


def submit(sidebar=True, keep_days=30, delete_history=False) -> dict:
    """A complete form submission: the real schema requires every field and both sections."""
    return {"sidebar": sidebar, "radio_actions": True,
            "history": {"record": True, "keep_days": keep_days, "delete_history": delete_history},
            "zha": {"scan_after_start": False}}


def panels(hass: HomeAssistant) -> dict:
    return hass.data.get("frontend_panels", {})


async def test_setup_registers_the_admin_only_panel_and_unload_removes_it(hass, entry):
    await setup(hass, entry)
    panel = panels(hass)[PANEL_URL_PATH]
    assert panel.require_admin
    assert panel.config["_panel_custom"]["name"] == "meshroute-topology-explorer"
    assert await hass.config_entries.async_unload(entry.entry_id)
    assert PANEL_URL_PATH not in panels(hass)


async def test_sidebar_option_off_registers_no_panel(hass):
    entry = MockConfigEntry(domain=DOMAIN, data={}, options={"sidebar": False})
    entry.add_to_hass(hass)
    await setup(hass, entry)
    assert PANEL_URL_PATH not in panels(hass)


async def test_history_info_admin_gets_an_answer_non_admin_is_refused(hass, hass_ws_client, hass_read_only_access_token, entry):
    await setup(hass, entry)
    admin = await hass_ws_client(hass)
    await admin.send_json_auto_id(INFO)
    answer = await admin.receive_json()
    assert answer["success"] and answer["result"]["record"] is True and answer["result"]["keep_days"] == 30
    reader = await hass_ws_client(hass, hass_read_only_access_token)
    await reader.send_json_auto_id(INFO)
    refused = await reader.receive_json()
    assert not refused["success"] and refused["error"]["code"] == websocket_api.ERR_UNAUTHORIZED


async def test_options_flow_form_error_delete_and_reload(hass, entry):
    await setup(hass, entry)
    form = await hass.config_entries.options.async_init(entry.entry_id)
    assert form["type"] is FlowResultType.FORM
    assert set(form["data_schema"].schema) >= {"sidebar", "radio_actions", "history", "zha"}
    flow_id = form["flow_id"]
    bad = await hass.config_entries.options.async_configure(flow_id, submit(keep_days=0))
    assert bad["type"] is FlowResultType.FORM and bad["errors"] == {"base": "days_range"}
    # The history gets one record's worth of state to delete: ask the real object, then submit the delete switch.
    history = recorder.get_history(hass)
    calls = []
    original = history.delete_all
    history.delete_all = lambda: calls.append(1) or original()
    done = await hass.config_entries.options.async_configure(
        flow_id, submit(sidebar=False, keep_days=7, delete_history=True))
    assert done["type"] is FlowResultType.CREATE_ENTRY and calls == [1]
    await hass.async_block_till_done()  # OptionsFlowWithReload: the update listener reloads the entry
    assert entry.options["keep_days"] == 7 and "delete_history" not in entry.options
    assert entry.state is ConfigEntryState.LOADED
    assert PANEL_URL_PATH not in panels(hass)  # the reload ran setup again with sidebar off


@pytest.fixture
def thread_and_zha(hass):
    """A Matter command with one Thread link and a ZHA command that must stay unread; ZHA's topology is a fake."""
    reads = []

    @websocket_api.websocket_command({"type": "matter/network_topology", "refresh": bool})
    @websocket_api.async_response
    async def matter(hass, connection, msg):
        connection.send_result(msg["id"], {"collected_at": dt_util.utcnow().timestamp() + 5, "connections": [
            {"network": "thread", "source": 1, "target": 2, "source_to_target": {"lqi": 3, "rssi": -60},
             "target_to_source": {"lqi": 2, "rssi": -70}}],
            "nodes": [{"id": i, "network_type": "thread", "ext_pan_id": "aabbccdd", "ext_address": f"0x{i:016x}"}
                      for i in (1, 2)]})

    @websocket_api.websocket_command({"type": "zha/devices"})
    @websocket_api.async_response
    async def zha(hass, connection, msg):
        reads.append(msg)
        connection.send_result(msg["id"], [])

    websocket_api.async_register_command(hass, matter)
    websocket_api.async_register_command(hass, zha)
    hass.config.components.update({"zha", "matter"})
    MockConfigEntry(domain="zha").add_to_hass(hass)
    return reads


async def test_start_path_reads_thread_but_not_zigbee_in_events_mode(hass, entry, thread_and_zha, monkeypatch):
    class Topology:
        _scan_task = None

        def add_listener(self, listener): ...

        def remove_listener(self, listener): ...

    fake = Topology()
    monkeypatch.setattr(recorder, "read_settings", lambda hass: recorder.ScanSettings(240, True))
    monkeypatch.setattr(recorder, "topology", lambda hass: fake)
    await setup(hass, entry)  # async_at_started: the test instance is already running, so _started ran in setup
    async_fire_time_changed(hass, dt_util.utcnow() + timedelta(seconds=recorder.FIRST_RECORD_DELAY + 1))
    await hass.async_block_till_done()
    info = await recorder.async_info(hass)
    assert info["follow_mode"] == "events" and info["records"] == 1
    assert thread_and_zha == []  # no Zigbee read at start
    assert await hass.config_entries.async_unload(entry.entry_id)
