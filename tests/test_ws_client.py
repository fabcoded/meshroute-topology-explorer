# SPDX-License-Identifier: MIT
"""Tests for tools/ws_client.py against the fake server in tests/ws_fake.py.  python3 -m unittest discover -s tests"""

import json
import socket
import sys
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import ws_client  # noqa: E402
from ws_client import WebSocket, WebSocketError, WebSocketTimeout  # noqa: E402
from ws_fake import FakeServer  # noqa: E402


class WebSocketTest(unittest.TestCase):
    def connect(self, server, **kw):
        ws = WebSocket.connect(f"ws://127.0.0.1:{server.port}/api/websocket", timeout=3, **kw)
        self.addCleanup(ws.sock.close)
        return ws

    def test_handshake_and_first_message(self):
        with FakeServer() as server:
            ws = self.connect(server)
            self.assertEqual(json.loads(ws.recv_text(3))["type"], "auth_required")
            ws.close()

    def test_wrong_accept_key_is_refused(self):
        with FakeServer(behavior=["bad_accept"]) as server:
            with self.assertRaisesRegex(WebSocketError, "Accept"):
                self.connect(server)

    def test_no_upgrade_is_refused(self):
        with FakeServer(behavior=["no_upgrade"]) as server:
            with self.assertRaisesRegex(WebSocketError, "upgrade"):
                self.connect(server)

    def test_scheme_and_connection_errors(self):
        with self.assertRaises(WebSocketError):
            WebSocket.connect("http://127.0.0.1:1/")
        probe = socket.socket()
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
        probe.close()  # nothing listens here now
        with self.assertRaises(WebSocketError):
            WebSocket.connect(f"ws://127.0.0.1:{port}/", timeout=2)

    def test_silent_server_times_out(self):
        with FakeServer(behavior=["silent"]) as server:
            ws = self.connect(server)
            started = time.monotonic()
            with self.assertRaises(WebSocketTimeout):
                ws.recv_text(0.3)
            self.assertLess(time.monotonic() - started, 2)

    def test_large_fragmented_message_with_control_frames(self):
        big = {"zha/devices": [{"name": "x" * 1000, "n": i} for i in range(600)]}  # about 650 KB
        with FakeServer(responses=big, behavior=["fragment", "ping"]) as server:
            ws = self.connect(server)
            ws.recv_text(3)
            ws.send_text(json.dumps({"type": "auth", "access_token": server.token}))
            ws.recv_text(3)
            ws.send_text(json.dumps({"id": 1, "type": "zha/devices"}))
            answer = json.loads(ws.recv_text(5))
            self.assertEqual(answer["result"], big["zha/devices"])
            ws.close()

    def test_large_client_message_is_masked_and_arrives_intact(self):
        with FakeServer() as server:
            ws = self.connect(server)
            ws.recv_text(3)
            ws.send_text(json.dumps({"type": "auth", "access_token": server.token, "pad": "y" * 200000}))
            self.assertEqual(json.loads(ws.recv_text(3))["type"], "auth_ok")
            ws.close()

    def test_close_from_server_raises(self):
        with FakeServer(behavior=["close_after"]) as server:
            ws = self.connect(server)
            ws.recv_text(3)
            ws.send_text(json.dumps({"type": "auth", "access_token": server.token}))
            ws.recv_text(3)
            ws.send_text(json.dumps({"id": 1, "type": "zha/devices"}))
            ws.recv_text(3)
            with self.assertRaisesRegex(WebSocketError, "closed"):
                ws.recv_text(3)

    def test_mask_helper_matches_byte_loop(self):
        payload, mask = bytes(range(256)) * 20, b"\x01\x02\x03\x04"
        slow = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        self.assertEqual(ws_client._mask_big(payload, mask), slow)


if __name__ == "__main__":
    unittest.main()
