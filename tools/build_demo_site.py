#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Build the static demo site for GitHub Pages: the landing page and the dev page in demo mode.

  python3 tools/build_demo_site.py [--out _site]

Copies a fixed list of committed files into OUT in the repository's layout (dev/panel.html loads the panel, the fake
Home Assistant and the samples by relative path) and demo/index.html as OUT/index.html. Only files tracked by git are
copied, so captures/ (real networks, git-ignored) can never reach the site. How to preview it locally:
docs/development.md, section "Online demo".
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FRONTEND = "custom_components/meshroute_topology_explorer"
# What the demo needs. Demo mode reads no sample fixture, so the anonymized captures under tests/fixtures/ stay off
# the site.
FILES = (
    "dev/panel.html",
    "dev/panel-demo.js",
    "tests/derive.mjs",
    "tests/zigpy-fake.mjs",
    "demo/demo-network.mjs",
    "demo/index.html",
    f"{FRONTEND}/manifest.json",
    f"{FRONTEND}/brand/icon.png",
)
PREFIX = f"{FRONTEND}/frontend/"
LANDING = "demo/index.html"


def tracked_files() -> list[str]:
    """Every file git tracks, as repository-relative POSIX paths."""
    out = subprocess.run(["git", "ls-files", "-z"], cwd=ROOT, check=True, capture_output=True).stdout  # noqa: S607 - git from PATH
    return [p for p in out.decode().split("\0") if p]


def refuse_unsafe(out: Path) -> None:
    """Stop before emptying a folder that holds sources: the repository or a folder above it, or a folder inside it
    other than _site (a mistyped --out . or --out demo would delete tracked files)."""
    inside = out.is_relative_to(ROOT) and out != ROOT
    if ROOT.is_relative_to(out) or (inside and out.relative_to(ROOT).parts[0] != "_site"):
        raise SystemExit(f"refusing to empty {out}: choose _site/... or a folder outside the repository")


def build(out: Path) -> list[str]:
    """Copy the allowed tracked files and the landing page into out (emptied first); returns the copied paths."""
    refuse_unsafe(out)
    tracked = tracked_files()
    files = [p for p in tracked if p in FILES or p.startswith(PREFIX)]
    missing = [p for p in FILES if p not in tracked]
    if missing:
        raise SystemExit(f"not committed: {missing}")
    if out.exists():
        shutil.rmtree(out)
    copied = []
    for path in files:
        name = "index.html" if path == LANDING else path
        target = out / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / path, target)
        copied.append(name)
    return copied


def main() -> int:
    parser = argparse.ArgumentParser(description="Build the static demo site (landing page plus dev page).")
    parser.add_argument("--out", type=Path, default=ROOT / "_site", help="output directory, emptied first (default _site)")
    args = parser.parse_args()
    copied = build(args.out.resolve())
    size = sum((args.out / p).stat().st_size for p in copied)
    print(f"demo site: {len(copied)} files, {size / 1e6:.1f} MB in {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
