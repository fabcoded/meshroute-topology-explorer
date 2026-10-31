# SPDX-License-Identifier: MIT
"""Setup, unload and reload of the integration against stubbed Home Assistant modules.  python3 -m unittest discover -s tests"""

import sys
import unittest
from unittest import mock

sys.path.insert(0, str(__import__("pathlib").Path(__file__).parent))
import ha_stubs  # noqa: E402


class SetupTest(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.dict(sys.modules)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.rec = ha_stubs.install()
        self.root = str(__import__("pathlib").Path(__file__).resolve().parent.parent)
        sys.path.insert(0, self.root)
        self.addCleanup(sys.path.remove, self.root)
        self.comp = ha_stubs.load()
        self.hass = ha_stubs.FakeHass()

    def test_first_setup_registers_everything(self):
        self.assertTrue(ha_stubs.run(self.comp.async_setup_entry(self.hass, None)))
        self.hass.http.async_register_static_paths.assert_awaited_once()
        self.assertEqual(len(self.rec.panels), 1)
        panel = self.rec.panels[0]
        self.assertEqual(panel["frontend_url_path"], "meshroute-topology")
        self.assertTrue(panel["require_admin"])
        self.assertEqual(panel["config"], {"version": ha_stubs.load(".const").VERSION})
        self.assertEqual(sorted(self.rec.commands), [
            "meshroute_topology_explorer/observations/get", "meshroute_topology_explorer/observations/set",
            "meshroute_topology_explorer/settings/get", "meshroute_topology_explorer/settings/set"])

    def test_panel_and_static_path_details(self):
        const = ha_stubs.load(".const")
        ha_stubs.run(self.comp.async_setup_entry(self.hass, None))
        url, path, cache = self.hass.http.async_register_static_paths.await_args.args[0][0]
        self.assertIn(const.VERSION, url)  # a new version is a new address, so caching is safe
        self.assertTrue(cache)
        self.assertTrue(path.endswith("frontend"))
        panel = self.rec.panels[0]
        self.assertEqual(panel["webcomponent_name"], "meshroute-topology-explorer")
        self.assertEqual(panel["module_url"], f"{url}/panel.js")

    def test_unload_removes_panel_only(self):
        ha_stubs.run(self.comp.async_setup_entry(self.hass, None))
        self.assertTrue(ha_stubs.run(self.comp.async_unload_entry(self.hass, None)))
        self.assertEqual(self.rec.removed, ["meshroute-topology"])

    def test_reload_registers_panel_again_but_static_path_and_commands_once(self):
        for _ in range(2):
            ha_stubs.run(self.comp.async_setup_entry(self.hass, None))
            ha_stubs.run(self.comp.async_unload_entry(self.hass, None))
        ha_stubs.run(self.comp.async_setup_entry(self.hass, None))
        self.assertEqual(self.hass.http.async_register_static_paths.await_count, 1)
        self.assertEqual(len(self.rec.panels), 3)
        self.assertEqual(len(self.rec.commands), 4)


if __name__ == "__main__":
    unittest.main()
