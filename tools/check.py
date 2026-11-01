#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Run development checks without devices. Usage: python3 tools/check.py; see CONTRIBUTING.md.

Fail before running tests on an unsupported toolchain or missing lint dependencies, so a partial run is not
mistaken for CI parity. Commands are deliberately the same as CI; hooks are not a replacement for unit tests.
"""

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main() -> int:
    if sys.version_info[:2] != (3, 13):
        print("Use Python 3.13, matching CI.", file=sys.stderr)
        return 1
    for command in ("pre-commit", "node", "npm"):
        if shutil.which(command) is None:
            print(f"Missing {command}; follow CONTRIBUTING.md setup.", file=sys.stderr)
            return 1
    node = subprocess.run(["node", "--version"], check=True, capture_output=True, text=True).stdout.strip()
    version = tuple(int(part) for part in node.removeprefix("v").split(".")[:2])
    if version[0] != 22 or version[1] < 13:
        print(f"Use Node.js 22.13 or newer in the 22.x series; found {node}.", file=sys.stderr)
        return 1
    if not (ROOT / "node_modules/eslint/bin/eslint.js").is_file():
        print("Missing ESLint; run npm ci.", file=sys.stderr)
        return 1
    for command in (
        ["pre-commit", "run", "--all-files"],
        [sys.executable, "-m", "unittest", "discover", "-s", "tests", "-v"],
        ["npm", "test"],
        ["npm", "run", "test:performance"],
    ):
        print(f"Running: {' '.join(command)}", flush=True)
        result = subprocess.run(command, cwd=ROOT, check=False)
        if result.returncode:
            return result.returncode
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
