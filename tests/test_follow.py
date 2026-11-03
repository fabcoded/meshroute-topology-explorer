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


class FakeTask:
    """An asyncio task as far as the integration looks at it: done() and done callbacks."""

    def __init__(self, done=False):
        self._done, self.callbacks = done, []

    def done(self):
        return self._done

    def add_done_callback(self, fn):
        self.callbacks.append(fn)

    def remove_done_callback(self, fn):
        self.callbacks.remove(fn)

    def finish(self):
        self._done = True
        for fn in list(self.callbacks):
            fn(self)


class FakeTopology:
    """zigpy's Topology as far as the integration uses it: listeners, events, and the scan task."""

    def __init__(self, task=None):
        self.listeners = []
        self._scan_task = task

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
        # keep_days far out: the fixtures are dated early 2026 and expiry runs with every record
        self.recording = self.recorder.Recording(self.hass, {**self.opts, "keep_days": 100000, **options})
        stop = self.recording.start()
        self.clock = [1000.0]
        self.history().clock = lambda: self.clock[0]
        self.rec.started[-1](self.hass)  # Home Assistant has started
        return [stop]

    def pending(self):
        return [t for t in self.rec.later if not t.cancelled and t.delay != 30]

    def history(self):
        return self.recorder.get_history(self.hass)

    def networks_on_disk(self):
        folder = self.history().files.folder
        return sorted({p.name.split(".")[0] for p in folder.iterdir()}) if folder.exists() else []

    def quiet(self):
        """Let the newest quiet timer fire (a fired timer is gone)."""
        timer = self.pending()[-1]
        timer.cancelled = True
        ha_stubs.run(timer.action())

    def test_events_mode_attaches_one_listener_and_removes_it_on_stop(self):
        stops = self.start()
        self.assertEqual(len(self.topology.listeners), 1)
        self.assertEqual(self.history().follow_mode, "events")
        self.assertIsNone(self.history().follow_note)
        self.assertEqual(len(self.rec.signals), 1)  # the ZHA reload hook
        for stop in stops:
            stop()
        self.assertEqual(self.topology.listeners, [])
        self.assertEqual((self.rec.signals, self.recording.topology), ([], None))  # nothing of ZHA is kept alive

    def test_unload_before_start_cancels_the_start_hook(self):
        recording = self.recorder.Recording(self.hass, self.opts)
        recording.start()()
        self.assertEqual(self.topology.listeners, [])

    def test_events_are_debounced_and_stop_cancels_the_pending_record(self):
        stops = self.start()
        for name in ("neighbors_updated", "routes_updated", "neighbors_updated"):
            self.topology.fire(name)
        self.assertEqual([t.delay for t in self.pending()], [60])  # each event replaced the timer: one is left
        self.assertEqual(self.networks_on_disk(), [])  # nothing recorded while events keep coming
        for stop in stops:
            stop()
        self.assertEqual(self.pending(), [])

    def test_a_topology_without_a_scan_task_uses_the_longer_quiet_and_says_unknown(self):
        del self.topology._scan_task
        self.start()
        self.topology.fire()
        self.assertEqual([t.delay for t in self.pending()], [300])
        self.assertEqual(ha_stubs.run(self.recorder.async_info(self.hass))["scan_state"], "unknown")

    def test_a_running_scan_is_never_read_and_its_end_dates_the_record(self):
        task = FakeTask()
        self.topology._scan_task = task
        self.start()
        self.topology.fire()
        self.quiet()  # quiet for 60 s, but the scan task has not ended
        self.assertEqual(self.networks_on_disk(), [])
        self.assertEqual(len(task.callbacks), 1)
        self.topology.fire()
        self.quiet()  # more events and another quiet period: still one callback on the task
        self.assertEqual(len(task.callbacks), 1)
        with mock.patch.object(self.recorder.time, "time", return_value=1_800_000_000.0):
            task.finish()  # the scan ends: the quiet period starts again
        self.assertEqual(self.networks_on_disk(), [])
        self.quiet()
        self.assertIn("zha-entry", self.networks_on_disk())
        times = self.history().files.series("zha-entry", "aa:bb:cc:dd:00:00:00:01", "aa:bb:cc:dd:00:00:00:08", 0)
        self.assertEqual(self.history().last_time["zha-entry"], 1_800_000_000.0)  # the scan's end, not the read
        self.assertIsInstance(times, list)

    def test_a_scan_started_during_the_read_drops_the_zigbee_result(self):
        self.start()
        task = FakeTask(done=True)
        self.topology._scan_task = task

        def handle(hass, connection, msg):
            task._done = False  # a scan begins while zha/devices is being answered
            asyncio.get_running_loop().call_soon(connection.send_result, msg["id"], [])

        self.hass.data["websocket_api"]["zha/devices"] = (handle, None)
        self.topology.fire()
        self.quiet()
        self.assertNotIn("zha-entry", self.networks_on_disk())

    def test_the_floor_postpones_instead_of_dropping(self):
        self.start()
        self.topology.fire()
        self.quiet()
        self.assertIn("zha-entry", self.networks_on_disk())
        self.assertEqual(self.history().files.info()["records"], 1)
        self.clock[0] += 100  # a manual scan 100 s later
        self.topology.fire()
        self.quiet()
        self.assertEqual(self.history().files.info()["records"], 1)
        self.assertEqual(round(self.pending()[-1].delay), 500)  # last + 600 s
        self.clock[0] += 500
        self.history().last_time["zha-entry"] -= 1  # (the fixture's tables are unchanged: only the date matters)
        self.quiet()
        self.assertEqual(self.history().files.info()["records"], 2)  # recorded, as a time-only line

    def test_a_scan_that_never_ends_gives_up_after_two_periods(self):
        task = FakeTask()
        self.topology._scan_task = task
        self.start()
        self.topology.fire()
        self.clock[0] += 2 * 360 * 60 + 1
        self.quiet()
        self.assertIn("did not end in time", self.history().last_error)
        self.assertEqual(self.networks_on_disk(), [])
        self.topology.fire()  # still listening
        self.assertEqual(len(self.pending()), 1)

    def test_a_zha_reload_moves_the_listener_to_the_new_topology(self):
        self.start()
        old, new = self.topology, FakeTopology()
        self.app.topology = new
        self.rec.signals[0]("updated", types.SimpleNamespace(domain="zha"))
        self.assertEqual((old.listeners, len(new.listeners)), ([], 1))
        self.rec.signals[0]("updated", types.SimpleNamespace(domain="other"))
        third = FakeTopology()
        self.app.topology = third  # also noticed by the next tick
        ha_stubs.run(self.rec.intervals[0][1]())
        self.assertEqual((new.listeners, len(third.listeners)), ([], 1))

    def test_zha_loading_after_the_start_upgrades_timer_to_events(self):
        gone = ha_stubs.load(".zigpy_routes").NotSupported("no_gateway", "ZHA has no running gateway")
        with mock.patch.object(ha_stubs.load(".zha_scan"), "_application", side_effect=gone):
            self.start()
            self.assertEqual(self.history().follow_mode, "timer")
        self.rec.signals[0]("updated", types.SimpleNamespace(domain="zha"))
        self.assertEqual(self.history().follow_mode, "events")
        self.assertEqual(len(self.topology.listeners), 1)

    def test_no_zigbee_read_at_start_in_events_mode_and_thread_is_dated_by_the_server(self):
        self.start()
        self.assertEqual(self.rec.later[0].delay, 30)
        ha_stubs.run(self.rec.later[0].action())
        self.assertEqual(self.networks_on_disk(), ["thread-aabbccddeeff0001"])
        self.assertEqual(self.history().last_time["thread-aabbccddeeff0001"], 1767268800.0)
        self.clock[0] += 5000
        ha_stubs.run(self.rec.intervals[0][1]())  # the same snapshot again: not newer, not written
        self.assertEqual(self.history().files.info()["records"], 1)

    def test_thread_timer_does_not_read_zha(self):
        calls = []
        zha = self.hass.data["websocket_api"]["zha/devices"]
        self.hass.data["websocket_api"]["zha/devices"] = (lambda *a: calls.append(a), zha[1])
        self.start()
        ha_stubs.run(self.rec.intervals[0][1]())
        self.assertEqual(calls, [])
        self.assertEqual(self.rec.intervals[0][0].total_seconds(), 360 * 60)

    def test_timer_fallback_when_the_listener_cannot_be_attached(self):
        self.app.topology = object()  # internals changed
        self.start()
        self.assertEqual(self.history().follow_mode, "timer")
        info = ha_stubs.run(self.recorder.async_info(self.hass))
        self.assertIn("recording on a timer", info["last_error"])
        self.assertEqual(self.rec.intervals[0][0].total_seconds(), 360 * 60)
        ha_stubs.run(self.rec.intervals[0][1]())  # the timer records every network, Zigbee dated with the read
        self.assertEqual(self.networks_on_disk(), ["thread-aabbccddeeff0001", "zha-entry"])

    def test_the_fallback_timer_does_not_read_zigbee_during_a_scan(self):
        self.topology._scan_task = FakeTask()
        self.app.config["topology_scan_enabled"] = False  # ZHA says off, yet a task runs: still guarded
        self.start()
        self.assertEqual(self.history().follow_mode, "timer")
        ha_stubs.run(self.rec.intervals[0][1]())
        self.assertEqual(self.networks_on_disk(), ["thread-aabbccddeeff0001"])

    def test_timer_when_zha_scans_are_off_or_zha_is_not_running(self):
        self.app.config["topology_scan_enabled"] = False
        self.start()
        self.assertEqual((self.history().follow_mode, self.history().follow_note), ("timer", None))
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
        self.assertEqual((info["zha_scan_period"], info["zha_scan_enabled"], info["follow_mode"], info["scan_state"]),
                         (360, True, "events", "idle"))
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
        self.assertIsNone(info["pending_note"])

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
