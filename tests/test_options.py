# SPDX-License-Identifier: MIT
"""Options: validation (ranges, the under-3-hours confirmation), the options form (delete on submit, reload on save),
sidebar off, radio-actions flag in the panel config, removal deletes the history (stubbed Home Assistant).
python3 -m unittest discover -s tests"""

import sys
import tempfile
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
    def check(self, **fields):
        return self.opt.validate_options(fields)

    def test_defaults_fill_missing_keys(self):
        stored, delete, errors = self.check()
        self.assertEqual(stored, {"sidebar": True, "radio_actions": True, "record": True, "record_hours": 3,
                                  "keep_days": 30})
        self.assertFalse(delete)
        self.assertEqual(errors, {})

    def test_ranges_are_refused(self):
        for hours in (0, 25, -1, 2.5, "3", True):
            self.assertEqual(self.check(record_hours=hours)[2], {"record_hours": "hours_range"}, repr(hours))
        for days in (0, 91, "30", False):
            self.assertEqual(self.check(keep_days=days)[2], {"keep_days": "days_range"}, repr(days))
        self.assertEqual(self.check(record_hours=24, keep_days=90)[2], {})
        self.assertEqual(self.check(record_hours=3, keep_days=1)[2], {})

    def test_interval_under_three_hours_needs_the_tick(self):
        self.assertEqual(self.check(record_hours=1)[2], {"confirm_short": "hours_short"})
        self.assertEqual(self.check(record_hours=2, confirm_short=False)[2], {"confirm_short": "hours_short"})
        stored, _, errors = self.check(record_hours=1, confirm_short=True)
        self.assertEqual(errors, {})
        self.assertEqual(stored["record_hours"], 1)
        self.assertNotIn("confirm_short", stored)  # form-only, never stored
        self.assertEqual(self.check(record_hours=3)[2], {})  # exactly 3 h needs no tick

    def test_delete_flag_is_not_stored(self):
        stored, delete, _ = self.check(delete_history=True)
        self.assertTrue(delete)
        self.assertNotIn("delete_history", stored)

    def test_get_options_ignores_wrong_types(self):
        got = self.opt.get_options({"record_hours": True, "sidebar": "yes", "keep_days": 7})
        self.assertEqual((got["record_hours"], got["sidebar"], got["keep_days"]), (3, True, 7))


class FlowTest(Base):
    def flow(self, options=None):
        cf = ha_stubs.load(".config_flow")
        flow = cf.MeshrouteOptionsFlow()
        flow.hass = self.hass
        flow.config_entry = ha_stubs.FakeEntry(options)
        return flow

    def submit(self, flow, record_hours=3, keep_days=30, confirm=None, delete=False, sidebar=True, radio=True):
        """confirm None: the box was not on the form (the first one), so the key is absent."""
        history = {"record": True, "record_hours": record_hours, "keep_days": keep_days, "delete_history": delete}
        if confirm is not None:
            history["confirm_short"] = confirm
        return ha_stubs.run(flow.async_step_init({"sidebar": sidebar, "radio_actions": radio, "history": history}))

    def test_form_shows_current_values_as_defaults(self):
        result = ha_stubs.run(self.flow({"keep_days": 7}).async_step_init())
        self.assertEqual(result["type"], "form")
        self.assertEqual(result["errors"], {})
        history = result["data_schema"]["history"][1][1]
        self.assertEqual(history["keep_days"][0].default, 7)

    def test_confirm_box_appears_only_after_the_warning(self):
        flow = self.flow()
        first = ha_stubs.run(flow.async_step_init())
        self.assertNotIn("confirm_short", first["data_schema"]["history"][1][1])
        again = self.submit(flow, record_hours=1)  # the first form had no box: submitted without it
        self.assertIn("confirm_short", again["data_schema"]["history"][1][1])
        self.assertEqual(again["data_schema"]["history"][1][1]["record_hours"][0].default, 1)  # input kept

    def test_short_interval_without_tick_saves_nothing(self):
        result = self.submit(self.flow(), record_hours=1)
        self.assertEqual(result["type"], "form")
        self.assertEqual(result["errors"], {"confirm_short": "hours_short"})
        self.assertEqual(result["description_placeholders"]["hours"], "1")
        self.assertEqual(self.submit(self.flow(), record_hours=1, confirm=False)["errors"], {"confirm_short": "hours_short"})
        self.assertEqual(self.submit(self.flow(), record_hours=1, confirm=True)["data"]["record_hours"], 1)

    def test_out_of_range_names_the_range(self):
        result = self.submit(self.flow(), keep_days=91)
        self.assertEqual(result["errors"], {"keep_days": "days_range"})
        self.assertEqual(result["description_placeholders"]["days_range"], "1 to 90")

    def test_save_stores_flat_options_without_form_only_fields(self):
        result = self.submit(self.flow(), record_hours=6, keep_days=10, sidebar=False, radio=False)
        self.assertEqual(result["type"], "create_entry")
        self.assertEqual(result["data"], {"sidebar": False, "radio_actions": False, "record": True,
                                          "record_hours": 6, "keep_days": 10})

    def test_delete_acts_on_submit_only_when_valid(self):
        history = self.comp.recorder.get_history(self.hass)
        history.files.append("n", 1_700_000_000, ha_stubs.load(".history").Snapshot({("a", "b"): (1, None)}))
        self.assertEqual(history.files.info()["records"], 1)
        self.submit(self.flow(), record_hours=1, delete=True)  # refused: nothing deleted
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

    def test_update_listener_reloads_the_entry_only(self):
        entry = self.setup()
        ha_stubs.run(entry.listeners[0](self.hass, entry))
        self.hass.config_entries.async_reload.assert_awaited_once_with("entry1")
        entry.unload()
        self.assertEqual(entry.listeners, [])

    def test_timers_follow_the_options(self):
        self.setup({"record_hours": 5, "record": True})
        self.assertEqual(self.rec.later[0][0], 60)
        self.assertEqual(self.rec.intervals[0][0].total_seconds(), 5 * 3600)
        self.rec.intervals.clear()
        self.setup({"record": False})  # off: prune-only timer
        self.assertEqual(self.rec.intervals[0][0].total_seconds(), 6 * 3600)

    def test_removing_the_entry_deletes_the_history(self):
        history = self.comp.recorder.get_history(self.hass)
        history.files.append("n", 1_700_000_000, ha_stubs.load(".history").Snapshot({("a", "b"): (1, None)}))
        self.assertTrue(history.files.folder.is_dir())
        ha_stubs.run(self.comp.async_remove_entry(self.hass, ha_stubs.FakeEntry()))
        self.assertFalse(history.files.folder.exists())


if __name__ == "__main__":
    unittest.main()
