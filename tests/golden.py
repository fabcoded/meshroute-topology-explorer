# SPDX-License-Identifier: MIT
"""Golden files: what the Python side writes, committed under tests/fixtures/golden/ and read by the JavaScript tests
too, so a change on one side shows on the other. MESHROUTE_UPDATE_GOLDENS=1 python3 -m unittest discover -s tests
rewrites them; review the diff, then commit."""

import json
import os
from pathlib import Path

DIR = Path(__file__).parent / "fixtures" / "golden"


def check(test, name, text):
    """Compare `text` with the golden `name`; with MESHROUTE_UPDATE_GOLDENS=1 write it instead."""
    path = DIR / name
    if os.environ.get("MESHROUTE_UPDATE_GOLDENS") == "1":
        path.write_text(text, encoding="utf-8")
    test.assertEqual(text, path.read_text(encoding="utf-8"), f"{name} differs; rerun with MESHROUTE_UPDATE_GOLDENS=1")


def dumps(obj):
    return json.dumps(obj, indent=1, sort_keys=True) + "\n"
