#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Repository guard: no network keys, no writes to the radio, no outside requests from shipped code, SPDX lines.

  python3 tools/guard.py [ROOT]

- No file may name Home Assistant commands or Python helpers that return network keys or change the network
  (DENY, matched as prefixes), nor ZHA's cluster, binding and attribute-writing commands and services. The only radio
  traffic the project may cause is a scan the user starts (`zha/topology/update`) and, since 2026-11-01, reading a cluster's attributes once on the user's request: `zha/devices/clusters/attributes/value`
  is the one exception to the `zha/devices/clusters` prefix, and only as that exact quoted literal (DENY_EXCEPT).
- Files Home Assistant serves (everything under custom_components/, any text format) must not contain outside URLs,
  including ws://, wss:// and protocol-relative ones; a map background URL comes from user configuration, never from
  code. URL_ALLOW is matched exactly up to a path boundary. NAMESPACES are XML namespace names, matched exactly: they
  name a vocabulary and are never fetched, and document.createElementNS() needs the SVG one to draw icons.
- Shipped Python may read zigpy's route records (custom_components/*/zigpy_routes.py: each device's address and relay
  list) and nothing else of zigpy or ZHA: PY_DENY names the internals that
  hold network settings, keys or their saved copies, and the calls that send to the radio or change the network.
- Every .py, .js and .mjs file carries `SPDX-License-Identifier` in its first three lines. Vendored files under a
  `vendor/` folder keep their own licence header and are exempt from SPDX and URL checks.
- Shipped files (everything under custom_components/ except vendor/) may only have the extensions in SHIPPED_EXT.
- Every command-like string literal ('x/y' in single, double or backtick quotes; literals joined with + are merged
  first) must be on the allow-list of spec 3.4 (ALLOWED_COMMANDS, or below the project's own
  `meshroute_topology_explorer/` namespace). MIME types are skipped. A call to callWS/sendMessage/subscribeMessage
  whose argument is built by concatenation or a template, and a computed ["type"] key, are findings because the
  command cannot be resolved by reading.
- Thread through Matter (spec 3.2): `matter/network_topology` is read with `refresh: false` (the server's
  cached snapshot). `refresh: true` makes the Matter server read every node's tables over the radio: only a button
  the user presses may send it, and none exists yet, so a literal `refresh: true` (or `"refresh": True`) in shipped
  code is a finding (REFRESH_TRUE). Thread dataset, TLV and OTBR commands stay denied (DENY: `thread/get_dataset`,
  `otbr/`, `async_get_active_dataset_tlvs`).
- Shipped code must not use callService(, callApi(, fetch(, XMLHttpRequest, WebSocket(, EventSource, sendBeacon (other
  ways to reach Home Assistant or the network) nor HTML sinks (innerHTML, outerHTML, insertAdjacentHTML,
  document.write, unsafeHTML, eval(, new Function). There is no allow mechanism: if a legitimate need appears, extend
  the rule here with a reason.
Exit code 1 with one line per finding. Rules: AGENTS.md.
"""

import re
import sys
from pathlib import Path

DENY = (
    # return network keys or backups
    "zha/network/", "otbr/", "thread/get_dataset", "network_key", "tc_link_key",
    "async_get_active_dataset_tlvs", "async_get_preferred_dataset",
    # change the network or its devices
    "zha/devices/permit", "zha/devices/remove", "zha/devices/reconfigure", "zha/topology/permit",
    "zha/devices/clusters", "zha/devices/bind", "zha/devices/unbind", "zha/groups/", "zha/group/", "zha/configuration/",
    "matter/open_commissioning_window", "thread/set_", "thread/add_dataset", "thread/delete_dataset", "matter/set_",
    "matter/commission", "matter/remove",
    # ZHA services that write attributes, send cluster commands, bind or sound a warning device
    "set_zigbee_cluster_attribute", "issue_zigbee_", "issue_direct_zigbee_", "service_zigbee_bind", "warning_device_",
)
# Shipped Python only (it runs inside Home Assistant next to zigpy): internals beyond the route records (spec 3.4).
PY_DENY = (
    # hold network settings, keys or saved copies of them
    "network_info", "node_info", "backups", ".state", "CONF_NWK", "get_zha_data", "yaml_config",
    # send to the radio or change the network or its devices
    "permit", "form_network", "reset_network", "write_network", "load_network", "send_packet", "request(", "broadcast(",
    "energy_scan", ".topology", "scan(", "zdo", "bind(", "write_attributes", "read_attributes", ".remove(", "leave(",
)
# Exact commands exempt from DENY: reading one attribute value, started by the user (spec 1, 3.4). Matched only as a
# whole quoted literal, so a longer command, a concatenation or a template that starts the same way stays denied.
DENY_EXCEPT = ("zha/devices/clusters/attributes/value",)
EXCEPT_LITERAL = re.compile("|".join(q + re.escape(c) + q for c in DENY_EXCEPT for q in ("'", '"', "`")))
# Spec 3.4, v1 and "later" rows: the only commands shipped code may name (the DENY list above still applies first).
ALLOWED_COMMANDS = {
    "config/area_registry/list", "config/device_registry/list", "config_entries/get", "zha/devices",
    "zha/topology/update", "zha/devices/clusters/attributes/value", "matter/network_topology",
    "matter/subscribe_network_topology",
    "thread/discover_routers", "thread/list_datasets", "mqtt/subscribe",
}
OWN_NAMESPACE = "meshroute_topology_explorer/"
# A command-like literal: starts with a name, has a slash, no spaces ("./a.js", "/abs/path" and URLs do not match).
LITERAL = re.compile(r"""(["'`])([A-Za-z_][A-Za-z0-9_.*-]*/[A-Za-z0-9_/.*-]*)\1""")
JOIN = re.compile(r"""(["'`])([^"'`]*)\1\s*\+\s*(["'`])([^"'`]*)\3""")
CALL = re.compile(r"\b(?:callWS|sendMessage|subscribeMessage)\b")
UNRESOLVED = re.compile(r"""\$\{|["'`]\s*\+|\+\s*["'`]|\[\s*["']type["']\s*\]""")
FORBIDDEN_CALL = re.compile(
    r"\b(?:callService|callApi|fetch)\s*\(|\bXMLHttpRequest\b|\bWebSocket\s*\(|\bEventSource\b|\bsendBeacon\b")
REFRESH_TRUE = re.compile(r"""["']?refresh["']?\s*:\s*(?:true|True|!0)\b""")
HTML_SINK = re.compile(
    r"\b(?:innerHTML|outerHTML|insertAdjacentHTML|unsafeHTML)\b|\bdocument\s*\.\s*write\b|\beval\s*\(|\bnew\s+Function\b")
NOT_COMMANDS = ("text/", "application/", "image/", "font/", "audio/", "video/")
SOURCE = (".py", ".js", ".mjs", ".cjs")
SHIPPED_EXT = {".png", ".json", ".js", ".mjs", ".py", ".css", ".svg", ".html", ".md"}
TEXT = SOURCE + (".html", ".css", ".json", ".svg", ".yaml", ".yml", ".md", ".txt")
URL = re.compile(r"""(?:(?:https?|wss?):|(?<=['"`(=\s]))//[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d+)?[^\s'"`)<>]*""", re.IGNORECASE)
URL_ALLOW = ("https://github.com/fabcoded/meshroute-topology-explorer",)
NAMESPACES = ("http://www.w3.org/2000/svg",)
SELF = {"tools/guard.py", "tests/test_guard.py"}  # they have to spell out the deny-list
SKIP_DIRS = {".git", "node_modules", "__pycache__", ".venv", "venv"}


def allowed(url: str) -> bool:
    """True if url is an allow-listed address or a path below it (no lookalike hosts or names)."""
    return url in NAMESPACES or any(url == base or url.startswith(base + "/") for base in URL_ALLOW)


def content_findings(line: str) -> list[str]:
    """Messages for one line of shipped code: unlisted commands, unresolvable commands, forbidden calls, HTML sinks."""
    out = []
    merged = line
    while (joined := JOIN.sub(lambda m: m.group(1) + m.group(2) + m.group(4) + m.group(1), merged)) != merged:
        merged = joined  # "zha" + "/devices/bind" is read as one literal
    for _, cmd in LITERAL.findall(merged):
        if not (cmd in ALLOWED_COMMANDS or cmd.startswith(OWN_NAMESPACE) or cmd.startswith(NOT_COMMANDS)):
            out.append(f"command {cmd} is not on the allow-list (spec 3.4)")
    if CALL.search(merged) and UNRESOLVED.search(merged):
        out.append("command built by concatenation, template or computed key: use a plain string literal")
    elif UNRESOLVED.search(merged) and re.search(r"\[\s*[\"']type[\"']\s*\]", merged):
        out.append("computed 'type' key: use a plain string literal")
    if FORBIDDEN_CALL.search(merged):
        out.append("call that could reach Home Assistant or the network outside the allow-list (spec 3.4)")
    if REFRESH_TRUE.search(merged):
        out.append("refresh: true causes radio traffic (Matter topology); only a user's button may send it (spec 3.2)")
    if HTML_SINK.search(merged):
        out.append("HTML sink or dynamic code: names must be set as text (AGENTS.md)")
    return out


def files(root: Path):
    for path in sorted(root.rglob("*")):
        if path.is_file() and not SKIP_DIRS & set(path.relative_to(root).parts):
            yield path


def check(root: Path) -> list[str]:
    """All findings as 'path:line: message', sorted by path."""
    findings = []
    for path in files(root):
        rel = path.relative_to(root).as_posix()
        vendored = "vendor" in path.parts
        shipped = rel.startswith("custom_components/") and not vendored
        if shipped and path.suffix not in SHIPPED_EXT:
            findings.append(f"{rel}:1: file type {path.suffix or '(none)'} is not allowed in shipped files")
            continue
        if path.suffix not in TEXT and not (shipped and path.suffix in SOURCE):
            continue
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        if path.suffix in SOURCE and not vendored and not any("SPDX-License-Identifier" in line for line in lines[:3]):
            findings.append(f"{rel}:1: missing SPDX-License-Identifier in the first three lines")
        for n, line in enumerate(lines, 1):
            denied = False
            if rel not in SELF and (path.suffix in SOURCE or shipped):
                rest = EXCEPT_LITERAL.sub("", line)
                for term in DENY:
                    if term in rest:
                        denied = True
                        findings.append(f"{rel}:{n}: names {term}, which returns network keys or changes the network")
                for term in PY_DENY if shipped and path.suffix == ".py" else ():
                    if term in line:
                        denied = True
                        findings.append(f"{rel}:{n}: names {term}: zigpy or ZHA internals beyond the route records (spec 3.4)")
            if shipped and not denied:  # one finding per line is enough
                findings.extend(f"{rel}:{n}: {msg}" for msg in content_findings(line))
            if shipped:
                for url in URL.findall(line):
                    if not allowed(url):
                        findings.append(f"{rel}:{n}: outside URL {url}")
    return findings


def main() -> int:
    root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent
    findings = check(root)
    for finding in findings:
        print(finding)
    print(f"guard: {len(findings)} finding(s)")
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
