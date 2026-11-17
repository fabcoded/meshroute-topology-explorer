#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Build the static demo site for GitHub Pages: the landing page and the dev page in demo mode.

  python3 tools/build_demo_site.py [--out _site]

Copies an allow-list of committed files into OUT in the repository's layout (dev/panel.html loads the panel, the fake
Home Assistant and the samples by relative path) and demo/index.html as OUT/index.html. Only files tracked by git are
copied, so captures/ (real networks, git-ignored) can never reach the site; the script also refuses any path under
captures/ outright. How to preview it locally: docs/development.md, section "Online demo".
"""

from __future__ import annotations

import argparse
import fnmatch
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FRONTEND = "custom_components/meshroute_topology_explorer"
# What the demo needs: "*" stays inside one directory, a trailing "/**" takes everything below. Demo mode reads no
# sample fixture, so the anonymized captures under tests/fixtures/ stay off the site.
ALLOWED = (
    "dev/panel.html",
    "dev/panel-demo.js",
    "tests/derive.mjs",
    "tests/zigpy-fake.mjs",
    "demo/demo-network.mjs",
    f"{FRONTEND}/manifest.json",
    f"{FRONTEND}/brand/icon.png",
    f"{FRONTEND}/frontend/**",
)
LANDING = "demo/index.html"


def tracked_files() -> list[str]:
    """Every file git tracks, as repository-relative POSIX paths."""
    out = subprocess.run(["git", "ls-files", "-z"], cwd=ROOT, check=True, capture_output=True).stdout  # noqa: S607 - git from PATH
    return [p for p in out.decode().split("\0") if p]


def allowed(path: str) -> bool:
    """True if path matches an entry of ALLOWED; "*" does not cross a slash, a trailing "/**" takes everything below."""
    for pattern in ALLOWED:
        if pattern.endswith("/**"):
            if path.startswith(pattern[:-2]):
                return True
        elif fnmatch.fnmatchcase(path, pattern) and path.count("/") == pattern.count("/"):
            return True
    return False


def refuse_unsafe(out: Path) -> None:
    """Stop before emptying a folder that holds sources: the repository or a folder above it, or a folder inside it
    other than _site (a mistyped --out . or --out demo would delete tracked files)."""
    inside = out.is_relative_to(ROOT) and out != ROOT
    if ROOT.is_relative_to(out) or (inside and out.relative_to(ROOT).parts[0] != "_site"):
        raise SystemExit(f"refusing to empty {out}: choose _site/... or a folder outside the repository")


def build(out: Path) -> list[str]:
    """Copy the allowed tracked files and the landing page into out (emptied first); returns the copied paths."""
    refuse_unsafe(out)
    files = [p for p in tracked_files() if allowed(p)]
    leaked = [p for p in files if p.split("/", 1)[0] == "captures"]
    if leaked:
        raise SystemExit(f"refusing to publish real captures: {leaked}")
    if LANDING not in tracked_files():
        raise SystemExit(f"{LANDING} is not committed")
    if out.exists():
        shutil.rmtree(out)
    for path in files:
        target = out / path
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / path, target)
    shutil.copyfile(ROOT / LANDING, out / "index.html")
    return [*files, "index.html"]


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
