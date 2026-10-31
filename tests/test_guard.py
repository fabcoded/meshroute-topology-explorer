# SPDX-License-Identifier: MIT
"""Tests for tools/guard.py: deny-list, outside URLs in shipped files, SPDX lines.  python3 -m unittest discover -s tests"""

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
import guard  # noqa: E402

SPDX = "// SPDX-License-Identifier: MIT\n"


class GuardTest(unittest.TestCase):
    def tree(self, files: dict[str, str]) -> Path:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = Path(tmp.name)
        for rel, text in files.items():
            (root / rel).parent.mkdir(parents=True, exist_ok=True)
            (root / rel).write_text(text, encoding="utf-8")
        return root

    def test_clean_tree_passes(self):
        root = self.tree({"custom_components/x/panel.js": SPDX + "hass.callWS({ type: 'zha/devices' })\n"})
        self.assertEqual(guard.check(root), [])

    def test_secret_command_is_flagged(self):
        root = self.tree({"custom_components/x/panel.js": SPDX + "hass.callWS({ type: 'otbr/info' })\n"})
        self.assertIn("otbr/", guard.check(root)[0])  # the whole otbr/ namespace is out: otbr/info returns the key

    def test_outside_url_only_in_shipped_files(self):
        root = self.tree({
            "custom_components/x/panel.js": SPDX + "fetch('https://cdn.example.net/lib.js')\n",
            "tools/helper.py": "# SPDX-License-Identifier: MIT\n# see https://contributors.home-assistant.io\n",
        })
        findings = guard.check(root)
        self.assertEqual(len(findings), 1)
        self.assertIn("outside URL", findings[0])

    def test_spdx_required_except_vendor(self):
        root = self.tree({"tools/a.py": "print(1)\n", "custom_components/x/vendor/lit-core.min.js": "/* BSD */\n"})
        self.assertEqual(guard.check(root), ["tools/a.py:1: missing SPDX-License-Identifier in the first three lines"])

    def test_more_url_forms_and_text_files(self):
        root = self.tree({
            "custom_components/x/panel.js": SPDX + "const a = 'wss://relay.example.org/ws'\nconst b = '//cdn.example.net/x.js'\n// a comment\n",
            "custom_components/x/style.css": "@import url(https://fonts.example.com/a.css);\n",
            "custom_components/x/manifest.json": '{"documentation": "https://github.com/fabcoded/meshroute-topology-explorer"}\n',
        })
        found = guard.check(root)
        self.assertEqual(len(found), 3, found)

    def test_allow_list_has_a_hard_boundary(self):
        root = self.tree({"custom_components/x/p.js": SPDX + "u = 'https://github.com/fabcoded/meshroute-topology-explorer-evil/x'\n"})
        self.assertEqual(len(guard.check(root)), 1)

    def test_write_commands_and_key_helpers_are_flagged(self):
        root = self.tree({
            "custom_components/x/p.js": SPDX + "hass.callWS({ type: 'zha/devices/permit' })\n",
            "custom_components/x/__init__.py": "# SPDX-License-Identifier: MIT\nkey = state.network_key\n",
        })
        self.assertEqual(len(guard.check(root)), 2)

    def test_command_allow_list(self):
        root = self.tree({
            "custom_components/x/ok.js": SPDX + "a({ type: 'zha/devices' }); b({ type: \"meshroute_topology_explorer/settings/get\" })\n"
            "c({ type: 'text/css' }); d({ type: 'module' })\n",
            "custom_components/x/bad.js": SPDX + "hass.callWS({ type: 'light/turn_on' })\n",
            "custom_components/x/bad.py": "# SPDX-License-Identifier: MIT\nmsg = {'type': 'zha/devices/bind'}\n",
            "tools/other.py": "# SPDX-License-Identifier: MIT\nmsg = {'type': 'light/turn_on'}\n",
        })
        found = guard.check(root)
        self.assertEqual(len(found), 2, found)
        self.assertTrue(all("allow-list" in f or "changes the network" in f for f in found), found)
        self.assertTrue(any("light/turn_on" in f for f in found))

    def test_virtualenv_is_skipped(self):
        root = self.tree({".venv/lib/x.py": "print(1)\n"})
        self.assertEqual(guard.check(root), [])

    def test_repository_itself_is_clean(self):
        self.assertEqual(guard.check(Path(__file__).resolve().parent.parent), [])


if __name__ == "__main__":
    unittest.main()
