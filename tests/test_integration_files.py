# SPDX-License-Identifier: MIT
"""Consistency of the integration files: versions, translations, HACS metadata, brand icon.  python3 -m unittest discover -s tests"""

import json
import re
import struct
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COMP = ROOT / "custom_components" / "meshroute_topology_explorer"


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def const_version() -> str:
    return re.search(r'^VERSION = "([^"]+)"', (COMP / "const.py").read_text(), re.M).group(1)


class IntegrationFilesTest(unittest.TestCase):
    def test_versions_agree(self):
        panel = re.search(r'const VERSION = "([^"]+)"', (COMP / "frontend" / "panel.js").read_text()).group(1)
        self.assertEqual(load(COMP / "manifest.json")["version"], const_version())
        self.assertEqual(panel, const_version())

    def test_manifest_fields(self):
        m = load(COMP / "manifest.json")
        self.assertEqual(m["domain"], COMP.name)
        self.assertEqual(m["name"], "Meshroute Topology Explorer")
        self.assertEqual(m["dependencies"], ["frontend", "http", "panel_custom"])
        # zigpy_routes.py imports the ZHA helpers, so hassfest requires ZHA to be declared.
        # after_dependencies, not dependencies: the integration must also load without ZHA (Thread only).
        self.assertEqual(m.get("after_dependencies"), ["zha"])
        self.assertNotIn("zha", m["dependencies"])
        self.assertEqual(m["iot_class"], "calculated")
        self.assertEqual(m["requirements"], [])
        self.assertTrue(m["config_flow"] and m["single_config_entry"])
        self.assertIn("github.com/fabcoded/meshroute-topology-explorer", m["documentation"])

    def test_manifest_key_order_and_required_fields(self):
        # hassfest wants domain and name first, the rest alphabetical; custom integrations also need these keys.
        keys = list(load(COMP / "manifest.json"))
        self.assertEqual(keys[:2], ["domain", "name"])
        self.assertEqual(keys[2:], sorted(keys[2:]))
        for required in ("version", "documentation", "issue_tracker", "codeowners"):
            self.assertIn(required, keys)

    def test_translations_are_english_and_name_every_option_and_error(self):
        """English only (owner decision 2026-11-02). Every form field and error code of the options flow has a text."""
        folder = COMP / "translations"
        self.assertEqual([p.name for p in folder.iterdir()], ["en.json"])
        en = load(folder / "en.json")
        self.assertIn("title", en["config"]["step"]["user"])
        init = en["options"]["step"]["init"]
        self.assertEqual(set(init["data"]), {"sidebar"})
        self.assertEqual(set(init["sections"]["history"]["data"]), {"record", "keep_days", "delete_history"})
        self.assertEqual(set(init["sections"]["zha"]["data"]), {"radio_actions", "scan_after_start"})  # #15
        self.assertIn("topology_scan_period", init["sections"]["zha"]["description"])
        self.assertEqual(set(en["options"]["error"]), {"days_range"})

    def test_hacs_json(self):
        h = load(ROOT / "hacs.json")
        self.assertEqual(h["name"], "Meshroute Topology Explorer")
        self.assertIn("homeassistant", h)

    def test_brand_icon_is_256_png(self):
        data = (COMP / "brand" / "icon.png").read_bytes()
        self.assertEqual(data[:8], b"\x89PNG\r\n\x1a\n")
        self.assertEqual(struct.unpack(">II", data[16:24]), (256, 256))

    def test_python_files_parse(self):
        for path in COMP.glob("*.py"):
            compile(path.read_text(), str(path), "exec")


if __name__ == "__main__":
    unittest.main()
