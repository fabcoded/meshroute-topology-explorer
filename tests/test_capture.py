# SPDX-License-Identifier: MIT
"""Tests for tools/capture.py against the fake server in tests/ws_fake.py.  python3 -m unittest discover -s tests"""

import contextlib
import io
import json
import os
import stat
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import capture  # noqa: E402
import guard  # noqa: E402
from ws_fake import TOKEN, FakeServer, make_responses  # noqa: E402

REAL_PREFIX = "00:12:4b:00"  # the fake server's "real" addresses; must never survive anonymizing


class CaptureTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.out = Path(tmp.name) / "capture.json"

    def run_tool(self, server, *extra, token=TOKEN, url=None, stdin=None):
        """Run capture.main like the command line; returns (exit code, stdout, stderr)."""
        env = {"HASS_TOKEN": token} if token is not None else {}
        argv = ["--url", url or server.url, "--out", str(self.out), "--timeout", "3", *extra]
        out, err = io.StringIO(), io.StringIO()
        with mock.patch.dict(os.environ, env, clear=False), contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            if token is None:
                os.environ.pop("HASS_TOKEN", None)
            with mock.patch.object(sys, "stdin", stdin or io.StringIO("")):
                code = capture.main(argv)
        return code, out.getvalue(), err.getvalue()

    def assertNoSecrets(self, *texts):
        for text in texts:
            self.assertNotIn(TOKEN, text)
            self.assertNotIn(REAL_PREFIX, text)

    def test_anonymized_capture(self):
        with FakeServer(behavior=["ping", "event"]) as server:
            code, out, err = self.run_tool(server)
        self.assertEqual(code, 0, err)
        text = self.out.read_text(encoding="utf-8")
        self.assertNoSecrets(out, err, text)
        for private in ("Secret name", "Private room", "My Own Stick", "my_"):
            self.assertNotIn(private, text)
        data = json.loads(text)
        self.assertEqual(data["meta"]["ha_version"], "2026.10.2")
        self.assertEqual(data["hass_version"], "2026.10.2")
        self.assertIn("captured_at", data["meta"])
        self.assertEqual(len(data["responses"]["zha/devices"]), 45)
        self.assertEqual(set(data["responses"]), set(capture.COMMANDS))
        self.assertNotIn("warning", err.lower())

    def test_output_file_is_private(self):
        with FakeServer() as server:
            self.run_tool(server)
        if os.name == "posix":
            self.assertEqual(stat.S_IMODE(self.out.stat().st_mode), 0o600)

    def test_raw_warns_and_keeps_real_addresses(self):
        with FakeServer() as server:
            code, out, err = self.run_tool(server, "--raw")
        self.assertEqual(code, 0)
        self.assertIn("WARNING", err)
        self.assertIn("REAL", err)
        self.assertNotIn(REAL_PREFIX, err + out)  # the warning itself shows no address
        self.assertIn(REAL_PREFIX, self.out.read_text(encoding="utf-8"))
        self.assertNotIn(TOKEN, self.out.read_text(encoding="utf-8"))

    def test_exactly_the_allowed_commands_are_sent(self):
        with FakeServer() as server:
            self.run_tool(server)
        self.assertEqual(server.commands, ["config/area_registry/list", "config/device_registry/list",
                                           "config_entries/get", "zha/devices"])
        for command in server.commands:
            self.assertIn(command, guard.ALLOWED_COMMANDS)
        self.assertNotIn("zha/topology/update", server.commands)

    def test_matter_topology_on_request_cached_and_anonymized(self):
        responses = make_responses()
        topo = json.loads((ROOT / "tests" / "fixtures" / "matter-sample.json").read_text(encoding="utf-8").replace(
            "aabbccdd", "02124b00").replace("AABBCCDD", "02124B00").replace("thread-net-01", "my-home-net"))[
            "responses"]["matter/network_topology"]
        responses["matter/network_topology"] = topo
        with FakeServer(responses=responses) as server:
            code, out, err = self.run_tool(server, "--matter")
        self.assertEqual(code, 0, err)
        self.assertEqual(server.messages[-1], {"id": 5, "type": "matter/network_topology", "refresh": False})
        self.assertNotIn(True, [m.get("refresh") for m in server.messages])
        text = self.out.read_text(encoding="utf-8")
        self.assertNotIn("02124b00", text.lower())
        self.assertNotIn("my-home-net", text)
        data = json.loads(text)
        self.assertEqual(len(data["responses"]["matter/network_topology"]["nodes"]), 5)
        self.assertIn("5 Thread nodes", out)

    def test_without_matter_flag_no_topology_is_asked(self):
        with FakeServer() as server:
            self.run_tool(server)
        self.assertNotIn("matter/network_topology", server.commands)

    def test_matter_refused_names_the_requirement(self):
        with FakeServer() as server:  # the fake knows no matter/network_topology: unknown_command
            code, _, err = self.run_tool(server, "--matter")
        self.assertEqual(code, capture.EXIT["command"])
        self.assertIn("2026.9", err)

    def test_source_names_only_allowed_commands(self):
        """The guard checks shipped code only; this applies its rules to the tool and its websocket client."""
        for name in ("capture.py", "ws_client.py"):
            for n, line in enumerate((ROOT / "tools" / name).read_text(encoding="utf-8").splitlines(), 1):
                self.assertEqual(guard.content_findings(line.replace("fetch(", "get(").replace("WebSocket(", "Socket(")), [],
                                 f"{name}:{n}")
                self.assertFalse([t for t in guard.DENY if t in line], f"{name}:{n}")

    def test_token_never_in_messages_or_file(self):
        secret = "wrong-token-XYZ-987"
        with FakeServer() as server:
            code, out, err = self.run_tool(server, token=secret)
        self.assertEqual(code, 3)
        self.assertNotIn(secret, out + err)
        self.assertFalse(self.out.exists())
        self.assertIn("authentication failed", err)

    def test_token_from_stdin_without_env(self):
        with FakeServer() as server:
            code, out, err = self.run_tool(server, token=None, stdin=io.StringIO(TOKEN + "\n"))
        self.assertEqual(code, 0, err)
        self.assertNoSecrets(out, err, self.out.read_text(encoding="utf-8"))

    def test_no_token_at_all(self):
        with FakeServer() as server:
            code, _, err = self.run_tool(server, token=None)
        self.assertEqual(code, 1)
        self.assertIn("no token", err)

    def test_token_option_is_refused(self):
        with FakeServer() as server:
            code, out, err = self.run_tool(server, "--token", "secret-on-cmdline-1")
        self.assertEqual(code, 1)
        self.assertIn("HASS_TOKEN", err)
        self.assertNotIn("secret-on-cmdline-1", out + err)
        self.assertEqual(server.commands, [])
        self.assertFalse(self.out.exists())

    def test_command_error(self):
        with FakeServer(behavior=["unknown"]) as server:
            code, _, err = self.run_tool(server)
        self.assertEqual(code, 4)
        self.assertIn("unknown_command", err)
        self.assertFalse(self.out.exists())

    def test_timeout(self):
        with FakeServer(behavior=["stall"]) as server:
            code, _, err = self.run_tool(server, "--timeout", "0.5")
        self.assertEqual(code, 5, err)
        self.assertFalse(self.out.exists())

    def test_handshake_failure(self):
        with FakeServer(behavior=["bad_accept"]) as server:
            code, _, err = self.run_tool(server)
        self.assertEqual(code, 2)
        self.assertIn("Accept", err)

    def test_bad_urls(self):
        for url in ("ftp://host", "homeassistant.local:8123", "http://", "http://user:pw@host:8123", "http://h:port"):
            code, out, err = self.run_tool(None, url=url)
            self.assertEqual(code, 1, url)
            self.assertNotIn("pw@", out + err)

    def test_websocket_url(self):
        self.assertEqual(capture.websocket_url("http://ha.local:8123"), "ws://ha.local:8123/api/websocket")
        self.assertEqual(capture.websocket_url("https://ha.example/sub/"), "wss://ha.example/sub/api/websocket")

    def test_anonymizer_refusal_writes_nothing(self):
        with FakeServer() as server, mock.patch.object(capture.anonymize_capture, "anonymize", side_effect=ValueError("x")):
            code, _, err = self.run_tool(server)
        self.assertEqual(code, 6)
        self.assertFalse(self.out.exists())


if __name__ == "__main__":
    unittest.main()
