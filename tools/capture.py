#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Capture the ZHA topology from your own Home Assistant, anonymized, for tests and bug reports.

  HASS_TOKEN=... python3 tools/capture.py --url http://homeassistant.local:8123 --out capture.json [--raw] [--matter]

Needs a long-lived access token (profile page in Home Assistant). It comes from the environment variable HASS_TOKEN
or is typed at a prompt without echo; there is no --token option on purpose, because a command line ends up in the
shell history and in the process list. The token is never printed and never written to the file.
Read only: the tool sends exactly the four commands in COMMANDS (spec 3.4) and nothing else, not even a topology
scan. --matter adds the Thread topology (spec 3.2): `matter/network_topology` with refresh false, the Matter server's
cached snapshot (refresh true would read every node's tables over the radio and is never sent). It talks only to the URL you give. By default the result goes through tools/anonymize_capture.py before it is
written; --raw skips that and writes real addresses and names: do not share such a file.
Exit codes: 0 ok, 1 usage or bad input, 2 cannot connect, 3 authentication failed, 4 command refused, 5 timeout,
6 anonymizer refused. Tests: tests/test_capture.py. Format: tools/anonymize_capture.py.
"""

import argparse
import datetime as dt
import getpass
import json
import os
import sys
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))
import anonymize_capture
from ws_client import WebSocket, WebSocketError, WebSocketTimeout

VERSION = "1"
# Spec 3.4. Only the read commands; zha/topology/update would cause radio traffic and is not needed here.
COMMANDS = ("config/area_registry/list", "config/device_registry/list", "config_entries/get", "zha/devices")
# Spec 3.2: the cached snapshot only (Home Assistant 2026.9 or newer). Never refresh true: that is radio traffic.
MATTER_COMMAND = "matter/network_topology"
EXIT = {"usage": 1, "connect": 2, "auth": 3, "command": 4, "timeout": 5, "anonymizer": 6}


class CaptureError(Exception):
    """A failure with an exit code; the message is safe to print (no token, no addresses)."""

    def __init__(self, kind: str, message: str):
        super().__init__(message)
        self.code = EXIT[kind]


def websocket_url(url: str) -> str:
    """http(s) base URL of Home Assistant -> ws(s) URL of its websocket endpoint; rejects anything else."""
    parts = urlsplit(url)
    try:
        port = parts.port  # raises on a non-numeric port
    except ValueError:
        port = -1
    if parts.scheme not in ("http", "https") or not parts.hostname or port == -1 or parts.username or parts.password:
        raise CaptureError("usage", "bad --url: expected http://host:8123 or https://host (no user name or password)")
    scheme = "wss" if parts.scheme == "https" else "ws"
    return f"{scheme}://{parts.netloc}{parts.path.rstrip('/')}/api/websocket"


def read_token() -> str:
    """Token from HASS_TOKEN, else from the terminal without echo (or one line of stdin when piped)."""
    token = os.environ.get("HASS_TOKEN", "").strip()
    if not token:
        token = (getpass.getpass("Home Assistant access token: ") if sys.stdin.isatty() else sys.stdin.readline()).strip()
    if not token:
        raise CaptureError("usage", "no token: set HASS_TOKEN or type it at the prompt")
    return token


def fetch(url: str, token: str, timeout: float, cafile: str | None, matter: bool = False) -> tuple[str, dict]:
    """Authenticate, ask the COMMANDS one after the other; returns (ha_version, {command: answer})."""
    try:
        ws = WebSocket.connect(websocket_url(url), timeout=timeout, cafile=cafile)
    except WebSocketTimeout as exc:
        raise CaptureError("timeout", str(exc)) from None
    except WebSocketError as exc:
        raise CaptureError("connect", str(exc)) from None
    try:
        return _converse(ws, token, timeout, matter)
    except WebSocketTimeout as exc:
        raise CaptureError("timeout", f"Home Assistant did not answer in time ({exc})") from None
    except WebSocketError as exc:
        raise CaptureError("connect", str(exc)) from None
    finally:
        ws.close()


def _message(ws: WebSocket, timeout: float) -> dict:
    """Next message as a JSON object; anything else is a protocol error."""
    try:
        msg = json.loads(ws.recv_text(timeout))
    except ValueError:
        raise CaptureError("connect", "Home Assistant sent something that is not JSON") from None
    if not isinstance(msg, dict):
        raise CaptureError("connect", "unexpected message from Home Assistant")
    return msg


def _converse(ws: WebSocket, token: str, timeout: float, matter: bool = False) -> tuple[str, dict]:
    """The auth flow of the Home Assistant websocket API, then one request per command (and the Matter topology)."""
    if _message(ws, timeout).get("type") != "auth_required":
        raise CaptureError("connect", "not a Home Assistant websocket (no auth_required)")
    ws.send_text(json.dumps({"type": "auth", "access_token": token}), timeout)
    reply = _message(ws, timeout)
    if reply.get("type") != "auth_ok":
        raise CaptureError("auth", "authentication failed: check the token (it must be a long-lived access token)")
    answers = {}
    # (command, extra fields): the ZHA reads, then the Matter topology with refresh false on request.
    requests = [(command, {}) for command in COMMANDS] + ([(MATTER_COMMAND, {"refresh": False})] if matter else [])
    for msg_id, (command, extra) in enumerate(requests, 1):
        ws.send_text(json.dumps({"id": msg_id, "type": command, **extra}), timeout)
        while True:  # events for other ids are skipped; the answer carries our id
            msg = _message(ws, timeout)
            if msg.get("type") == "result" and msg.get("id") == msg_id:
                break
        if not msg.get("success"):
            error = msg.get("error") if isinstance(msg.get("error"), dict) else {}
            code = str(error.get("code", "unknown"))[:40]  # the free-text message is not echoed
            hint = ("Home Assistant 2026.9 or newer with the Matter integration is needed" if command == MATTER_COMMAND
                    else "is the ZHA integration set up and the token's user an administrator?")
            raise CaptureError("command", f"Home Assistant refused {command} (error code {code}); {hint}")
        answers[command] = msg.get("result")
    version = reply.get("ha_version")
    return (version if isinstance(version, str) else ""), answers


def build_capture(ha_version: str, answers: dict) -> dict:
    """Capture in the format of anonymize_capture.py, plus a meta block."""
    now = dt.datetime.now(dt.UTC).replace(microsecond=0).isoformat()
    return {"meta": {"tool": "meshroute-topology-explorer capture.py", "version": VERSION,
                     "ha_version": ha_version, "captured_at": now},
            "hass_version": ha_version, "language": None, "responses": answers}


def write_private(path: Path, data: dict) -> None:
    """Write JSON readable by the current user only; a capture is personal even after anonymizing."""
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=1, ensure_ascii=False)
        handle.write("\n")


def run(args: argparse.Namespace) -> int:
    """Fetch, optionally anonymize, write. Errors become messages on stderr."""
    token = read_token()
    ha_version, answers = fetch(args.url, token, args.timeout, args.cafile, args.matter)
    capture = build_capture(ha_version, answers)
    if args.raw:
        print("WARNING: --raw writes REAL addresses, names and ids. Do not share, post or commit this file;"
              " run tools/anonymize_capture.py on it first.", file=sys.stderr)
        result = capture
    else:
        try:
            result = {"meta": capture["meta"], **anonymize_capture.anonymize(capture)}
        except ValueError as exc:
            raise CaptureError("anonymizer", f"anonymizer refused, nothing written: {exc}") from None
    write_private(args.out, result)
    count = len(result["responses"].get("zha/devices", []))
    topology = result["responses"].get(MATTER_COMMAND)
    nodes = f" and {len(topology.get('nodes') or [])} Thread nodes" if isinstance(topology, dict) else ""
    print(f"{count} ZHA devices{nodes} captured ({'RAW' if args.raw else 'anonymized'}) -> {args.out}")
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0], allow_abbrev=False)
    parser.add_argument("--url", required=True, help="Home Assistant address, e.g. http://homeassistant.local:8123")
    parser.add_argument("--out", required=True, type=Path, help="file to write")
    parser.add_argument("--raw", action="store_true", help="skip anonymizing (real addresses; never share the file)")
    parser.add_argument("--matter", action="store_true",
                        help="also capture the Thread topology (matter/network_topology, cached, no radio traffic)")
    parser.add_argument("--cafile", help="extra CA certificate file for https with your own CA")
    parser.add_argument("--timeout", type=float, default=30.0, help="seconds to wait per step (default 30)")
    parser.add_argument("--token", help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    try:
        if args.token is not None:
            raise CaptureError("usage", "--token is not accepted: a command line is kept in the shell history and "
                                        "visible to other users. Set HASS_TOKEN or type it at the prompt.")
        return run(args)
    except CaptureError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return exc.code
    except OSError as exc:
        print(f"error: cannot write {args.out}: {exc.strerror}", file=sys.stderr)
        return EXIT["usage"]


if __name__ == "__main__":
    sys.exit(main())
