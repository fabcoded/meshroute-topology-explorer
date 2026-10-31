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
        self.assertEqual(m["after_dependencies"], ["zha"])
        self.assertEqual(m["requirements"], [])
        self.assertTrue(m["config_flow"] and m["single_config_entry"])
        self.assertIn("github.com/fabcoded/meshroute-topology-explorer", m["documentation"])

    def test_translations_have_same_keys(self):
        def keys(d, prefix=""):
            return {f"{prefix}{k}" for k, v in d.items() if not isinstance(v, dict)} | {
                key for k, v in d.items() if isinstance(v, dict) for key in keys(v, f"{prefix}{k}.")}
        en, de = (keys(load(COMP / "translations" / f"{x}.json")) for x in ("en", "de"))
        self.assertEqual(en, de)
        self.assertIn("config.step.user.title", en)

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
