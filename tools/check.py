#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Run development checks without devices. Usage: python3 tools/check.py [--full]; see CONTRIBUTING.md.

CI runs this script, so a local pass means the same checks as CI; hassfest and HACS validation run only in CI.
It stops on an unsupported toolchain first, so a run on other versions is not mistaken for CI parity. A checkout
without node_modules fails in the ESLint hook with "run npm ci" (package.json lint script).
"""

import importlib.util
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main() -> int:
    full = "--full" in sys.argv[1:]  # --full adds tests_ha (when its package imports) and the browser smoke test (tools/smoke.py, when a Chrome is found)
    if sys.version_info[:2] != (3, 14):
        print("Use Python 3.14, matching CI.", file=sys.stderr)
        return 1
    for command in ("pre-commit", "node", "npm"):
        if shutil.which(command) is None:
            print(f"Missing {command}; follow CONTRIBUTING.md setup.", file=sys.stderr)
            return 1
    node = subprocess.run(["node", "--version"], check=True, capture_output=True, text=True).stdout.strip()  # noqa: S607 - node/npm/pre-commit come from the activated toolchain
    version = tuple(int(part) for part in node.removeprefix("v").split(".")[:2])
    if version[0] != 22 or version[1] < 13:
        print(f"Use Node.js 22.13 or newer in the 22.x series; found {node}.", file=sys.stderr)
        return 1
    for command in (
        ["pre-commit", "run", "--all-files"],
        [sys.executable, "-m", "unittest", "discover", "-s", "tests", "-v"],
        ["npm", "test"],
    ):
        print(f"Running: {' '.join(command)}", flush=True)
        result = subprocess.run(command, cwd=ROOT, check=False)  # noqa: S603 - fixed argument lists above
        if result.returncode:
            return result.returncode
    if full:
        # L2 (tests_ha/) needs the Home Assistant test package, which is not in requirements-dev.txt (it pins
        # Home Assistant); install requirements-ha-latest.txt into a separate environment to run it.
        if importlib.util.find_spec("pytest_homeassistant") or importlib.util.find_spec("pytest_homeassistant_custom_component"):
            print("Running: pytest tests_ha", flush=True)
            result = subprocess.run([sys.executable, "-m", "pytest", "tests_ha", "-q"], cwd=ROOT, check=False)
            if result.returncode:
                return result.returncode
        else:
            print("Skipping tests_ha: Home Assistant test package not installed (requirements-ha-latest.txt).")
        if not (shutil.which("google-chrome") or shutil.which("chromium") or list(Path.home().glob(".cache/ms-playwright/chromium*"))):
            print("Skipping smoke test: no Chrome found.")
            return 0
        print("Running: tools/smoke.py", flush=True)
        return subprocess.run([sys.executable, "tools/smoke.py"], cwd=ROOT, check=False).returncode
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
