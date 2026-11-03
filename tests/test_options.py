# SPDX-License-Identifier: MIT
"""Options: validation (ranges, the under-3-hours confirmation), the options form (delete on submit, reload on save),
sidebar off, radio-actions flag in the panel config, removal deletes the history (stubbed Home Assistant).
python3 -m unittest discover -s tests"""

import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).parent))
import ha_stubs  # noqa: E402


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
    def check(self, previous=None, zha=240, **fields):
        return self.opt.validate_options(fields, previous, zha)

    def test_defaults_fill_missing_keys(self):
        stored, delete, errors = self.check()
        self.assertEqual(stored, {"sidebar": True, "radio_actions": True, "record": True, "keep_days": 30})
        self.assertFalse(delete)
        self.assertEqual(errors, {})
        self.assertNotIn("record_hours", stored)  # the own interval is gone: ZHA's scans trigger records

    def test_keep_days_range(self):
        for days in (0, 91, "30", False):
            self.assertEqual(self.check(keep_days=days)[2], {"keep_days": "days_range"}, repr(days))
        self.assertEqual(self.check(keep_days=90)[2], {})
        self.assertEqual(self.check(keep_days=1)[2], {})

    def test_zha_period_helper_rules(self):
        # unchanged or equal to the current period: nothing pending
        self.assertNotIn("pending_zha_period", self.check(zha_period=240)[0])
        self.assertEqual(self.check(zha_period=19)[2], {"zha_period": "zha_range"})
        self.assertEqual(self.check(zha_period=10081)[2], {"zha_period": "zha_range"})
        self.assertEqual(self.check(zha_period="60")[2], {"zha_period": "zha_range"})
        # under 180 needs the tick, 180 does not
        self.assertEqual(self.check(zha_period=60)[2], {"confirm_short": "zha_short"})
        self.assertEqual(self.check(zha_period=60, confirm_short=False)[2], {"confirm_short": "zha_short"})
        stored, _, errors = self.check(zha_period=60, confirm_short=True)
        self.assertEqual((errors, stored["pending_zha_period"]), ({}, 60))
        self.assertNotIn("confirm_short", stored)
        self.assertNotIn("zha_period", stored)  # form-only
        self.assertEqual(self.check(zha_period=180)[0]["pending_zha_period"], 180)
        self.assertEqual(self.check(zha_period=20, confirm_short=True)[0]["pending_zha_period"], 20)

    def test_zha_period_ignored_when_zha_cannot_be_read(self):
        stored, _, errors = self.check(zha=None, zha_period=5)
        self.assertEqual((errors, "pending_zha_period" in stored), ({}, False))

    def test_pending_period_is_kept_until_zha_reports_it(self):
        self.assertEqual(self.check({"pending_zha_period": 60})[0]["pending_zha_period"], 60)
        self.assertNotIn("pending_zha_period", self.check({"pending_zha_period": 60}, zha=60)[0])

    def test_delete_flag_is_not_stored(self):
        stored, delete, _ = self.check(delete_history=True)
        self.assertTrue(delete)
        self.assertNotIn("delete_history", stored)

    def test_get_options_out_of_range_falls_back(self):
        got = self.opt.get_options({"keep_days": 500, "pending_zha_period": 5})
        self.assertEqual((got["keep_days"], got["pending_zha_period"]), (30, None))

    def test_get_options_ignores_wrong_types(self):
        got = self.opt.get_options({"keep_days": True, "sidebar": "yes", "pending_zha_period": "60"})
        self.assertEqual((got["keep_days"], got["sidebar"], got["pending_zha_period"]), (30, True, None))


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

    def submit(self, flow, keep_days=30, period=None, confirm=None, delete=False, sidebar=True, radio=True):
        """period None: the field is left as prefilled (the current one); confirm None: the box was not on the form."""
        data = {"sidebar": sidebar, "radio_actions": radio,
                "history": {"record": True, "keep_days": keep_days, "delete_history": delete},
                "zha": {"zha_period": 240 if period is None else period}}
        if confirm is not None:
            data["zha"]["confirm_short"] = confirm
        return ha_stubs.run(flow.async_step_init(data))

    def test_form_shows_current_values_and_the_zha_line(self):
        result = ha_stubs.run(self.flow({"keep_days": 7}).async_step_init())
        self.assertEqual((result["type"], result["errors"]), ("form", {}))
        history = result["data_schema"]["history"][1][1]
        self.assertEqual(history["keep_days"][0].default, 7)
        self.assertNotIn("record_hours", history)
        self.assertEqual(result["data_schema"]["zha"][1][1]["zha_period"][0].default, 240)  # prefilled
        self.assertEqual(result["description_placeholders"]["zha_scan"], "ZHA scans every 240 min")
        self.assertNotIn("confirm_short", result["data_schema"]["zha"][1][1])

    def test_zha_line_and_no_field_for_off_unknown_and_unreadable(self):
        self.zha_patch.stop()
        self.set_zha(enabled=False)
        result = ha_stubs.run(self.flow().async_step_init())
        self.assertIn("scan is off", result["description_placeholders"]["zha_scan"])
        self.assertIn("topology_scan_enabled: true", result["description_placeholders"]["zha_scan"])
        self.assertNotIn("zha", result["data_schema"])  # no period field while ZHA scans nothing
        self.zha_patch.stop()
        app = types.SimpleNamespace(config={})  # no period in the config: unknown, never a made-up default
        with mock.patch.object(ha_stubs.load(".zha_scan"), "_application", return_value=app):
            result = ha_stubs.run(self.flow().async_step_init())
        self.assertEqual(result["description_placeholders"]["zha_scan"], "ZHA's scan period is unknown")
        self.assertNotIn("zha", result["data_schema"])
        reason = ha_stubs.load(".zigpy_routes").NotSupported("zha_not_loaded", "x")
        with mock.patch.object(ha_stubs.load(".zha_scan"), "_application", side_effect=reason):
            result = ha_stubs.run(self.flow().async_step_init())
        self.assertEqual(result["description_placeholders"]["zha_scan"], "ZHA's scan period is unknown")
        self.assertNotIn("zha", result["data_schema"])

    def test_the_field_defaults_to_the_pending_period_unless_zha_reports_it(self):
        field = lambda r: r["data_schema"]["zha"][1][1]["zha_period"][0].default  # noqa: E731
        self.assertEqual(field(ha_stubs.run(self.flow({"pending_zha_period": 360}).async_step_init())), 360)
        self.assertEqual(field(ha_stubs.run(self.flow({"pending_zha_period": 240}).async_step_init())), 240)  # applied

    def test_entering_the_current_value_clears_a_pending_period(self):
        result = self.submit(self.flow({"pending_zha_period": 360}), period=240)
        self.assertEqual(result["type"], "create_entry")
        self.assertNotIn("pending_zha_period", result["data"])

    def test_saving_other_options_does_not_touch_zha(self):
        result = self.submit(self.flow(), keep_days=10, sidebar=False, radio=False)
        self.assertEqual(result["type"], "create_entry")
        self.assertEqual(result["data"], {"sidebar": False, "radio_actions": False, "record": True, "keep_days": 10})

    def test_out_of_range_names_the_range(self):
        result = self.submit(self.flow(), keep_days=91)
        self.assertEqual(result["errors"], {"base": "days_range"})
        self.assertEqual(result["description_placeholders"]["days_range"], "1 to 90")
        result = self.submit(self.flow(), period=19)
        self.assertEqual(result["errors"], {"base": "zha_range"})
        self.assertEqual(result["description_placeholders"]["zha_range"], "20 to 10080")

    def test_short_period_needs_the_tick_and_the_box_appears_after_the_warning(self):
        flow = self.flow()
        result = self.submit(flow, period=60)
        self.assertEqual(result["errors"], {"base": "zha_short"})
        self.assertEqual(result["description_placeholders"]["minutes"], "60")
        self.assertIn("confirm_short", result["data_schema"]["zha"][1][1])
        self.assertEqual(result["data_schema"]["zha"][1][1]["zha_period"][0].default, 60)  # input kept
        self.assertEqual(self.submit(flow, period=60, confirm=False)["errors"], {"base": "zha_short"})
        self.assertEqual(self.submit(flow, period=60, confirm=True)["type"], "form")  # goes on to the snippet

    def test_changed_period_shows_the_snippet_then_saves_pending(self):
        flow = self.flow()
        step = self.submit(flow, period=360)
        self.assertEqual(step["step_id"], "snippet")
        self.assertEqual(step["description_placeholders"]["snippet"], "zha:\n  zigpy_config:\n    topology_scan_period: 360")
        done = ha_stubs.run(flow.async_step_snippet({}))
        self.assertEqual(done["type"], "create_entry")
        self.assertEqual(done["data"]["pending_zha_period"], 360)
        self.assertEqual(done["data"]["keep_days"], 30)

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
