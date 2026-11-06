#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Minimal WebSocket client (RFC 6455) on the standard library, used by tools/capture.py.

  from ws_client import WebSocket; ws = WebSocket.connect("wss://host:8123/api/websocket"); ws.send_text("{}")

Why it exists: the tools may not depend on anything but the standard library, and Home Assistant speaks websocket.
Scope is what a read-only capture needs: HTTP upgrade with `Sec-WebSocket-Accept` check, masked text frames,
fragmented messages (ZHA answers run to hundreds of KiB), ping/pong, close handshake, one deadline per receive.
`wss://` uses the system CA store, optionally plus a CA file; there is deliberately no way to skip verification.
Tests: tests/test_ws_client.py.
"""

import base64
import contextlib
import hashlib
import os
import socket
import ssl
import struct
import time
from urllib.parse import urlsplit

GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"  # fixed by RFC 6455 section 1.3
MAX_MESSAGE = 64 * 1024 * 1024  # a larger "answer" is a broken or hostile server, not a ZHA table
TEXT, BINARY, CLOSE, PING, PONG, CONT = 0x1, 0x2, 0x8, 0x9, 0xA, 0x0


class WebSocketError(Exception):
    """Protocol or connection failure; the message never contains request data."""


class WebSocketTimeout(WebSocketError):
    """The deadline passed before the peer answered."""


class WebSocket:
    """One client connection. Use `WebSocket.connect(url)`; not thread-safe."""

    def __init__(self, sock: socket.socket):
        self.sock = sock
        self.buf = b""
        self.deadline = None
        self.closed = False

    @classmethod
    def connect(cls, url: str, timeout: float = 10.0, cafile: str | None = None) -> WebSocket:
        """Open the connection and do the upgrade handshake; raises WebSocketError on any deviation."""
        parts = urlsplit(url)
        if parts.scheme not in ("ws", "wss") or not parts.hostname:
            raise WebSocketError("not a ws:// or wss:// URL")
        port = parts.port or (443 if parts.scheme == "wss" else 80)
        try:
            sock = socket.create_connection((parts.hostname, port), timeout=timeout)
            if parts.scheme == "wss":
                context = ssl.create_default_context(cafile=cafile)  # verifies chain and host name
                sock = context.wrap_socket(sock, server_hostname=parts.hostname)
        except TimeoutError as exc:
            raise WebSocketTimeout("connection timed out") from exc
        except ssl.SSLError as exc:
            raise WebSocketError(f"TLS failed: {exc.reason or 'handshake error'}") from exc
        except OSError as exc:
            raise WebSocketError(f"cannot connect: {exc.strerror or type(exc).__name__}") from exc
        ws = cls(sock)
        try:
            ws._handshake(parts, timeout)
        except BaseException:
            sock.close()
            raise
        return ws

    def _handshake(self, parts, timeout: float) -> None:
        key = base64.b64encode(os.urandom(16)).decode()
        target = (parts.path or "/") + (f"?{parts.query}" if parts.query else "")
        default = 443 if parts.scheme == "wss" else 80
        host = parts.hostname if ":" not in parts.hostname else f"[{parts.hostname}]"
        host += f":{parts.port}" if parts.port and parts.port != default else ""
        request = (f"GET {target} HTTP/1.1\r\nHost: {host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                   f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n")
        self.deadline = time.monotonic() + timeout
        self._send_raw(request.encode("ascii"))
        while b"\r\n\r\n" not in self.buf:
            if len(self.buf) > 65536:
                raise WebSocketError("handshake answer too long")
            self._fill()
        head, _, self.buf = self.buf.partition(b"\r\n\r\n")
        lines = head.decode("latin-1").split("\r\n")
        if len(lines[0].split(" ", 2)) < 2 or lines[0].split(" ", 2)[1] != "101":
            raise WebSocketError(f"server did not upgrade ({lines[0][:40]})")
        headers = {}
        for line in lines[1:]:
            name, _, value = line.partition(":")
            headers[name.strip().lower()] = value.strip()
        expected = base64.b64encode(hashlib.sha1((key + GUID).encode()).digest()).decode()  # noqa: S324 - fixed by RFC 6455, not a security use
        if headers.get("sec-websocket-accept") != expected:
            raise WebSocketError("Sec-WebSocket-Accept does not match: not a websocket server")

    # -- low level -------------------------------------------------------------------------------------------------
    def _send_raw(self, data: bytes) -> None:
        try:
            self.sock.settimeout(self._remaining())
            self.sock.sendall(data)
        except TimeoutError as exc:
            raise WebSocketTimeout("send timed out") from exc
        except OSError as exc:
            raise WebSocketError("connection lost while sending") from exc

    def _remaining(self) -> float:
        if self.deadline is None:
            return 10.0
        left = self.deadline - time.monotonic()
        if left <= 0:
            raise WebSocketTimeout("timed out")
        return left

    def _fill(self) -> None:
        """Read more bytes under the deadline, so a server dribbling bytes cannot hold us beyond it."""
        try:
            self.sock.settimeout(self._remaining())
            chunk = self.sock.recv(65536)
        except TimeoutError as exc:
            raise WebSocketTimeout("timed out") from exc
        except OSError as exc:
            raise WebSocketError("connection lost") from exc
        if not chunk:
            raise WebSocketError("connection closed by the server")
        self.buf += chunk

    def _read(self, n: int) -> bytes:
        while len(self.buf) < n:
            self._fill()
        data, self.buf = self.buf[:n], self.buf[n:]
        return data

    def _send_frame(self, opcode: int, payload: bytes) -> None:
        """Client frames must be masked (RFC 6455 5.3); always a single final frame."""
        n = len(payload)
        head = bytes([0x80 | opcode])
        if n < 126:
            head += bytes([0x80 | n])
        elif n < 65536:
            head += bytes([0x80 | 126]) + struct.pack(">H", n)
        else:
            head += bytes([0x80 | 127]) + struct.pack(">Q", n)
        mask = os.urandom(4)
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload)) if n < 4096 else _mask_big(payload, mask)
        self._send_raw(head + mask + masked)

    def _read_frame(self) -> tuple[bool, int, bytes]:
        b0, b1 = self._read(2)
        if b0 & 0x70:
            raise WebSocketError("frame uses a reserved bit (no extension was negotiated)")
        if b1 & 0x80:
            raise WebSocketError("server frame is masked")
        length = b1 & 0x7F
        if length == 126:
            length = struct.unpack(">H", self._read(2))[0]
        elif length == 127:
            length = struct.unpack(">Q", self._read(8))[0]
        opcode = b0 & 0x0F
        if length > MAX_MESSAGE or (opcode >= 8 and (length > 125 or not b0 & 0x80)):
            raise WebSocketError("invalid or oversized frame")
        return bool(b0 & 0x80), opcode, self._read(length)

    # -- messages --------------------------------------------------------------------------------------------------
    def send_text(self, text: str, timeout: float = 10.0) -> None:
        """Send one text message."""
        self.deadline = time.monotonic() + timeout
        self._send_frame(TEXT, text.encode("utf-8"))

    def recv_text(self, timeout: float = 30.0) -> str:
        """Next complete text message within `timeout` seconds in total; answers pings, ignores pongs."""
        self.deadline = time.monotonic() + timeout
        parts: list[bytes] = []
        size = 0
        started = False
        while True:
            fin, opcode, payload = self._read_frame()
            if opcode == PING:
                self._send_frame(PONG, payload)
            elif opcode == PONG:
                continue
            elif opcode == CLOSE:
                self._answer_close(payload)
                raise WebSocketError("connection closed by the server")
            elif opcode in (TEXT, BINARY, CONT):
                if (opcode == CONT) != started or opcode == BINARY:
                    raise WebSocketError("unexpected frame sequence or binary message")
                started = True
                size += len(payload)
                if size > MAX_MESSAGE:
                    raise WebSocketError("message too large")
                parts.append(payload)
                if fin:
                    try:
                        return b"".join(parts).decode("utf-8")
                    except UnicodeDecodeError as exc:
                        raise WebSocketError("message is not valid UTF-8") from exc
            else:
                raise WebSocketError("unknown frame type")

    def _answer_close(self, payload: bytes) -> None:
        if not self.closed:
            self.closed = True
            with contextlib.suppress(WebSocketError):
                self._send_frame(CLOSE, payload[:2])

    def close(self) -> None:
        """Close handshake: send close, wait briefly for the echo, then drop the socket."""
        try:
            if not self.closed:
                self.closed = True
                self.deadline = time.monotonic() + 2.0
                self._send_frame(CLOSE, struct.pack(">H", 1000))
                while True:
                    _, opcode, _ = self._read_frame()
                    if opcode == CLOSE:
                        break
        except WebSocketError:
            pass  # peer gone or silent: closing is best effort
        finally:
            self.sock.close()


def _mask_big(payload: bytes, mask: bytes) -> bytes:
    """XOR with the 4-byte mask in one big-integer operation; a byte loop is too slow for large messages."""
    n = len(payload)
    key = (mask * (n // 4 + 1))[:n]
    return (int.from_bytes(payload, "big") ^ int.from_bytes(key, "big")).to_bytes(n, "big")
