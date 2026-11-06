# SPDX-License-Identifier: MIT
"""Options: validation (ranges), the options form (delete on submit, reload on save),
sidebar off, radio-actions flag in the panel config, removal deletes the history (stubbed Home Assistant).
python3 -m unittest discover -s tests"""

import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).parent))
import ha_stubs


class Base(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.dict(sys.modules)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.rec = ha_stubs.install()
        root = str(Path(__file__).resolve().parent.parent)
        sys.path.insert(0, root)
        self.addCleanup(sys.path.remove, root)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.hass = ha_stubs.FakeHass(config_dir=self.tmp.name)
        self.comp = ha_stubs.load()
        self.opt = ha_stubs.load(".options")


class ValidationTest(Base):
    def check(self, **fields):
        return self.opt.validate_options(fields)

    def test_defaults_fill_missing_keys(self):
        stored, delete, errors = self.check()
        self.assertEqual(stored, {"sidebar": True, "radio_actions": True, "record": True, "keep_days": 30,
                                  "scan_after_start": False})  # the one-time scan is off by default
        self.assertFalse(delete)
        self.assertEqual(errors, {})
        self.assertNotIn("record_hours", stored)  # the own interval is gone: ZHA's scans trigger records

    def test_keep_days_range(self):
        for days in (0, 91, "30", False):
            self.assertEqual(self.check(keep_days=days)[2], {"keep_days": "days_range"}, repr(days))
        self.assertEqual(self.check(keep_days=90)[2], {})
        self.assertEqual(self.check(keep_days=1)[2], {})

    def test_delete_flag_is_not_stored(self):
        stored, delete, _ = self.check(delete_history=True)
        self.assertTrue(delete)
        self.assertNotIn("delete_history", stored)

    def test_get_options_out_of_range_falls_back(self):
        self.assertEqual(self.opt.get_options({"keep_days": 500})["keep_days"], 30)

    def test_get_options_ignores_wrong_types(self):
        got = self.opt.get_options({"keep_days": True, "sidebar": "yes"})
        self.assertEqual((got["keep_days"], got["sidebar"]), (30, True))


class FlowTest(Base):
    def setUp(self):
        super().setUp()
        self.set_zha(period=240)

    def set_zha(self, period=240, enabled=True):
        """ZHA's application config as read through zigpy_routes' gateway access."""
        app = types.SimpleNamespace(config={"topology_scan_period": period, "topology_scan_enabled": enabled})
        self.zha_patch = mock.patch.object(ha_stubs.load(".zha_scan"), "_application", return_value=app)
        self.zha_patch.start()
        self.addCleanup(self.zha_patch.stop)

    def flow(self, options=None):
        cf = ha_stubs.load(".config_flow")
        flow = cf.MeshrouteOptionsFlow()
        flow.hass = self.hass
        flow.config_entry = ha_stubs.FakeEntry(options)
        return flow

    def submit(self, flow, keep_days=30, delete=False, sidebar=True, radio=True):
        data = {"sidebar": sidebar, "radio_actions": radio,
                "history": {"record": True, "keep_days": keep_days, "delete_history": delete},
                "zha": {"scan_after_start": False}}
        return ha_stubs.run(flow.async_step_init(data))

    def test_form_shows_current_values_and_the_zha_line(self):
        result = ha_stubs.run(self.flow({"keep_days": 7}).async_step_init())
        self.assertEqual((result["type"], result["errors"]), ("form", {}))
        history = result["data_schema"]["history"][1][1]
        self.assertEqual(history["keep_days"][0].default(), 7)
        self.assertNotIn("record_hours", history)
        self.assertEqual(set(result["data_schema"]["zha"][1][1]), {"scan_after_start"})  # no period field
        self.assertEqual(result["description_placeholders"]["zha_scan"], "ZHA scans every 240 min")

    def test_form_schema_is_probatio_with_defaults(self):
        result = ha_stubs.run(self.flow({}).async_step_init())
        self.assertIn("probatio", sys.modules)
        self.assertNotIn("voluptuous", sys.modules)
        schema = result["data_schema"]
        self.assertEqual({k: schema[k][0].default() for k in ("sidebar", "radio_actions")}, {"sidebar": True, "radio_actions": True})
        history = schema["history"][1][1]
        self.assertFalse(history["delete_history"][0].default())  # deleting is never preselected

    def test_zha_line_for_off_unknown_and_unreadable(self):
        self.zha_patch.stop()
        self.set_zha(enabled=False)
        result = ha_stubs.run(self.flow().async_step_init())
        self.assertIn("scan is off", result["description_placeholders"]["zha_scan"])
        self.assertIn("topology_scan_enabled: true", result["description_placeholders"]["zha_scan"])
        self.zha_patch.stop()
        app = types.SimpleNamespace(config={})  # no period in the config: unknown, never a made-up default
        with mock.patch.object(ha_stubs.load(".zha_scan"), "_application", return_value=app):
            result = ha_stubs.run(self.flow().async_step_init())
        self.assertEqual(result["description_placeholders"]["zha_scan"], "ZHA's scan period is unknown")
        reason = ha_stubs.load(".zigpy_routes").NotSupported("zha_not_loaded", "x")
        with mock.patch.object(ha_stubs.load(".zha_scan"), "_application", side_effect=reason):
            result = ha_stubs.run(self.flow().async_step_init())
        self.assertEqual(result["description_placeholders"]["zha_scan"], "ZHA's scan period is unknown")

    def test_saving_other_options_does_not_touch_zha(self):
        result = self.submit(self.flow(), keep_days=10, sidebar=False, radio=False)
        self.assertEqual(result["type"], "create_entry")
        self.assertEqual(result["data"], {"sidebar": False, "radio_actions": False, "record": True, "keep_days": 10,
                                          "scan_after_start": False})

    def test_out_of_range_names_the_range(self):
        result = self.submit(self.flow(), keep_days=91)
        self.assertEqual(result["errors"], {"base": "days_range"})
        self.assertEqual(result["description_placeholders"]["days_range"], "1 to 90")

    def test_delete_acts_on_submit_only_when_valid(self):
        history = self.comp.recorder.get_history(self.hass)
        history.files.append("n", 1_700_000_000, ha_stubs.load(".history").Snapshot({("a", "b"): (1, None)}))
        self.assertEqual(history.files.info()["records"], 1)
        self.submit(self.flow(), keep_days=0, delete=True)  # refused: nothing deleted
        self.assertEqual(history.files.info()["records"], 1)
        result = self.submit(self.flow(), delete=True)
        self.assertNotIn("delete_history", result["data"])
        self.assertEqual(history.files.info()["records"], 0)


class SetupOptionsTest(Base):
    def setup(self, options=None):
        entry = ha_stubs.FakeEntry(options)
        ha_stubs.run(self.comp.async_setup_entry(self.hass, entry))
        return entry

    def test_sidebar_off_registers_no_panel_and_unload_removes_nothing(self):
        entry = self.setup({"sidebar": False})
        self.assertEqual(self.rec.panels, [])
        self.assertEqual(len(self.rec.commands), 8)  # the commands stay: the panel URL is simply not there
        self.assertTrue(ha_stubs.run(self.comp.async_unload_entry(self.hass, entry)))
        self.assertEqual(self.rec.removed, [])

    def test_sidebar_back_on_after_reload(self):
        entry = self.setup({"sidebar": False})
        ha_stubs.run(self.comp.async_unload_entry(self.hass, entry))
        entry.options = {"sidebar": True}
        ha_stubs.run(self.comp.async_setup_entry(self.hass, entry))
        self.assertEqual(len(self.rec.panels), 1)
        ha_stubs.run(self.comp.async_unload_entry(self.hass, entry))
        self.assertEqual(self.rec.removed, ["meshroute-topology"])

    def test_radio_actions_flag_reaches_the_panel(self):
        self.setup({"radio_actions": False})
        self.assertIs(self.rec.panels[0]["config"]["radio_actions"], False)

    def test_flow_reloads_the_entry_through_home_assistant(self):
        """OptionsFlowWithReload does the reload after a save; the integration registers no own update listener."""
        cf = ha_stubs.load(".config_flow")
        self.assertTrue(issubclass(cf.MeshrouteOptionsFlow, sys.modules["homeassistant.config_entries"].OptionsFlowWithReload))
        entry = self.setup()
        self.assertEqual(entry.listeners, [])

    def test_removing_the_entry_deletes_the_history(self):
        history = self.comp.recorder.get_history(self.hass)
        history.files.append("n", 1_700_000_000, ha_stubs.load(".history").Snapshot({("a", "b"): (1, None)}))
        self.assertTrue(history.files.folder.is_dir())
        ha_stubs.run(self.comp.async_remove_entry(self.hass, ha_stubs.FakeEntry()))
        self.assertFalse(history.files.folder.exists())


if __name__ == "__main__":
    unittest.main()
