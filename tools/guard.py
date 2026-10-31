#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Repository guard: no network keys, no writes to the radio, no outside requests from shipped code, SPDX lines.

  python3 tools/guard.py [ROOT]

- No file may name Home Assistant commands or Python helpers that return network keys or change the network
  (DENY, matched as prefixes). The only radio traffic the project may cause is a scan the user starts, which goes
  through `zha/topology/update`.
- Files Home Assistant serves (everything under custom_components/, any text format) must not contain outside URLs,
  including ws://, wss:// and protocol-relative ones; a map background URL comes from user configuration, never from
  code. URL_ALLOW is matched exactly up to a path boundary.
- Every .py, .js and .mjs file carries `SPDX-License-Identifier` in its first three lines. Vendored files under a
  `vendor/` folder keep their own licence header and are exempt from SPDX and URL checks.
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
    "thread/set_", "thread/add_dataset", "thread/delete_dataset", "matter/set_", "matter/commission", "matter/remove",
)
SOURCE = (".py", ".js", ".mjs")
TEXT = SOURCE + (".html", ".css", ".json", ".svg", ".yaml", ".yml", ".md", ".txt")
URL = re.compile(r"""(?:(?:https?|wss?):|(?<=['"`(=\s]))//[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d+)?[^\s'"`)<>]*""", re.IGNORECASE)
URL_ALLOW = ("https://github.com/fabcoded/meshroute-topology-explorer",)
SELF = {"tools/guard.py", "tests/test_guard.py"}  # they have to spell out the deny-list
SKIP_DIRS = {".git", "node_modules", "__pycache__", ".venv", "venv"}


def allowed(url: str) -> bool:
    """True if url is an allow-listed address or a path below it (no lookalike hosts or names)."""
    return any(url == base or url.startswith(base + "/") for base in URL_ALLOW)


def files(root: Path):
    for path in sorted(root.rglob("*")):
        if path.is_file() and not SKIP_DIRS & set(path.relative_to(root).parts):
            yield path


def check(root: Path) -> list[str]:
    """All findings as 'path:line: message', sorted by path."""
    findings = []
    for path in files(root):
        rel = path.relative_to(root).as_posix()
        if path.suffix not in TEXT:
            continue
        vendored = "vendor" in path.parts
        shipped = rel.startswith("custom_components/") and not vendored
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        if path.suffix in SOURCE and not vendored and not any("SPDX-License-Identifier" in line for line in lines[:3]):
            findings.append(f"{rel}:1: missing SPDX-License-Identifier in the first three lines")
        for n, line in enumerate(lines, 1):
            if rel not in SELF and (path.suffix in SOURCE or shipped):
                for term in DENY:
                    if term in line:
                        findings.append(f"{rel}:{n}: names {term}, which returns network keys or changes the network")
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
