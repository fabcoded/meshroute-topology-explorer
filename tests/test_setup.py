# SPDX-License-Identifier: MIT
"""Setup, unload and reload against stubbed Home Assistant modules, and the content hash in the panel URL.  python3 -m unittest discover -s tests"""

import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).parent))
import ha_stubs  # noqa: E402


class SetupTest(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.dict(sys.modules)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.rec = ha_stubs.install()
        self.root = str(Path(__file__).resolve().parent.parent)
        sys.path.insert(0, self.root)
        self.addCleanup(sys.path.remove, self.root)
        self.comp = ha_stubs.load()
        self.hass = ha_stubs.FakeHass()
        self.entry = ha_stubs.FakeEntry()

    def test_first_setup_registers_everything(self):
        self.assertTrue(ha_stubs.run(self.comp.async_setup_entry(self.hass, self.entry)))
        self.hass.http.async_register_static_paths.assert_awaited_once()
        self.assertEqual(len(self.rec.panels), 1)
        panel = self.rec.panels[0]
        self.assertEqual(panel["frontend_url_path"], "meshroute-topology")
        self.assertTrue(panel["require_admin"])
        self.assertEqual(panel["config"], {"version": ha_stubs.load(".const").VERSION, "radio_actions": True})
        self.assertEqual(sorted(self.rec.commands), [
            "meshroute_topology_explorer/history/info", "meshroute_topology_explorer/history/records", "meshroute_topology_explorer/history/series",
            "meshroute_topology_explorer/observations/get", "meshroute_topology_explorer/observations/set",
            "meshroute_topology_explorer/settings/get", "meshroute_topology_explorer/settings/set",
            "meshroute_topology_explorer/zigpy_routes"])

    def test_panel_and_static_path_details(self):
        ha_stubs.run(self.comp.async_setup_entry(self.hass, self.entry))
        url, path, cache = self.hass.http.async_register_static_paths.await_args.args[0][0]
        # the content hash of the frontend folder is the last path segment, so caching is safe
        self.assertEqual(url, "/meshroute_topology_explorer/" + self.comp.frontend_hash(Path(path)))
        self.assertTrue(cache)
        self.assertTrue(path.endswith("frontend"))
        panel = self.rec.panels[0]
        self.assertEqual(panel["webcomponent_name"], "meshroute-topology-explorer")
        self.assertEqual(panel["module_url"], f"{url}/panel.js")

    def test_unload_removes_panel_only(self):
        ha_stubs.run(self.comp.async_setup_entry(self.hass, self.entry))
        self.assertTrue(ha_stubs.run(self.comp.async_unload_entry(self.hass, self.entry)))
        self.assertEqual(self.rec.removed, ["meshroute-topology"])

    def test_reload_registers_panel_again_but_static_path_and_commands_once(self):
        for _ in range(2):
            ha_stubs.run(self.comp.async_setup_entry(self.hass, self.entry))
            ha_stubs.run(self.comp.async_unload_entry(self.hass, self.entry))
        ha_stubs.run(self.comp.async_setup_entry(self.hass, self.entry))
        self.assertEqual(self.hass.http.async_register_static_paths.await_count, 1)
        self.assertEqual(len(self.rec.panels), 3)
        self.assertEqual(len(self.rec.commands), 8)

    def test_reload_after_changed_panel_files_serves_a_new_path_once(self):
        """Ships a frontend update without a restart: new hash, new static path, panel under the new URL."""
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            write_files(folder, {"panel.js": "export {};\n", "ui/style.js": "a\n"})
            with mock.patch.object(self.comp, "FRONTEND_DIR", folder):
                ha_stubs.run(self.comp.async_setup_entry(self.hass, self.entry))
                ha_stubs.run(self.comp.async_unload_entry(self.hass, self.entry))
                write_files(folder, {"ui/style.js": "b\n"})
                ha_stubs.run(self.comp.async_setup_entry(self.hass, self.entry))
                ha_stubs.run(self.comp.async_unload_entry(self.hass, self.entry))
                ha_stubs.run(self.comp.async_setup_entry(self.hass, self.entry))  # unchanged: no third path
        calls = self.hass.http.async_register_static_paths.await_args_list
        urls = [call.args[0][0][0] for call in calls]
        self.assertEqual(len(urls), 2)
        self.assertNotEqual(urls[0], urls[1])
        self.assertTrue(all(call.args[0][0][1] == str(folder) for call in calls))
        self.assertEqual([p["module_url"] for p in self.rec.panels],
                         [f"{urls[0]}/panel.js", f"{urls[1]}/panel.js", f"{urls[1]}/panel.js"])


def write_files(folder: Path, files: dict[str, str]) -> None:
    for rel, text in files.items():
        (folder / rel).parent.mkdir(parents=True, exist_ok=True)
        (folder / rel).write_text(text, encoding="utf-8")


class FrontendHashTest(unittest.TestCase):
    """The hash in the panel URL: same files, same hash; any change to a path or its bytes, another hash."""

    def setUp(self):
        patcher = mock.patch.dict(sys.modules)
        patcher.start()
        self.addCleanup(patcher.stop)
        ha_stubs.install()
        root = str(Path(__file__).resolve().parent.parent)
        sys.path.insert(0, root)
        self.addCleanup(sys.path.remove, root)
        self.frontend_hash = ha_stubs.load().frontend_hash

    def hash_of(self, files: dict[str, str]) -> str:
        with tempfile.TemporaryDirectory() as tmp:
            write_files(Path(tmp), files)
            return self.frontend_hash(Path(tmp))

    def test_same_content_same_hash_whatever_the_write_order(self):
        files = {"panel.js": "import './ui/a.js';\n", "ui/a.js": "export const a = 1;\n", "ui/b.js": ""}
        first = self.hash_of(files)
        self.assertRegex(first, r"^[0-9a-f]{12}$")
        self.assertEqual(self.hash_of(dict(reversed(list(files.items())))), first)

    def test_any_change_gives_another_hash(self):
        base = {"panel.js": "x\n", "ui/a.js": "a\n"}
        variants = {
            "content changed": {**base, "ui/a.js": "b\n"},
            "file added": {**base, "ui/new.js": ""},
            "file removed": {"panel.js": "x\n"},
            "file renamed": {"panel.js": "x\n", "ui/c.js": "a\n"},
            "bytes moved from path to content": {"panel.js": "x\n", "ui/a.j": "sa\n"},
        }
        seen = {self.hash_of(base)}
        for name, files in variants.items():
            with self.subTest(name):
                digest = self.hash_of(files)
                self.assertNotIn(digest, seen)
                seen.add(digest)


if __name__ == "__main__":
    unittest.main()
