#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Turn a Home Assistant capture into an anonymized test fixture.

  python3 tools/anonymize_capture.py CAPTURE.json FIXTURE.json

A capture holds the answers of the Home Assistant websocket commands the panel reads, under "responses":
`zha/devices`, `config/device_registry/list`, `config/area_registry/list`, `config_entries/get`. Everything that
identifies a home is replaced: EUI-64 addresses (also in neighbour tables, extended PAN ids and hex form), user-given
device names, area ids and names, entity ids, registry and config-entry ids; entity names are dropped; registry
entries that are not ZHA devices are left out; times are shifted so the newest is 2026-01-01T12:00:00, gaps kept.
Kept for testing: device types, vendors, models, NWK addresses, LQI, relationships, routes, clusters.
Before writing, the output is searched for every replaced value; any hit aborts and nothing is written.
"""

import argparse
import datetime as dt
import json
import re
import sys
from pathlib import Path

EUI64 = re.compile(r"^[0-9a-f]{2}(?::[0-9a-f]{2}){7}$", re.IGNORECASE)
ANCHOR = dt.datetime(2026, 1, 1, 12, 0, 0)
ROLE = {"Coordinator": "Coordinator", "Router": "Router", "EndDevice": "End device"}


def fake_eui(n: int) -> str:
    """Synthetic EUI-64 in a range no real vendor uses for these devices, stable for the n-th address."""
    return "aa:bb:cc:dd:" + ":".join(f"{(n >> s) & 255:02x}" for s in (24, 16, 8, 0))


def walk(obj, fn):
    """Apply fn to every string in a JSON structure, depth first; dict keys stay as they are."""
    if isinstance(obj, dict):
        return {k: walk(v, fn) for k, v in obj.items()}
    if isinstance(obj, list):
        return [walk(v, fn) for v in obj]
    return fn(obj) if isinstance(obj, str) else obj


def build_mapping(responses: dict) -> dict[str, str]:
    """Every identifying string and its replacement; exact values, so unrelated text is never touched."""
    mapping: dict[str, str] = {}
    euis: dict[str, None] = {}  # insertion order = first appearance, so the numbering reveals nothing about the values
    walk(responses, lambda s: euis.setdefault(s.lower()) or s if EUI64.match(s) else s)
    for i, eui in enumerate(euis, 1):
        mapping[eui] = fake_eui(i)
        mapping["0x" + eui.replace(":", "")] = "0x" + fake_eui(i).replace(":", "")

    counters: dict[str, int] = {}
    for device in responses.get("zha/devices", []):
        role = ROLE.get(device.get("device_type"), "Device")
        counters[role] = counters.get(role, 0) + 1
        label = role if role == "Coordinator" else f"{role} {counters[role]:02d}"
        if device.get("user_given_name"):
            mapping.setdefault(device["user_given_name"], label)
        for k, entity in enumerate(device.get("entities") or [], 1):
            entity_id = entity.get("entity_id")
            if entity_id:
                mapping.setdefault(entity_id, f"{entity_id.split('.', 1)[0]}.{label.lower().replace(' ', '_')}_{k}")
        if device.get("device_reg_id"):
            mapping.setdefault(device["device_reg_id"], f"device{len(mapping):04d}")

    for n, area in enumerate(responses.get("config/area_registry/list", []), 1):
        for value in (area.get("area_id"), area.get("name")):
            if value:
                mapping.setdefault(value, f"area_{n:02d}")
    for n, entry in enumerate(responses.get("config_entries/get", []), 1):
        if entry.get("entry_id"):
            mapping.setdefault(entry["entry_id"], f"entry_{n:02d}")
    return mapping


def naive_utc(stamp: str) -> dt.datetime:
    """Parse an ISO time; times with a zone are converted to UTC and the zone dropped, so all compare alike."""
    when = dt.datetime.fromisoformat(stamp)
    return when.astimezone(dt.timezone.utc).replace(tzinfo=None) if when.tzinfo else when


def shift_times(responses: dict) -> dict:
    """Move every last_seen so the newest lands on ANCHOR; only the gaps between devices carry information."""
    stamps = [naive_utc(d["last_seen"]) for d in responses.get("zha/devices", []) if d.get("last_seen")]
    if not stamps:
        return responses
    delta = ANCHOR - max(stamps)
    for device in responses.get("zha/devices", []):
        if device.get("last_seen"):
            device["last_seen"] = (naive_utc(device["last_seen"]) + delta).isoformat(timespec="seconds")
    return responses


def anonymize(capture: dict) -> dict:
    """Return an anonymized copy of the capture; raises ValueError if any replaced value survives."""
    responses = json.loads(json.dumps(capture["responses"]))
    zha_ids = {d.get("device_reg_id") for d in responses.get("zha/devices", [])}
    responses["config/device_registry/list"] = [
        {k: v for k, v in d.items() if k != "name_by_user"}
        for d in responses.get("config/device_registry/list", [])
        if d.get("id") in zha_ids
    ]
    for device in responses.get("zha/devices", []):
        for entity in device.get("entities") or []:
            entity.pop("name", None)  # may be a name the user typed; the entity id says enough
    for entry in responses.get("config_entries/get", []):
        entry["title"] = ""

    mapping = build_mapping(responses)
    lower = {k.lower(): v for k, v in mapping.items()}
    out = walk(responses, lambda s: mapping.get(s, lower.get(s.lower(), s)))
    out = shift_times(out)

    text = json.dumps(out, ensure_ascii=False).lower()
    probes = set(mapping) | {k[2:] for k in mapping if k.startswith("0x")}  # addresses also as bare hex
    # long values as substrings; short ones ("WC", "Bad") only as whole words, or every model name would match
    leaks = sorted(p for p in probes if (p.lower() in text if len(p) >= 4 else re.search(rf"\b{re.escape(p.lower())}\b", text)))
    if leaks:
        raise ValueError(f"{len(leaks)} replaced values still present, e.g. {leaks[0][:4]}…")
    return {"hass_version": capture.get("hass_version"), "language": capture.get("language"), "responses": out}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("capture", type=Path)
    parser.add_argument("fixture", type=Path)
    args = parser.parse_args()
    try:
        fixture = anonymize(json.loads(args.capture.read_text(encoding="utf-8")))
    except ValueError as exc:
        print(f"refused: {exc}", file=sys.stderr)
        return 1
    args.fixture.write_text(json.dumps(fixture, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    devices = fixture["responses"].get("zha/devices", [])
    print(f"{len(devices)} devices anonymized -> {args.fixture}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
