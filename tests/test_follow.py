# SPDX-License-Identifier: MIT
"""Recording follows ZHA's topology scans: listener attach/remove, debounce, the 10-minute floor, the fallback timer,
the Thread timer, the info fields and the pending ZHA period read-back (stubbed Home Assistant and zigpy).
python3 -m unittest discover -s tests"""

import asyncio
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).parent))
import ha_stubs  # noqa: E402

FIXTURES = Path(__file__).parent / "fixtures"


class FakeTopology:
    """zigpy's Topology as far as the integration uses it: listeners, and events fired to them."""

    def __init__(self):
        self.listeners = []

    def add_listener(self, listener):
        self.listeners.append(listener)
        return len(self.listeners)

    def remove_listener(self, listener):
        self.listeners.remove(listener)

    def fire(self, name="neighbors_updated"):
        for listener in list(self.listeners):
            getattr(listener, name)("aa:bb:cc:dd:00:00:00:01", [])


class FollowTest(unittest.TestCase):
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
        self.hass = ha_stubs.FakeHass(components={"zha", "matter"}, config_dir=self.tmp.name)
        self.hass.zha_entries = [mock.Mock(entry_id="zha-entry")]
        self.comp = ha_stubs.load()
        self.recorder = ha_stubs.load(".recorder")
        self.topology = FakeTopology()
        self.app = types.SimpleNamespace(config={"topology_scan_period": 360, "topology_scan_enabled": True},
                                         topology=self.topology)
        self.patch(ha_stubs.load(".zha_scan"), "_application", return_value=self.app)
        self.patch(ha_stubs.load(".sources"), "read_routes", return_value={"radio": "x", "devices": []})
        zha = json.loads((FIXTURES / "zha-sample.json").read_text())["responses"]["zha/devices"]
        matter = json.loads((FIXTURES / "matter-sample.json").read_text())["responses"]["matter/network_topology"]
        self.hass.data["websocket_api"] = {"zha/devices": (self.handler(zha), None),
                                           "matter/network_topology": (self.handler(matter), None)}
        self.opts = ha_stubs.load(".options").get_options({})

    def patch(self, target, name, **kw):
        p = mock.patch.object(target, name, **kw)
        p.start()
        self.addCleanup(p.stop)

    @staticmethod
    def handler(answer):
        def handle(hass, connection, msg):
            asyncio.get_running_loop().call_soon(connection.send_result, msg["id"], answer)
        return handle

    def start(self, **options):
        stops = self.recorder.start_recording(self.hass, {**self.opts, **options})
        self.rec.started[0](self.hass)  # Home Assistant has started
        return stops

    def pending(self):
        return [t for t in self.rec.later if not t.cancelled and t.delay == self.recorder.DEBOUNCE]

    def history(self):
        return self.recorder.get_history(self.hass)

    def networks_on_disk(self):
        folder = self.history().files.folder
        return sorted({p.name.split(".")[0] for p in folder.iterdir()}) if folder.exists() else []

    def test_events_mode_attaches_one_listener_and_removes_it_on_stop(self):
        stops = self.start()
        self.assertEqual(len(self.topology.listeners), 1)
        self.assertEqual(self.history().follow_mode, "events")
        self.assertIsNone(self.history().last_error)
        for stop in stops:
            stop()
        self.assertEqual(self.topology.listeners, [])

    def test_unload_before_start_cancels_the_start_hook(self):
        stops = self.recorder.start_recording(self.hass, self.opts)
        for stop in stops:
            stop()
        self.assertEqual(self.topology.listeners, [])

    def test_events_are_debounced_and_stop_cancels_the_pending_record(self):
        stops = self.start()
        for name in ("neighbors_updated", "routes_updated", "neighbors_updated"):
            self.topology.fire(name)
        self.assertEqual(len(self.pending()), 1)  # each event replaced the timer: one is left
        self.assertEqual(self.pending()[0].delay, 60)
        self.assertEqual(self.networks_on_disk(), [])  # nothing recorded while events keep coming
        for stop in stops:
            stop()
        self.assertEqual(self.pending(), [])

    def test_quiet_debounce_records_and_the_floor_blocks_a_second_record(self):
        self.start()
        self.topology.fire()
        ha_stubs.run(self.pending()[0].action())
        self.assertIn("zha-entry", self.networks_on_disk())
        self.assertEqual(self.history().files.info()["records"], 2)  # ZHA and Thread
        self.topology.fire()  # a manual scan a moment later
        ha_stubs.run(self.pending()[0].action())
        self.assertEqual(self.history().files.info()["records"], 2)  # within 10 minutes: not recorded again
        for network in self.history().last_recorded:
            self.history().last_recorded[network] -= self.recorder.MIN_GAP
        self.topology.fire()
        ha_stubs.run(self.pending()[0].action())
        self.assertEqual(self.history().files.info()["records"], 4)

    def test_thread_timer_follows_zha_period_and_records_thread_only(self):
        self.start()
        interval, action = self.rec.intervals[0]
        self.assertEqual(interval.total_seconds(), 360 * 60)
        ha_stubs.run(action())
        self.assertEqual(self.networks_on_disk(), ["thread-aabbccddeeff0001"])
        self.assertEqual(self.rec.later[0].delay, 30)  # the first record after start

    def test_timer_fallback_when_the_listener_cannot_be_attached(self):
        self.app.topology = object()  # internals changed
        self.start()
        self.assertEqual(self.history().follow_mode, "timer")
        self.assertIn("recording on a timer", self.history().last_error)
        self.assertEqual(self.rec.intervals[0][0].total_seconds(), 360 * 60)
        ha_stubs.run(self.rec.intervals[0][1]())  # the timer records every network
        self.assertEqual(self.networks_on_disk(), ["thread-aabbccddeeff0001", "zha-entry"])

    def test_timer_when_zha_scans_are_off_or_zha_is_not_running(self):
        self.app.config["topology_scan_enabled"] = False
        self.start()
        self.assertEqual((self.history().follow_mode, self.history().last_error), ("timer", None))
        self.assertEqual(self.topology.listeners, [])
        self.rec.intervals.clear()
        gone = ha_stubs.load(".zigpy_routes").NotSupported("zha_not_loaded", "ZHA is not loaded")
        with mock.patch.object(ha_stubs.load(".zha_scan"), "_application", side_effect=gone):
            self.start()
        self.assertEqual(self.rec.intervals[0][0].total_seconds(), 240 * 60)  # ZHA's default

    def test_recording_off_only_prunes_and_attaches_nothing(self):
        self.start(record=False)
        self.assertEqual(self.topology.listeners, [])
        self.assertEqual([i[0].total_seconds() for i in self.rec.intervals], [6 * 3600])
        self.assertIsNone(self.history().follow_mode)

    def test_info_reports_zha_state_and_the_pending_period(self):
        self.start(record=True, keep_days=14)
        info = ha_stubs.run(self.recorder.async_info(self.hass))
        self.assertEqual((info["zha_scan_period"], info["zha_scan_enabled"], info["follow_mode"]), (360, True, "events"))
        self.assertEqual((info["record"], info["keep_days"], info["pending_zha_period"]), (True, 14, None))
        # a snippet was handed out for 240 min: ZHA still reports 360
        self.start(pending_zha_period=240)
        info = ha_stubs.run(self.recorder.async_info(self.hass))
        self.assertEqual(info["pending_zha_period"], 240)
        self.assertEqual(info["pending_note"], "ZHA still reports 360 min; the snippet for 240 min is not applied yet")
        # after the restart ZHA reports it: no longer pending
        self.app.config["topology_scan_period"] = 240
        info = ha_stubs.run(self.recorder.async_info(self.hass))
        self.assertEqual((info["pending_zha_period"], info["pending_note"]), (None, None))
        # ZHA gone
        gone = ha_stubs.load(".zigpy_routes").NotSupported("no_gateway", "x")
        with mock.patch.object(ha_stubs.load(".zha_scan"), "_application", side_effect=gone):
            info = ha_stubs.run(self.recorder.async_info(self.hass))
        self.assertEqual((info["zha_scan_period"], info["pending_zha_period"]), (None, 240))
        self.assertIn("ZHA is not running", info["pending_note"])

    def test_timer_logs_an_exception_once_per_change(self):
        self.start()
        action = self.rec.intervals[0][1]
        with mock.patch.object(self.recorder, "collect", side_effect=RuntimeError("boom")), \
                self.assertLogs(self.recorder._LOGGER, "ERROR") as logs:
            ha_stubs.run(action())
            ha_stubs.run(action())
        self.assertEqual(len(logs.records), 1)
        self.assertIn("RuntimeError: boom", self.history().last_error)


if __name__ == "__main__":
    unittest.main()
