# SPDX-License-Identifier: MIT
"""Contract between panel and backend: every command of the integration's own namespace that the panel's code names
is one the backend registers; the storage clients use both commands of settings and observations (spec 6, 10, 11).
python3 -m unittest discover -s tests"""

import pathlib
import re
import sys
import unittest
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import ha_stubs

ROOT = pathlib.Path(__file__).resolve().parent.parent
FRONTEND = ROOT / "custom_components" / "meshroute_topology_explorer" / "frontend"
OWN = re.compile(r"""["'`](meshroute_topology_explorer/[A-Za-z0-9_/]+)["'`]""")


def panel_commands() -> dict[str, set[str]]:
    """Own-namespace command literals per frontend file (relative path -> commands)."""
    found = {}
    for path in sorted(FRONTEND.rglob("*.js")):
        names = set(OWN.findall(path.read_text(encoding="utf-8")))
        if names:
            found[path.relative_to(FRONTEND).as_posix()] = names
    return found


class PanelContractTest(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.dict(sys.modules)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.rec = ha_stubs.install()
        sys.path.insert(0, str(ROOT))
        self.addCleanup(sys.path.remove, str(ROOT))
        comp = ha_stubs.load()
        ha_stubs.run(comp.async_setup_entry(ha_stubs.FakeHass(), ha_stubs.FakeEntry()))
        self.registered = set(self.rec.commands)

    def test_panel_names_only_registered_commands(self):
        used = panel_commands()
        self.assertTrue(used, "the panel names its own commands somewhere")
        for path, names in used.items():
            self.assertLessEqual(names, self.registered, f"{path} names a command the backend does not register")

    def test_storage_clients_use_get_and_set_of_both_kinds(self):
        self.assertEqual(panel_commands().get("ui/store-client.js"),
                         {f"meshroute_topology_explorer/{kind}/{verb}" for kind in ("settings", "observations")
                          for verb in ("get", "set")})


if __name__ == "__main__":
    unittest.main()
