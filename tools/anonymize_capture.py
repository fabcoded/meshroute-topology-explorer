#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Turn a Home Assistant capture into an anonymized test fixture.

  python3 tools/anonymize_capture.py CAPTURE.json FIXTURE.json

A capture holds the answers of the Home Assistant websocket commands the panel reads, under "responses":
`zha/devices`, `config/device_registry/list`, `config/area_registry/list`, `config_entries/get` and, for Thread,
`matter/network_topology` (spec 3.2). Everything that identifies a home is replaced: EUI-64 addresses (also in
neighbour tables, extended PAN ids and hex form; Thread extended addresses as bare hex, also inside border-router ids
such as "br_<address>"), user-given device names, area ids and names, entity ids, registry and config-entry ids, Thread
network names and border-router host names; entity names are dropped; registry entries that are neither ZHA devices
nor Matter nodes of the topology are left out, and a Matter node's registry name becomes "Matter node <id>"; times
are shifted so the newest is 2026-01-01T12:00:00 (ZHA) and the topology's collection time lands there too (Thread),
gaps kept. Kept for testing: device types, vendors, models, NWK addresses and RLOC16, LQI and RSSI, relationships,
roles, routes, clusters.
Before writing, the output is searched for every replaced value; any hit aborts and nothing is written.

Allow-list: only the fields listed in SCHEMAS below survive, per response and per nested object (device, neighbour,
route, entity, signature, registry entry, area, config entry). Anything else, including fields a future Home
Assistant adds, is dropped before the replacement runs, so a new field that holds a name or address can never slip
into a fixture unseen. A new field the panel needs is added to the list on purpose.
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


# Allow-list per response. A schema is a dict {field: sub-schema | None}; None keeps a plain value (a scalar, or a list
# of scalars and lists). Free text in kept fields is still covered by the replacement and the leak check.
_ENDPOINT = {"profile_id": None, "device_type": None, "input_clusters": None, "output_clusters": None}
_SIGNATURE = {
    "node_descriptor": {k: None for k in (
        "logical_type", "complex_descriptor_available", "user_descriptor_available", "reserved", "aps_flags",
        "frequency_band", "mac_capability_flags", "manufacturer_code", "maximum_buffer_size",
        "maximum_incoming_transfer_size", "server_mask", "maximum_outgoing_transfer_size",
        "descriptor_capability_field")},
    "endpoints": ("map", _ENDPOINT),  # keyed by endpoint id
    "manufacturer": None,
    "model": None,
}
SCHEMAS = {
    "zha/devices": ("list", {
        **{k: None for k in (
            "ieee", "nwk", "manufacturer", "model", "name", "quirk_applied", "quirk_class", "exposes_features",
            "manufacturer_code", "power_source", "lqi", "rssi", "last_seen", "available", "device_type",
            "active_coordinator", "user_given_name", "device_reg_id", "area_id")},
        "signature": _SIGNATURE,
        "entities": ("list", {"entity_id": None}),  # entity names may be typed by the user: not kept
        "endpoint_names": ("list", {"name": None}),
        "neighbors": ("list", {k: None for k in (
            "ieee", "nwk", "lqi", "relationship", "depth", "device_type", "rx_on_when_idle", "permit_joining",
            "extended_pan_id")}),
        "routes": ("list", {k: None for k in (
            "dest_nwk", "next_hop", "route_status", "many_to_one", "route_record_required", "memory_constrained")}),
    }),
    "config/device_registry/list": ("list", {k: None for k in ("id", "identifiers", "area_id", "name", "manufacturer", "model")}),
    "config/area_registry/list": ("list", {k: None for k in ("area_id", "name")}),
    "config_entries/get": ("list", {k: None for k in ("entry_id", "domain", "title", "state")}),
    # Thread through Matter (spec 3.2; schema of matter.js server, packages/ws-client/src/models/model.ts).
    "matter/network_topology": {
        "collected_at": None,
        "nodes": ("list", {k: None for k in (
            "id", "kind", "network_type", "node_id", "role", "available", "is_bridge", "ext_address", "rloc16",
            "ext_pan_id", "network_name", "vendor_name", "model_name", "last_seen", "ha_device_id", "host_name")}),
        "connections": ("list", {
            **{k: None for k in ("source", "target", "network", "strength", "via_route_table", "path_cost")},
            "source_to_target": {k: None for k in ("strength", "lqi", "rssi")},
            "target_to_source": {k: None for k in ("strength", "lqi", "rssi")},
        }),
    },
}
THREAD_EXT = re.compile(r"^(?:0x)?[0-9a-f]{16}$", re.IGNORECASE)
TOPOLOGY = "matter/network_topology"


def _plain(value) -> bool:
    """A scalar, or a list made of scalars and such lists (identifiers, cluster ids); never a dict."""
    return not isinstance(value, dict) and (not isinstance(value, list) or all(_plain(v) for v in value))


def apply_schema(value, schema):
    """Copy of `value` reduced to the fields in `schema`; ('list'|'map', fields) applies fields to each item."""
    if schema is None:
        return value if _plain(value) else None
    if isinstance(schema, tuple):
        kind, fields = schema
        if kind == "list":
            return [apply_schema(v, fields) for v in value if isinstance(v, dict)] if isinstance(value, list) else []
        return {k: apply_schema(v, fields) for k, v in value.items() if isinstance(v, dict)} if isinstance(value, dict) else {}
    if value is None:
        return None  # an absent object stays absent (a Thread direction nobody reported is null, not {})
    if not isinstance(value, dict):
        return {}
    return {k: apply_schema(v, schema[k]) for k, v in value.items() if k in schema}


def allow_list(responses: dict) -> dict:
    """Keep only known responses and, inside them, only known fields; everything else is dropped."""
    return {name: apply_schema(responses[name], schema) for name, schema in SCHEMAS.items() if name in responses}


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

    _thread_mapping(responses, mapping)

    for n, area in enumerate(responses.get("config/area_registry/list", []), 1):
        for value in (area.get("area_id"), area.get("name")):
            if value:
                mapping.setdefault(value, f"area_{n:02d}")
    for n, entry in enumerate(responses.get("config_entries/get", []), 1):
        if entry.get("entry_id"):
            mapping.setdefault(entry["entry_id"], f"entry_{n:02d}")
    return mapping


def fake_ext(n: int) -> str:
    """Synthetic Thread extended address (bare hex, as the topology writes it), stable for the n-th address."""
    return "aabbccdd" + f"{n:08x}"


def _topology(responses: dict) -> dict:
    value = responses.get(TOPOLOGY)
    return value if isinstance(value, dict) else {}


def _thread_mapping(responses: dict, mapping: dict) -> None:  # noqa: PLR0912 - existing; see plan-qualitaet S6
    """Replacements for the Thread topology: extended addresses (bare hex, any case, also inside "br_<address>"
    ids), extended PAN ids, network names, border-router host names and Home Assistant device ids."""
    topo = _topology(responses)
    nodes = [n for n in topo.get("nodes", []) if isinstance(n, dict)]
    addresses: dict[str, None] = {}
    for node in nodes:
        for key in ("ext_address",):
            value = node.get(key)
            if isinstance(value, str) and THREAD_EXT.match(value):
                addresses.setdefault(value.lower().removeprefix("0x"))
        ident = node.get("id")
        if isinstance(ident, str) and "_" in ident and THREAD_EXT.match(ident.rsplit("_", 1)[1]):
            addresses.setdefault(ident.rsplit("_", 1)[1].lower())
    offset = sum(1 for k in mapping if EUI64.match(k))  # numbers continue after the ZHA addresses
    for i, address in enumerate(addresses, offset + 1):
        mapping[address] = fake_ext(i)
        mapping[address.upper()] = fake_ext(i).upper()
    for node in nodes:
        ident = node.get("id")
        if isinstance(ident, str) and "_" in ident:
            prefix, tail = ident.rsplit("_", 1)
            if tail.lower() in mapping:
                mapping.setdefault(ident, f"{prefix}_{mapping[tail.lower()].upper()}")
    for n, pan in enumerate(dict.fromkeys(str(x.get("ext_pan_id")) for x in nodes if x.get("ext_pan_id")), 1):
        mapping.setdefault(pan, f"aabbccddeeff00{n:02x}")  # synthetic like every fixture address (test_fixture)
    for n, name in enumerate(dict.fromkeys(str(x.get("network_name")) for x in nodes if x.get("network_name")), 1):
        mapping.setdefault(name, f"thread-net-{n:02d}")
    for n, host in enumerate(dict.fromkeys(str(x.get("host_name")) for x in nodes if x.get("host_name")), 1):
        mapping.setdefault(host, f"border-router-{n:02d}")
    for node in nodes:
        reg = node.get("ha_device_id")
        if isinstance(reg, str) and reg:
            mapping.setdefault(reg, f"device{len(mapping):04d}")


def _thread_registry(responses: dict) -> None:
    """Registry entries of the topology's Matter nodes stay (names for the map), with the registry name replaced by
    "Matter node <node id>": a Matter node label can be typed by the user."""
    nodes = {n.get("ha_device_id"): n for n in _topology(responses).get("nodes", [])
             if isinstance(n, dict) and n.get("ha_device_id")}
    for entry in responses.get("config/device_registry/list", []):
        node = nodes.get(entry.get("id"))
        if node is not None:
            label = f"{node.get('node_id') if node.get('node_id') is not None else '?'}"
            entry["name"] = f"Matter node {label}"
            # Matter identifiers carry the fabric id ("deviceid_<fabric>-<node>"): replaced as a whole.
            entry["identifiers"] = [["matter", f"node-{label}"]]


def _shift_topology(responses: dict) -> None:
    """Move the topology's times (milliseconds since the epoch) so its collection time lands on ANCHOR, gaps kept."""
    topo = responses.get(TOPOLOGY)
    if not isinstance(topo, dict) or not isinstance(topo.get("collected_at"), (int, float)):
        return
    anchor = int(ANCHOR.replace(tzinfo=dt.UTC).timestamp() * 1000)
    delta = anchor - int(topo["collected_at"])
    topo["collected_at"] = anchor
    for node in topo.get("nodes", []):
        if isinstance(node.get("last_seen"), (int, float)):
            node["last_seen"] = int(node["last_seen"]) + delta


def naive_utc(stamp: str) -> dt.datetime:
    """Parse an ISO time; times with a zone are converted to UTC and the zone dropped, so all compare alike."""
    when = dt.datetime.fromisoformat(stamp)
    return when.astimezone(dt.UTC).replace(tzinfo=None) if when.tzinfo else when


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
    responses = allow_list(capture["responses"])
    zha_ids = {d.get("device_reg_id") for d in responses.get("zha/devices", [])}
    matter_ids = {n.get("ha_device_id") for n in _topology(responses).get("nodes", []) if isinstance(n, dict)}
    # Only ZHA devices and the topology's Matter nodes stay in the registry (name_by_user and everything not
    # allow-listed is already gone).
    responses["config/device_registry/list"] = [
        d for d in responses.get("config/device_registry/list", []) if d.get("id") in zha_ids | (matter_ids - {None})
    ]
    _thread_registry(responses)
    for entry in responses.get("config_entries/get", []):
        entry["title"] = ""

    mapping = build_mapping(responses)
    lower = {k.lower(): v for k, v in mapping.items()}
    out = walk(responses, lambda s: mapping.get(s, lower.get(s.lower(), s)))
    out = shift_times(out)
    _shift_topology(out)

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
    nodes = _topology(fixture["responses"]).get("nodes", [])
    print(f"{len(devices)} ZHA devices and {len(nodes)} Thread nodes anonymized -> {args.fixture}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
