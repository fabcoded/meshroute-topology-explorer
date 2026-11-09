# SPDX-License-Identifier: MIT
"""Tests for tools/guard.py: deny-list, outside URLs in shipped files, SPDX lines.  python3 -m unittest discover -s tests"""

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
import guard

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

    def test_voluptuous_import_is_flagged_in_shipped_python(self):
        src = "# SPDX-License-Identifier: MIT\nimport voluptuous as vol\n"
        root = self.tree({"custom_components/x/config_flow.py": src, "tools/t.py": src})
        findings = guard.check(root)
        self.assertEqual(len(findings), 1)
        self.assertIn("config_flow.py:2", findings[0])
        ok = self.tree({"custom_components/x/config_flow.py": "# SPDX-License-Identifier: MIT\nimport probatio\n"})
        self.assertEqual(guard.check(ok), [])

    def test_secret_command_is_flagged(self):
        root = self.tree({"custom_components/x/panel.js": SPDX + "hass.callWS({ type: 'otbr/info' })\n"})
        self.assertIn("otbr/", guard.check(root)[0])  # the whole otbr/ namespace is out: otbr/info returns the key

    def test_outside_url_only_in_shipped_files(self):
        root = self.tree({
            "custom_components/x/panel.js": SPDX + "const u = 'https://cdn.example.net/lib.js'\n",
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

    def test_svg_namespace_is_a_name_not_an_address(self):
        root = self.tree({"custom_components/x/p.js": SPDX + "const NS = \"http://www.w3.org/2000/svg\";\n"
                          "const a = 'http://www.w3.org/2000/svg/x'; const b = 'http://www.w3.org/1999/xhtml'\n"})
        found = guard.check(root)
        self.assertEqual(len(found), 2, found)
        self.assertTrue(all(":3:" in f for f in found), found)

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

    def test_display_names_with_a_slash_are_not_commands(self):
        root = self.tree({"custom_components/x/names.js": SPDX + "const n = ['On/Off', 'Heating/Cooling Unit'];\n"})
        self.assertEqual(guard.check(root), [])
        root = self.tree({"custom_components/x/bad.js": SPDX + "a('zha/network/settings'); const n = 'On/Off';\n"})
        self.assertEqual(len(guard.check(root)), 1)

    def test_matter_topology_read_only(self):
        root = self.tree({
            "custom_components/x/ok.js": SPDX + "hass.callWS({ type: 'matter/network_topology', refresh: false })\n",
            "custom_components/x/radio.js": SPDX + "hass.callWS({ type: 'matter/network_topology', refresh: true })\n",
            "custom_components/x/radio.py": "# SPDX-License-Identifier: MIT\nmsg = {'type': 'matter/network_topology', 'refresh': True}\n",
            "custom_components/x/keys.js": SPDX + "a({ type: 'thread/get_dataset_tlv' }); b({ type: 'otbr/info' })\n",
        })
        found = guard.check(root)
        self.assertFalse(any("ok.js" in f for f in found), found)
        self.assertEqual(sum("refresh: true" in f for f in found), 2, found)
        self.assertTrue(any("keys.js" in f and "network keys" in f for f in found), found)

    def test_known_bypasses_are_flagged(self):
        cases = {
            "template.js": "hass.callWS({ type: `light/turn_on` })",
            "concat.js": 'hass.callWS({ type: "zha" + "/devices/bind" })',
            "constant.js": 'const CMD = "light/turn_on"',
            "computed.js": 'hass.callWS({ ["type"]: kind })',
            "service.js": 'hass.callService("zha", "permit")',
            "api.js": 'hass.callApi("POST", "services/zha/permit")',
            "fetch.js": "fetch(`/api/${name}`)",
            "socket.js": 'const s = new WebSocket("ws://" + host)',
            "sink.js": "el.innerHTML = device.name",
            "dynamic.js": "const t = hass.callWS({ type: kind + '/x' })",
        }
        for name, code in cases.items():
            with self.subTest(name):
                root = self.tree({f"custom_components/x/{name}": SPDX + code + "\n"})
                self.assertTrue(guard.check(root), code)
        root = self.tree({"custom_components/x/two.js": SPDX + "hass.callWS({\n  type:\n    'light/turn_on',\n})\n"})
        self.assertTrue(guard.check(root), "type and value on two lines")

    def test_unknown_extension_in_shipped_files(self):
        root = self.tree({"custom_components/x/a.cjs": SPDX + "x = 1\n", "custom_components/x/b.exe": "x"})
        found = guard.check(root)
        self.assertEqual(len(found), 2, found)
        self.assertTrue(all("not allowed in shipped files" in f for f in found))

    def test_new_deny_terms_and_clean_code(self):
        root = self.tree({"custom_components/x/p.js": SPDX + "a('zha/groups/add'); b('zha/devices/clusters/attributes')\n"
                          "c('matter/open_commissioning_window')\n"})
        self.assertEqual(len(guard.check(root)), 3)
        ok = self.tree({"custom_components/x/p.js": SPDX + "el.textContent = './a.js'; import('/m_x/0.1.0/p.js')\n"
                        "// text/plain and a/b in prose\n"})
        self.assertEqual(guard.check(ok), [])

    def test_attribute_read_is_the_one_cluster_command(self):
        # The user-started read of one attribute value is allowed exactly.
        ok = self.tree({"custom_components/x/p.js": SPDX
                        + "callWS({ type: \"zha/devices/clusters/attributes/value\", ieee })\n"
                        + "const k = 'zha/devices/clusters/attributes/value';\n"})
        self.assertEqual(guard.check(ok), [])
        denied = {
            "list.js": "a('zha/devices/clusters')",
            "attrs.js": "a('zha/devices/clusters/attributes')",
            "commands.js": "a('zha/devices/clusters/commands')",
            "longer.js": "a('zha/devices/clusters/attributes/value/write')",
            "joined.js": "a('zha/devices/clusters/attributes/' + 'value')",
            "template.js": "a(`zha/devices/clusters/attributes/${x}`)",
            "bind.js": "a('zha/devices/bind')",
            "unbind.js": "a('zha/devices/unbind')",
            "group_bind.js": "a('zha/groups/bind')",
            "write.py": "SERVICE = 'set_zigbee_cluster_attribute'",
            "command.py": "SERVICE = 'issue_zigbee_cluster_command'",
            "direct_bind.py": "SERVICE = 'issue_direct_zigbee_bind'",
            "network.js": "a('zha/network/settings')",
            "reconfigure.js": "a('zha/devices/reconfigure')",
        }
        for name, code in denied.items():
            with self.subTest(name):
                header = "# SPDX-License-Identifier: MIT\n" if name.endswith(".py") else SPDX
                root = self.tree({f"custom_components/x/{name}": header + code + "\n"})
                self.assertTrue(guard.check(root), code)
        self.assertIn("zha/devices/clusters/attributes/value", guard.ALLOWED_COMMANDS)
        self.assertEqual(guard.DENY_EXCEPT, ("zha/devices/clusters/attributes/value",))

    def test_shipped_python_reads_only_route_records(self):
        """PY_DENY: zigpy's network settings, keys, saved copies and radio calls."""
        py = "# SPDX-License-Identifier: MIT\n"
        denied = {
            "settings": "info = app.state.network_info",
            "keys": "key = app.config[CONF_NWK]",
            "saved": "copies = app.backups.backups",
            "permit": "await app.permit(60)",
            "request": "await dev.request(0, 6, 1, 1, 1, b'')",
            "zdo": "await dev.zdo.Mgmt_Lqi_req(0)",
            "scan": "await app.topology.scan()",
            "energy": "await app.energy_scan(channels, 4, 1)",
            "leave": "await app.remove(ieee)",
            "write": "await cluster.write_attributes({0: 1})",
            "zha_data": "data = get_zha_data(hass)",
            # #11: the Matter client's calls that go to the radio or change the fabric
            "matter_read": "await client.read_attribute(14, '0/53/8')",
            "matter_refresh": "await client.refresh_attribute(14, '0/53/7')",
            "matter_topology": "await client.get_network_topology(refresh=True)",
            "matter_command": "await client.send_device_command(14, 1, cmd)",
            "matter_interview": "await client.interview_node(14)",
        }
        # rev11a: every further call of the Matter client that sends, changes the fabric or returns credentials.
        for call in ("send_command('x')", "send_command_no_wait('x')", "send_batched_device_commands([])",
                     "send_webrtc_provider_command(1)", "get_all_credentials()", "set_thread_operational_dataset('x')",
                     "remove_thread_dataset()", "remove_wifi_credentials()", "remove_matter_fabric(1, 2)",
                     "set_default_fabric_label('x')", "update_node(14, '1')", "check_node_update(14)",
                     "upload_ota_file(b'')", "get_thread_diagnostics(14)", "node_diagnostics(14)", "get_diagnostics()",
                     "register_icd(14)", "unregister_icd(14)", "resync_icd(14)", "get_icd_state(14)",
                     "camera_start_stream(14)", "subscribe([])", "subscribe_events(cb)", "start_listening()"):
            denied[f"client_{call.split('(')[0]}"] = f"await client.{call}"
        for name, code in denied.items():
            with self.subTest(name):
                root = self.tree({f"custom_components/x/{name}.py": py + code + "\n"})
                self.assertTrue(guard.check(root), code)
        # The route records themselves pass, and the rule is for shipped Python only (tests and tools may name them).
        allowed = ("app = get_zha_gateway(hass).application_controller\nrelays = [d.relays for d in app.devices.values()]\n"
                   "app.topology.add_listener(listener)\nperiod = app.config.get('topology_scan_period')\n"
                   "nodes = get_matter(hass).matter_client.get_nodes()\ncluster = nodes[0].get_cluster(0, 53)\n")
        root = self.tree({"custom_components/x/routes.py": py + allowed, "tests/fake.py": py + "app.state.network_info\n",
                          "custom_components/x/panel.js": SPDX + "// permit joining is a raw value name\n"})
        self.assertEqual(guard.check(root), [])

    def test_shipped_python_of_the_repository_names_no_internal(self):
        root = Path(__file__).resolve().parent.parent / "custom_components"
        files = sorted(root.rglob("*.py"))
        self.assertTrue(any(f.name == "zigpy_routes.py" for f in files))
        for f in files:
            text = f.read_text(encoding="utf-8")
            for term in guard.PY_DENY + guard.DENY:
                self.assertNotIn(term, text, f"{f.name} names {term}")

    def test_virtualenv_is_skipped(self):
        root = self.tree({".venv/lib/x.py": "print(1)\n", ".venv314/lib/y.py": "print(2)\n"})
        self.assertEqual(guard.check(root), [])

    def test_repository_itself_is_clean(self):
        self.assertEqual(guard.check(Path(__file__).resolve().parent.parent), [])


if __name__ == "__main__":
    unittest.main()
