# SPDX-License-Identifier: MIT
"""Fake Home Assistant websocket server for the capture tests (standard library only, no real network).

Not a test itself: tests/test_ws_client.py and tests/test_capture.py import FakeServer and make_responses.
FakeServer listens on 127.0.0.1, does the RFC 6455 handshake and the Home Assistant auth flow, answers the four
read commands from `responses`, and records every command it receives. `behavior` switches in the faults the tests
need (bad accept key, rejected token, silence, fragmentation, ping, unknown command, close).
"""

import base64
import hashlib
import json
import os
import socket
import struct
import threading
from pathlib import Path

GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
FIXTURE = Path(__file__).resolve().parent / "fixtures" / "zha-sample.json"
TOKEN = "test-token-DO-NOT-LEAK-0123456789"


def make_responses() -> dict:
    """Fixture data turned back into 'real looking' values (vendor EUI prefix, user names, area ids) so that the
    anonymizer has something to replace; the fixture itself is already anonymous and would defeat its leak check."""
    text = FIXTURE.read_text(encoding="utf-8")
    for old, new in (("aa:bb:cc:dd:", "00:12:4b:00:"), ("0xaabbccdd", "0x00124b00"), ('"area_', '"room_'),
                     ('"entry_', '"01HZENTRY'), ('"device0', '"regid-0')):
        text = text.replace(old, new)
    responses = json.loads(text)["responses"]
    for n, device in enumerate(responses["zha/devices"]):
        device["user_given_name"] = f"Secret name {n}"
        for entity in device.get("entities") or []:
            entity["entity_id"] = entity["entity_id"].replace(".", ".my_", 1)
    for n, area in enumerate(responses["config/area_registry/list"]):
        area["name"] = f"Private room {n}"
    for entry in responses["config_entries/get"]:
        entry["title"] = "My Own Stick"
    return responses


def frame(opcode: int, payload: bytes, fin: bool = True) -> bytes:
    """Unmasked server frame."""
    n = len(payload)
    head = bytes([(0x80 if fin else 0) | opcode])
    if n < 126:
        head += bytes([n])
    elif n < 65536:
        head += bytes([126]) + struct.pack(">H", n)
    else:
        head += bytes([127]) + struct.pack(">Q", n)
    return head + payload


class FakeServer:
    """One-connection-at-a-time fake; `commands` lists the command types received, in order."""

    def __init__(self, responses=None, behavior=(), token=TOKEN, ha_version="2026.10.2"):
        self.responses = responses if responses is not None else make_responses()
        self.behavior = set(behavior)
        self.token = token
        self.ha_version = ha_version
        self.commands: list[str] = []
        self.messages: list[dict] = []  # every request as sent (without the auth message)
        self.received: list[bytes] = []  # raw text of every client message, to search for the token
        self.sock = socket.socket()
        self.sock.bind(("127.0.0.1", 0))
        self.sock.listen(5)
        self.port = self.sock.getsockname()[1]
        self.thread = threading.Thread(target=self._serve, daemon=True)
        self.thread.start()

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def close(self) -> None:
        try:
            self.sock.shutdown(socket.SHUT_RDWR)  # wakes the blocked accept()
        except OSError:
            pass
        self.sock.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def _serve(self) -> None:
        while True:
            try:
                conn, _ = self.sock.accept()
            except OSError:
                return
            try:
                self._session(conn)
            except (OSError, ValueError, TypeError):  # client left mid-conversation
                pass
            finally:
                conn.close()

    def _read_exact(self, conn, n: int) -> bytes:
        data = b""
        while len(data) < n:
            chunk = conn.recv(n - len(data))
            if not chunk:
                raise OSError("closed")
            data += chunk
        return data

    def _read_message(self, conn) -> str | None:
        """Next client text message (frames must be masked); None on close. Answers nothing."""
        while True:
            b0, b1 = self._read_exact(conn, 2)
            assert b1 & 0x80, "client frame must be masked"
            n = b1 & 0x7F
            if n == 126:
                n = struct.unpack(">H", self._read_exact(conn, 2))[0]
            elif n == 127:
                n = struct.unpack(">Q", self._read_exact(conn, 8))[0]
            mask = self._read_exact(conn, 4)
            payload = bytes(b ^ mask[i % 4] for i, b in enumerate(self._read_exact(conn, n)))
            opcode = b0 & 15
            if opcode == 8:
                conn.sendall(frame(8, payload[:2]))
                return None
            if opcode == 10:
                self.pong_seen = True
                continue
            self.received.append(payload)
            return payload.decode()

    def _session(self, conn) -> None:
        request = b""
        while b"\r\n\r\n" not in request:
            request += conn.recv(4096)
        key = [ln.split(":", 1)[1].strip() for ln in request.decode().split("\r\n") if ln.lower().startswith("sec-websocket-key")][0]
        accept = base64.b64encode(hashlib.sha1((key + GUID).encode()).digest()).decode()
        if "bad_accept" in self.behavior:
            accept = base64.b64encode(os.urandom(20)).decode()
        if "no_upgrade" in self.behavior:
            conn.sendall(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n")
            return
        conn.sendall(f"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                     f"Sec-WebSocket-Accept: {accept}\r\n\r\n".encode())
        if "silent" in self.behavior:
            threading.Event().wait(5)
            return
        conn.sendall(frame(1, json.dumps({"type": "auth_required", "ha_version": self.ha_version}).encode()))
        auth = json.loads(self._read_message(conn))
        if auth.get("access_token") != self.token:
            conn.sendall(frame(1, json.dumps({"type": "auth_invalid", "message": "Invalid access token"}).encode()))
            return
        conn.sendall(frame(1, json.dumps({"type": "auth_ok", "ha_version": self.ha_version}).encode()))
        while (text := self._read_message(conn)) is not None:
            msg = json.loads(text)
            self.commands.append(msg["type"])
            self.messages.append(msg)
            self._answer(conn, msg)

    def _answer(self, conn, msg: dict) -> None:
        mid, command = msg["id"], msg["type"]
        if "ping" in self.behavior:
            conn.sendall(frame(9, b"hello"))
            conn.sendall(frame(10, b"unsolicited pong"))
        if "event" in self.behavior:  # an event for an unrelated subscription must be skipped
            conn.sendall(frame(1, json.dumps({"id": 99, "type": "event", "event": {}}).encode()))
        if command not in self.responses or "unknown" in self.behavior:
            err = {"code": "unknown_command", "message": "Unknown command."}
            conn.sendall(frame(1, json.dumps({"id": mid, "type": "result", "success": False, "error": err}).encode()))
            return
        if "stall" in self.behavior and command == "zha/devices":
            threading.Event().wait(5)
            return
        data = json.dumps({"id": mid, "type": "result", "success": True, "result": self.responses[command]}).encode()
        if "fragment" in self.behavior and len(data) > 3:
            third = len(data) // 3
            conn.sendall(frame(1, data[:third], fin=False))
            conn.sendall(frame(9, b"mid"))  # control frames may sit between fragments
            conn.sendall(frame(0, data[third:2 * third], fin=False))
            conn.sendall(frame(0, data[2 * third:]))
        else:
            conn.sendall(frame(1, data))
        if "close_after" in self.behavior and command == "zha/devices":
            conn.sendall(frame(8, struct.pack(">H", 1000)))
