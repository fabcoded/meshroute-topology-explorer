# SPDX-License-Identifier: MIT
"""meshroute_topology_explorer/zigpy_routes: zigpy's route records, read only, with fakes for ZHA and zigpy.

Cases: ZHA present, missing, without gateway, with changed internals; relays resolved, unknown, ambiguous; Green
Power devices; read-only access; no await; 300 devices in a few milliseconds. python3 -m unittest discover -s tests
"""

import pathlib
import sys
import time
import types
import unittest
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import ha_stubs  # noqa: E402

COMMAND = "meshroute_topology_explorer/zigpy_routes"


class NWK(int):
    """Like zigpy's NWK: an int subclass."""


class EUI64(bytes):
    """Like zigpy's EUI64: little-endian bytes shown in colon form, most significant first."""

    def __str__(self):
        return ":".join(f"{b:02x}" for b in self[::-1])


def eui(n):
    return EUI64(n.to_bytes(8, "little"))


class Touching:
    """Records every attribute read from outside, so the tests can prove what the command looks at."""

    def __getattribute__(self, name):
        if not name.startswith("_"):
            object.__getattribute__(self, "_touched").add(name)
        return object.__getattribute__(self, name)


class ZigbeeDevice(Touching):
    def __init__(self, n, nwk, relays=None):
        self._touched = set()
        self.ieee, self.nwk, self._relays = eui(n), NWK(nwk), relays

    @property
    def relays(self):
        return self._relays

    def request(self, *args, **kwargs):  # a call the command must never make
        raise AssertionError("radio traffic")


class GreenPowerDevice(Touching):
    """zigpy 2.4 keeps Green Power devices in the same dictionary; they have no relays."""

    def __init__(self, n):
        self._touched = set()
        self.ieee = eui(n)


class App(Touching):
    def __init__(self, devices):
        self._touched = set()
        self.devices = {d.ieee: d for d in devices}

    @property
    def state(self):  # holds the network settings in zigpy: never to be read
        raise AssertionError("state read")


App.__module__ = "zigpy_znp.zigbee.application"


def relays(*nwks):
    return [NWK(n) for n in nwks]


class ZigpyRoutesTest(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.dict(sys.modules)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.rec = ha_stubs.install()
        root = str(pathlib.Path(__file__).resolve().parent.parent)
        sys.path.insert(0, root)
        self.addCleanup(sys.path.remove, root)
        self.comp = ha_stubs.load()
        self.hass = ha_stubs.FakeHass(components={"zha"})
        ha_stubs.run(self.comp.async_setup_entry(self.hass, None))
        self.gateway = None
        self.gateway_error = ValueError("No gateway object exists")
        self.install_zha()
        self.n = 0

    def install_zha(self):
        """A fake homeassistant.components.zha.helpers whose get_zha_gateway behaves like core's (helpers.py)."""

        def get_zha_gateway(hass):
            if self.gateway is None:
                raise self.gateway_error
            return self.gateway

        zha = types.ModuleType("homeassistant.components.zha")
        helpers = types.ModuleType("homeassistant.components.zha.helpers")
        helpers.get_zha_gateway = get_zha_gateway
        zha.helpers = helpers
        sys.modules["homeassistant.components.zha"] = zha
        sys.modules["homeassistant.components.zha.helpers"] = helpers

    def with_app(self, devices):
        app = App(devices)
        self.gateway = types.SimpleNamespace(application_controller=app)
        return app

    def call(self, admin=True):
        """Run the command; returns (results, errors). Fails the test if the handler raises."""
        self.n += 1
        handler, schema = self.rec.commands[COMMAND]
        conn = ha_stubs.FakeConnection(admin=admin)
        ha_stubs.run(handler(self.hass, conn, schema({"id": self.n, "type": COMMAND})))
        return conn.results, conn.errors

    def reason(self):
        results, errors = self.call()
        self.assertEqual(results, [])
        self.assertEqual(errors[0][1], "not_supported")
        return errors[0][2].split(":")[0]

    # ---- present ------------------------------------------------------------------------------------------------

    def test_relays_with_their_devices(self):
        coordinator = ZigbeeDevice(1, 0x0000)
        a, b = ZigbeeDevice(2, 0x1111), ZigbeeDevice(3, 0x2222)
        far = ZigbeeDevice(4, 0x3333, relays(0x2222, 0x1111))
        direct = ZigbeeDevice(5, 0x4444, relays())
        unknown = ZigbeeDevice(6, 0x5555, relays(0x9999))
        self.with_app([coordinator, a, b, far, direct, unknown, GreenPowerDevice(7)])
        results, errors = self.call()
        self.assertEqual(errors, [])
        answer = results[0][1]
        self.assertEqual(answer["radio"], "zigpy_znp")
        by_ieee = {d["ieee"]: d for d in answer["devices"]}
        # Only devices with a record; a device without one (relays None) is left out.
        self.assertEqual(sorted(by_ieee), [str(eui(4)), str(eui(5)), str(eui(6))])
        self.assertEqual(by_ieee[str(eui(4))], {"ieee": "00:00:00:00:00:00:00:04", "nwk": 0x3333, "relays": [
            {"nwk": 0x2222, "ieee": "00:00:00:00:00:00:00:03"}, {"nwk": 0x1111, "ieee": "00:00:00:00:00:00:00:02"}]})
        self.assertEqual(by_ieee[str(eui(5))]["relays"], [])  # a route record without relays: one hop
        self.assertEqual(by_ieee[str(eui(6))]["relays"], [{"nwk": 0x9999, "ieee": None}])
        for d in answer["devices"]:  # plain ints, not zigpy types: the answer is JSON
            self.assertIs(type(d["nwk"]), int)
            self.assertTrue(all(type(r["nwk"]) is int for r in d["relays"]))

    def test_shared_address_is_not_named(self):
        self.with_app([ZigbeeDevice(1, 0), ZigbeeDevice(2, 0x1111), ZigbeeDevice(3, 0x1111),
                       ZigbeeDevice(4, 0x2222, relays(0x1111))])
        answer = self.call()[0][0][1]
        self.assertEqual(answer["devices"][0]["relays"], [{"nwk": 0x1111, "ieee": None}])

    def test_reads_only_addresses_and_relays(self):
        devices = [ZigbeeDevice(1, 0), ZigbeeDevice(2, 0x1111, relays(0x2222)), ZigbeeDevice(3, 0x2222), GreenPowerDevice(4)]
        app = self.with_app(devices)
        self.assertEqual(self.call()[1], [])
        self.assertEqual(app._touched, {"devices"})
        for d in devices:
            self.assertLessEqual(d._touched, {"ieee", "nwk", "relays"})

    def test_handler_never_waits(self):
        """The coroutine finishes on its first step: it awaits nothing, so it cannot wait for the radio."""
        self.with_app([ZigbeeDevice(1, 0), ZigbeeDevice(2, 0x1111, relays())])
        handler, schema = self.rec.commands[COMMAND]
        conn = ha_stubs.FakeConnection()
        coro = handler(self.hass, conn, schema({"id": 1, "type": COMMAND}))
        with self.assertRaises(StopIteration):
            coro.send(None)
        self.assertEqual(len(conn.results), 1)

    def test_300_devices_in_a_few_milliseconds(self):
        devices = [ZigbeeDevice(1, 0)] + [ZigbeeDevice(i, i, relays(*range(i % 5 + 1, i % 5 + 6))) for i in range(2, 302)]
        self.with_app(devices)
        best = float("inf")
        for _ in range(3):
            start = time.perf_counter()
            results, errors = self.call()
            best = min(best, time.perf_counter() - start)
        self.assertEqual(errors, [])
        self.assertEqual(len(results[0][1]["devices"]), 300)
        self.assertLess(best, 0.02, f"{best * 1000:.1f} ms for 300 devices")

    # ---- missing or changed ---------------------------------------------------------------------------------------

    def test_zha_not_loaded(self):
        self.hass.config.components.clear()
        self.assertEqual(self.reason(), "zha_not_loaded")

    def test_no_gateway(self):
        self.assertEqual(self.reason(), "no_gateway")

    def test_helper_moved(self):
        del sys.modules["homeassistant.components.zha.helpers"]
        sys.modules["homeassistant.components.zha"].helpers = None
        with mock.patch.dict(sys.modules, {"homeassistant.components.zha.helpers": None}):
            self.assertEqual(self.reason(), "internals_changed")

    def test_gateway_without_application(self):
        self.gateway = types.SimpleNamespace()
        self.assertEqual(self.reason(), "internals_changed")

    def test_devices_not_a_dictionary(self):
        self.gateway = types.SimpleNamespace(application_controller=types.SimpleNamespace(devices=[1, 2]))
        self.assertEqual(self.reason(), "internals_changed")

    def test_relays_attribute_renamed(self):
        dev = GreenPowerDevice(1)
        self.with_app([dev])
        self.assertEqual(self.reason(), "internals_changed")

    def test_relay_of_another_type(self):
        self.with_app([ZigbeeDevice(1, 0), ZigbeeDevice(2, 0x1111, ["0x2222"])])
        self.assertEqual(self.reason(), "internals_changed")
        self.with_app([ZigbeeDevice(1, 0), ZigbeeDevice(2, 0x1111, 5)])
        self.assertEqual(self.reason(), "internals_changed")
        self.with_app([ZigbeeDevice(1, 0), ZigbeeDevice(2, 0x1111, [0x10000])])
        self.assertEqual(self.reason(), "internals_changed")

    def test_unexpected_error_is_answered_not_raised(self):
        class Broken(dict):
            def values(self):
                raise RuntimeError("changed under us")

        self.gateway = types.SimpleNamespace(application_controller=types.SimpleNamespace(devices=Broken()))
        results, errors = self.call()
        self.assertEqual(results, [])
        self.assertEqual(errors[0][1:], ("not_supported", "error: RuntimeError"))

    def test_admin_only(self):
        self.with_app([ZigbeeDevice(1, 0)])
        self.assertEqual(self.call(admin=False)[1][0][1], "unauthorized")


if __name__ == "__main__":
    unittest.main()
