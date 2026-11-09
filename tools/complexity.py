#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Complexity ratchet: no new function above 15, no listed one rising, and the list only shrinks (docs/quality.md).

  python3 tools/complexity.py [FILE ...]   check these files (pre-commit passes the staged ones), or all of them
  python3 tools/complexity.py --update     lower or drop entries of tools/complexity-baseline.json, never add one
  MESHROUTE_COMPLEXITY_UPDATE=1 pre-commit run complexity --all-files      the same where Ruff is only in pre-commit
  python3 tools/complexity.py --seed       write a first baseline; refused while one exists

JavaScript: cognitive complexity from ESLint's sonarjs rule (tools/complexity.mjs). Python: McCabe complexity from
Ruff C901 with --ignore-noqa, so a `noqa: C901` lets no new function in. Functions are keyed by file and qualified
name (Class.method, outer>inner, anonymous callbacks by their call such as test("title"), #2 for a repeat), so moved
lines keep the key; a renamed function is new. Owner decision 2026-11-09 (quality plan S10): the gate blocks.
"""

import ast
import json
import os
import re
import shutil
import subprocess
import sys
from collections import namedtuple
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASELINE = ROOT / "tools/complexity-baseline.json"
LIMIT = 15
JS = (".js", ".mjs", ".cjs")
RUFF_SCORE = re.compile(r"^`(?P<name>[^`]+)` is too complex \((?P<score>\d+) > \d+\)$")
ABOUT = ("Functions above complexity 15 when the gate started blocking (2026-11-09). Scores may only fall; "
         "tools/complexity.py --update lowers and drops entries, new code never goes here.")
UPDATE_HINT = ("python3 tools/complexity.py --update (needs Ruff on PATH) or "
               "MESHROUTE_COMPLEXITY_UPDATE=1 pre-commit run complexity --all-files; both only lower or drop entries, "
               "never add or raise one")

Finding = namedtuple("Finding", "lang file name line score")


def run(cmd):
    """Run a measuring command in the repo root; a crash stops the check, it must never read as no findings."""
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, check=False)  # noqa: S603 - fixed lists
    if r.returncode not in (0, 1):
        sys.exit(f"complexity: {cmd[0]} {cmd[1]} failed (exit {r.returncode}): {(r.stderr or r.stdout).strip()[-400:]}")
    return r


def js_findings(files):
    """JavaScript functions above 15 in `files` (None: the repository) from tools/complexity.mjs."""
    if shutil.which("node") is None:
        sys.exit("complexity: node not found; follow the setup in CONTRIBUTING.md")
    out = run(["node", "tools/complexity.mjs", *(files or [])]).stdout
    return [Finding("js", x["file"], x["name"], x["line"], x["score"]) for x in json.loads(out)]


def ruff_command():
    """Ruff from PATH: the pre-commit hook installs the version pinned in .pre-commit-config.yaml."""
    if shutil.which("ruff") is None:
        sys.exit("complexity: Ruff not found; install the version pinned in .pre-commit-config.yaml, or run "
                 "pre-commit run complexity --all-files")
    return ["ruff"]


def py_names(source):
    """Map (line of the def, bare name) -> qualified name (Class.method, outer>inner) for one Python source."""
    names, seen = {}, {}

    def walk(node, prefix):
        for child in ast.iter_child_nodes(node):
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                full = prefix + child.name
                seen[full] = seen.get(full, 0) + 1
                full += f"#{seen[full]}" if seen[full] > 1 else ""
                if not isinstance(child, ast.ClassDef):
                    names[(child.lineno, child.name)] = full
                walk(child, full + ("." if isinstance(child, ast.ClassDef) else ">"))
            else:
                walk(child, prefix)

    walk(ast.parse(source), "")
    return names


def py_findings(files):
    """Python functions above 15 in `files` (None: the repository) from Ruff C901, noqa ignored."""
    cmd = [*ruff_command(), "check", "--select", "C901", "--ignore-noqa", "--no-cache", "--output-format", "json",
           "--config", f"lint.mccabe.max-complexity = {LIMIT}", *(files or ["."])]
    out = []
    for m in json.loads(run(cmd).stdout):
        file = Path(m["filename"]).resolve().relative_to(ROOT).as_posix()
        hit = RUFF_SCORE.match(m["message"])
        name = hit and py_names((ROOT / file).read_text(encoding="utf-8")).get((m["location"]["row"], hit["name"]))
        if not name:
            sys.exit(f"complexity: cannot name or score {file}:{m['location']['row']}: {m['message']}")
        out.append(Finding("python", file, name, m["location"]["row"], int(hit["score"])))
    return out


def compare(baseline, findings, scope=None):
    """Problems of `findings` against `baseline` ({lang: {file: {name: score}}}) as (kind, finding-like, old score).
    kind: "new" (not listed), "rose" (above its listed score), "stale" (listed, but lower now or gone: the baseline must
    follow). scope: the files that were measured, None for all; listed entries of other files are not judged."""
    problems, current = [], {}
    for f in findings:
        current[(f.lang, f.file, f.name)] = f
        old = baseline.get(f.lang, {}).get(f.file, {}).get(f.name)
        if old is None:
            problems.append(("new", f, None))
        elif f.score > old:
            problems.append(("rose", f, old))
    for lang, files in sorted(baseline.items()):
        for file, entries in sorted(files.items()):
            if scope is not None and file not in scope:
                continue
            for name, old in sorted(entries.items()):
                now = current.get((lang, file, name))
                if now is None or now.score < old:
                    problems.append(("stale", now or Finding(lang, file, name, None, None), old))
    return problems


def updated(baseline, findings):
    """The baseline after --update: every listed function at its current score where that is lower, dropped where it
    is no longer above 15 or gone; a rise keeps the old score (still failing) and nothing new is added."""
    current = {(f.lang, f.file, f.name): f.score for f in findings}
    out = {}
    for lang, files in baseline.items():
        for file, entries in files.items():
            for name, old in entries.items():
                now = current.get((lang, file, name))
                if now is not None:
                    out.setdefault(lang, {}).setdefault(file, {})[name] = min(now, old)
    return out


def seeded(findings):
    """A first baseline from the current findings (--seed, only when none exists)."""
    out = {}
    for f in findings:
        out.setdefault(f.lang, {}).setdefault(f.file, {})[f.name] = f.score
    return out


def message(kind, f, old):
    """One problem as two lines: what and where, then how to fix it."""
    where = f"{f.file}:{f.line}" if f.line else f.file
    if kind == "new":
        return (f"{where} {f.name}: complexity {f.score}, above {LIMIT}\n    split it into named helpers until each is "
                f"{LIMIT} or less; the baseline is not for new code (a pure rename: rename its key in "
                f"{BASELINE.name} in the same commit)")
    if kind == "rose":
        return (f"{where} {f.name}: complexity {f.score}, listed at {old}\n    a listed function may only fall: move "
                f"the part you changed into a named helper")
    state = f"not above {LIMIT} or gone" if f.score is None else f"down to {f.score}"
    return f"{where} {f.name}: listed at {old}, now {state} (stale)"


def load():
    """The committed baseline as {lang: {file: {name: score}}}."""
    if not BASELINE.exists():
        sys.exit(f"complexity: {BASELINE.name} is missing; restore it from git")
    data = json.loads(BASELINE.read_text(encoding="utf-8"))
    return {lang: data.get(lang, {}) for lang in ("js", "python")}


def save(baseline):
    """Write the baseline sorted, one entry per line, so a review sees each change."""
    data = {"about": ABOUT, **{lang: baseline.get(lang, {}) for lang in ("js", "python")}}
    BASELINE.write_text(json.dumps(data, indent=1, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8")


def size(baseline):
    return sum(len(entries) for files in baseline.values() for entries in files.values())


def scope_of(paths):
    """The files to measure, or None for all: a change to the baseline, the measuring config or no file named."""
    if not paths or any(not p.endswith((*JS, ".py")) for p in paths):
        return None
    return {Path(p).as_posix() for p in paths}


def main(argv):
    # Seeding is its own flag and refused while a baseline exists: an update with a deleted file must not seed, or
    # deleting the file would let every new function in.
    seed = "--seed" in argv
    if seed and BASELINE.exists():
        sys.exit(f"complexity: {BASELINE.name} exists; --seed only writes a first one")
    update = "--update" in argv or os.environ.get("MESHROUTE_COMPLEXITY_UPDATE") == "1"
    before = load() if update else None
    scope = None if update or seed else scope_of([a for a in argv if not a.startswith("--")])
    js = None if scope is None else sorted(p for p in scope if p.endswith(JS))
    py = None if scope is None else sorted(p for p in scope if p.endswith(".py"))
    findings = (js_findings(js) if js is None or js else []) + (py_findings(py) if py is None or py else [])
    if seed or update:
        save(seeded(findings) if seed else updated(before, findings))
        was = "seeded" if seed else f"was {size(before)}"
        print(f"complexity: {BASELINE.relative_to(ROOT).as_posix()} lists {size(load())} functions ({was})")
    problems = compare(load(), findings, scope)
    if problems:
        print(f"complexity: {len(problems)} problem(s). Limit {LIMIT}: cognitive complexity for JavaScript (ESLint "
              f"sonarjs), McCabe for Python (Ruff C901); docs/quality.md")
        for p in problems:
            print("  " + message(*p))
        if any(kind == "stale" for kind, _, _ in problems):
            print(f"The baseline is stale: {UPDATE_HINT}, and commit it.")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
