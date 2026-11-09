#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Quality report: coverage, duplication, complexity, types, licences, spelling, dead code, test counts, and a report-only gate.

  python3 tools/quality.py [--base REF] [--json FILE] [--check-seconds N]   measure, print Markdown
  python3 tools/quality.py --index quality.jsonl                           print the trend table (weekly branch)

Needs the dev setup (npm ci, coverage.py, ruff, requirements-quality.txt, network once for the pinned npx tools). The gate only reports PASS/FAIL, never exits 1.
Rules and targets: CONTRIBUTING.md "Quality report"; CI: .github/workflows/quality.yml.
"""

import argparse
import json
import re
import subprocess
import sys
import tempfile
import time
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FRONT = "custom_components/meshroute_topology_explorer/frontend/"
JSCPD = "jscpd@5.4.2"  # pinned; CI uses the same script, so one place
TSC = "typescript@6.0.3"  # type check only (jsconfig.json, noEmit); an npx pin keeps package.json free of it
KNIP = "knip@6.44.2"  # config: knip.jsonc
LICENSES = "license-checker-rseidelsohn@5.0.1"
# Licence allowlist (owner 2026-11-09, S9). SPDX ids after normalising; LGPL-3.0 only for dev tools, always flagged.
# BlueOak-1.0.0 (minimatch 10+) and MIT-CMU (Pillow) are permissive, OSI-approved licences (owner 2026-11-09).
ALLOWED = {"MIT", "BSD-2-Clause", "BSD-3-Clause", "ISC", "Apache-2.0", "Python-2.0", "0BSD", "BlueOak-1.0.0", "MIT-CMU"}
FLAGGED = {"LGPL-3.0-only", "LGPL-3.0-or-later", "LGPL-3.0"}
PIP_NAMES = {"MIT License": "MIT", "BSD License": "BSD-3-Clause", "Apache Software License": "Apache-2.0",
             "PSF-2.0": "Python-2.0", "Python Software Foundation License": "Python-2.0"}
BUNDLE = FRONT + "dist/**"  # generated from the sources (tools/bundle.mjs, issue #16): counted there, not twice
TESTABLE = ("adapters", "engines", "model", "python")  # gated; graph, ui, panel are reported only
# index rows: label, metric key, target text, ok(value, last_week)
TARGETS = [
    ("Coverage JS testable (%)", "cov_js_testable", ">= 85", lambda v, p: v >= 85),
    ("Coverage Python (%)", "cov_python", ">= 85", lambda v, p: v >= 85),
    ("Cognitive complexity > 15, JS", "cc_js", "falling, never rising", lambda v, p: p is None or v <= p),
    ("Complexity > 15, Python (Ruff C901)", "cc_py", "falling, never rising", lambda v, p: p is None or v <= p),
    ("Duplication (%)", "dup_pct", "<= 3", lambda v, p: v <= 3),
    ("New Ruff/ESLint findings", "lint_findings", "0", lambda v, p: v == 0),
    ("Type findings, Python (pyright basic)", "typecheck_py", "falling, never rising", lambda v, p: p is None or v <= p),
    ("Type findings, JS (tsc checkJs)", "typecheck_js", "falling, never rising", lambda v, p: p is None or v <= p),
    ("Licence violations (allowlist)", "license_violations", "0", lambda v, p: v == 0),
    ("Spelling findings (typos)", "typos", "0", lambda v, p: v == 0),
    ("Unused JS exports and files (knip)", "dead_code", "falling, never rising", lambda v, p: p is None or v <= p),
    ("check.py (s)", "t_check", "< 120", lambda v, p: v < 120),
]


def run(cmd, **kw):
    """Run a command in the repo root and return the finished process; failures are the caller's to read."""
    return subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, check=False, **kw)  # noqa: S603 - fixed lists


def tool_json(cmd, ok=(0, 1)):
    """Run a linter with JSON output. A crash or a missing tool stops the report: it must never read as 0 findings."""
    r = run(cmd)
    try:
        if r.returncode in ok:
            return json.loads(r.stdout)
    except json.JSONDecodeError:
        pass
    sys.exit(f"{' '.join(cmd[:2])} failed (exit {r.returncode}): {r.stderr.strip()[-300:]}")


def changed_lines(base):
    """Map file -> set of added or changed line numbers versus the merge base (working tree included)."""
    mb = run(["git", "merge-base", base, "HEAD"]).stdout.strip() or base
    out, path = defaultdict(set), None
    for line in run(["git", "diff", "-U0", "--no-color", mb]).stdout.splitlines():
        if line.startswith("+++ "):
            path = line[6:] if line.startswith("+++ b/") else None
        elif line.startswith("@@") and path:
            m = re.match(r"@@ -\S+ \+(\d+)(?:,(\d+))? @@", line)
            start, n = int(m[1]), int(m[2] if m[2] is not None else 1)
            out[path].update(range(start, start + n))
    return out


def group(path):
    """Coverage group of a file: frontend subdirectory, 'panel', or 'python'."""
    if path.startswith(FRONT):
        rest = path[len(FRONT):]
        return rest.split("/")[0] if "/" in rest else "panel"
    return "python" if path.endswith(".py") else "other"


def pct(done, total):
    return round(100 * done / total, 1) if total else None


def js_coverage(tmp):
    """Run the Node tests with built-in coverage; return (per-file {line: hits}, test count, seconds)."""
    lcov, spec = Path(tmp) / "js.lcov", Path(tmp) / "js.spec"  # a file, not a pipe: piped stdout can lose the summary
    t0 = time.time()
    run(["node", "--test", "--experimental-test-coverage", f"--test-coverage-include={FRONT}**/*.js",
             "--test-reporter=lcov", f"--test-reporter-destination={lcov}",
             "--test-reporter=spec", f"--test-reporter-destination={spec}", "tests/**/*.test.mjs"])
    if not lcov.exists():
        sys.exit("node --test wrote no coverage")
    files, cur = {}, None
    for line in lcov.read_text().splitlines():
        if line.startswith("SF:"):
            cur = files.setdefault(str(Path(line[3:]).resolve().relative_to(ROOT)), {})
        elif line.startswith("DA:"):
            n, hits = line[3:].split(",")[:2]
            cur[int(n)] = int(hits)
    count = re.search(r"^\S+ tests (\d+)", spec.read_text() if spec.exists() else "", re.M)
    return files, int(count[1]) if count else None, round(time.time() - t0, 1)


def py_coverage(tmp):
    """Run the unittest suite under coverage.py; return (per-file {line: hits as 0/1}, test count, seconds)."""
    data, out = Path(tmp) / ".coverage", Path(tmp) / "py.json"
    env = {"COVERAGE_FILE": str(data), "PATH": subprocess.os.environ["PATH"], "PYTHONPATH": subprocess.os.environ.get("PYTHONPATH", "")}
    t0 = time.time()
    r = run([sys.executable, "-m", "coverage", "run", "--source=custom_components", "-m", "unittest", "discover", "-s", "tests"], env=env)
    secs = round(time.time() - t0, 1)
    run([sys.executable, "-m", "coverage", "json", "-o", str(out)], env=env)
    if not out.exists():
        sys.exit(f"coverage.py wrote no report: {r.stderr.strip()[-300:]}")
    files = {}
    for name, d in json.loads(out.read_text())["files"].items():
        files[name] = {**{n: 0 for n in d["missing_lines"]}, **{n: 1 for n in d["executed_lines"]}}
    count = re.search(r"^Ran (\d+) tests?", r.stderr, re.M)
    return files, int(count[1]) if count else None, secs


def duplication(tmp, changed):
    """jscpd at 100 tokens / 10 lines; return (overall %, duplicated lines on changed lines)."""
    r = run(["npx", "--yes", JSCPD, "custom_components", "tools", "tests", "--min-tokens", "100", "--min-lines", "10",
             "--ignore", f"**/fixtures/**,**/vendor/**,{BUNDLE}", "--reporters", "json", "--output", tmp, "--silent"])
    rep = Path(tmp) / "jscpd-report.json"
    if not rep.exists():
        sys.exit(f"jscpd wrote no report: {r.stderr.strip()[-300:]}")
    data = json.loads(rep.read_text())
    dup = set()
    for d in data.get("duplicates", []):
        for side in ("firstFile", "secondFile"):
            f = d[side]
            dup.update((f["name"], n) for n in range(f["start"], f["end"] + 1))
    new = sum(1 for f, n in dup if n in changed.get(f, ()))
    return round(data["statistics"]["total"]["percentage"], 2), new


def eslint_complexity():
    """Return (cognitive-complexity findings above 15, [(file, line)]) from the measurement-only ESLint config."""
    out = tool_json(["node", "node_modules/eslint/bin/eslint.js", "-c", "eslint.quality.config.mjs", ".", "-f", "json"])
    hits = [(str(Path(f["filePath"]).relative_to(ROOT)), m["line"]) for f in out for m in f["messages"]]
    return len(hits), hits


def ruff(args):
    """Run ruff check with JSON output; return [(file, line)] of findings."""
    out = tool_json(["ruff", "check", "--output-format", "json", "--no-cache", *args])
    return [(str(Path(m["filename"]).relative_to(ROOT)), m["location"]["row"]) for m in out]


def pyright():
    """Run pyright (config in pyproject.toml); return [(file, line)] of findings."""
    out = tool_json(["pyright", "--outputjson"])
    return [(str(Path(d["file"]).relative_to(ROOT)), d["range"]["start"]["line"] + 1) for d in out["generalDiagnostics"]]


def tsc():
    """Type-check the frontend with tsc checkJs (jsconfig.json, noEmit); return [(file, line)] of findings."""
    r = run(["npx", "--yes", "-p", TSC, "tsc", "-p", "jsconfig.json", "--pretty", "false"])
    hits = [(m[1], int(m[2])) for m in re.finditer(r"^(.+?)\((\d+),\d+\): error TS", r.stdout, re.M)]
    if r.returncode not in (0, 2) or (r.returncode and not hits):
        sys.exit(f"tsc failed (exit {r.returncode}): {(r.stderr or r.stdout).strip()[-300:]}")
    return hits


def licence_audit():
    """Check installed npm and pip packages against ALLOWED; return (violations, flagged) as [str]."""
    r = run(["npx", "--yes", LICENSES, "--json", "--excludePrivatePackages"])
    try:
        npm = {k: v["licenses"] for k, v in json.loads(r.stdout).items()}
    except (json.JSONDecodeError, KeyError):
        sys.exit(f"{LICENSES} failed (exit {r.returncode}): {r.stderr.strip()[-300:]}")
    pip = tool_json(["pip-licenses", "--format=json"], ok=(0,))
    found = {**npm, **{f"{p['Name']}@{p['Version']}": p["License"] for p in pip}}
    bad, flagged = [], []
    for pkg, lic in found.items():
        # "A OR B": one allowed alternative is enough; "A; B": all must be allowed (pip-licenses joins classifiers with ;).
        ids = [[PIP_NAMES.get(x.strip(), x.strip()) for x in alt.split(";")] for alt in re.split(r"\s+OR\s+|[()]", str(lic)) if alt.strip()]
        if any(i in FLAGGED for alt in ids for i in alt):
            flagged.append(f"{pkg} {lic}")
        elif not any(all(i in ALLOWED for i in alt) for alt in ids):
            bad.append(f"{pkg} {lic}")
    return bad, flagged


def spelling():
    """Count typos findings (config _typos.toml); typos exits 2 on findings, other codes are failures."""
    r = run(["typos", "--format", "json"])
    if r.returncode not in (0, 2):
        sys.exit(f"typos failed (exit {r.returncode}): {r.stderr.strip()[-300:]}")
    return sum(1 for line in r.stdout.splitlines() if '"type":"typo"' in line.replace(" ", ""))


def dead_code():
    """Count unused files and unused exports reported by knip (config knip.jsonc; tests count as users)."""
    out = tool_json(["npx", "--yes", KNIP, "--reporter", "json"])
    return sum(len(i.get(k) or []) for i in out["issues"] for k in ("files", "exports", "types"))


def smoke_journeys():
    return len(re.findall(r'^    \("', (ROOT / "tools/smoke.py").read_text(), re.M))


def gate(m, changed, cov, new_dup, cc_hits, type_hits):
    """Sonar-way checks on new code; returns {name: (PASS|FAIL|n/a, detail)}. Report-only."""
    g, cov_tot, cov_hit, n_changed = {}, 0, 0, 0
    for path, lines in changed.items():
        if group(path) in TESTABLE and path in cov:
            n_changed += len(lines)
            hit = [cov[path][n] for n in lines if n in cov[path]]
            cov_tot, cov_hit = cov_tot + len(hit), cov_hit + sum(1 for h in hit if h)
    p = pct(cov_hit, cov_tot)
    g["changed-line coverage >= 80 % (testable, >= 20 changed lines)"] = ("n/a", f"{n_changed} changed lines") if n_changed < 20 or p is None else ("PASS" if p >= 80 else "FAIL", f"{p} %")
    n_new = sum(len(v) for v in changed.values())
    d = pct(new_dup, n_new) if new_dup is not None else None
    g["duplication on new code <= 3 % (>= 20 new lines)"] = ("n/a", f"{n_new} changed lines") if n_new < 20 or d is None else ("PASS" if d <= 3 else "FAIL", f"{d} %")
    new_cc = [(f, n) for f, n in cc_hits if n in changed.get(f, ())]
    g["no new function above complexity 15"] = ("PASS" if not new_cc else "FAIL", f"{len(new_cc)} on changed lines")
    new_ty = [(f, n) for f, n in type_hits if n in changed.get(f, ())]
    g["no new type findings on changed lines (pyright, tsc)"] = ("PASS" if not new_ty else "FAIL", f"{len(new_ty)} on changed lines")
    g["no new Ruff/ESLint findings"] = ("PASS" if m["lint_findings"] == 0 else "FAIL", f"{m['lint_findings']} findings")
    return g


def measure(base, check_seconds):
    """Take all measurements; return (metrics, gate or None)."""
    changed = changed_lines(base) if base else {}
    with tempfile.TemporaryDirectory() as tmp:
        js, n_node, t_node = js_coverage(tmp)
        py, n_py, t_py = py_coverage(tmp)
        dup_pct, new_dup = duplication(tmp, changed)
    cov = {**js, **py}
    per, m = defaultdict(lambda: [0, 0]), {}
    for path, lines in cov.items():
        per[group(path)][0] += sum(1 for h in lines.values() if h)
        per[group(path)][1] += len(lines)
    for k, (a, b) in per.items():
        m[f"cov_{k}"] = pct(a, b)
    jt = [per[k] for k in TESTABLE if k != "python" and k in per]
    m["cov_js_testable"] = pct(sum(a for a, _ in jt), sum(b for _, b in jt))
    cc_js, js_hits = eslint_complexity()
    py_cc = ruff(["--select", "C901", "--ignore-noqa", "--config", "lint.mccabe.max-complexity = 15", "."])
    es = tool_json(["node", "node_modules/eslint/bin/eslint.js", ".", "-f", "json"])
    findings = len(ruff(["."])) + sum(f["errorCount"] + f["warningCount"] for f in es)
    ty_py, ty_js = pyright(), tsc()
    bad_lic, flagged_lic = licence_audit()
    m.update(typecheck_py=len(ty_py), typecheck_js=len(ty_js), license_violations=len(bad_lic), license_flagged=len(flagged_lic),
             typos=spelling(), dead_code=dead_code(), cc_js=cc_js, cc_py=len(py_cc), dup_pct=dup_pct, lint_findings=findings,
             tests_python=n_py, tests_node=n_node, tests_smoke_journeys=smoke_journeys(),
             tests_ha=count_tests_ha(), t_unittest=t_py, t_node=t_node, t_check=check_seconds)
    return m, (gate(m, changed, cov, new_dup, js_hits + py_cc, ty_py + ty_js) if base else None)


def count_tests_ha():
    d = ROOT / "tests_ha"
    return sum(len(re.findall(r"^\s*(?:async )?def test_", p.read_text(), re.M)) for p in d.rglob("test_*.py")) if d.is_dir() else None


def render(m, g):
    """Markdown for the PR summary."""
    rows = "\n".join(f"| {k} | {'-' if v is None else v} |" for k, v in sorted(m.items()))
    out = f"## Quality report\n\n| Metric | Value |\n|---|---|\n{rows}\n"
    if g:
        out += "\n### Gate on new code (report only)\n\n| Check | Result | Detail |\n|---|---|---|\n"
        out += "\n".join(f"| {k} | {v[0]} | {v[1]} |" for k, v in g.items()) + "\n"
    return out


def ago(rows, days):
    """Last row at least `days` older than the newest row, or None."""
    from datetime import date, timedelta
    newest = date.fromisoformat(rows[-1]["date"])
    older = [r for r in rows if date.fromisoformat(r["date"]) <= newest - timedelta(days=days)]
    return older[-1] if older else None


def index(path):
    """Markdown trend table from quality.jsonl: now, last week, last month, target, status."""
    rows = [json.loads(line) for line in Path(path).read_text().splitlines() if line.strip()]
    cur, wk, mo = rows[-1], ago(rows, 7), ago(rows, 30)
    fmt = lambda r, k: "-" if r is None or r.get(k) is None else str(r[k])  # noqa: E731
    out = [f"# Quality trend\n\nLatest run {cur['date']} on `{cur.get('sha', '?')[:9]}`; one line per weekly run in `quality.jsonl`.\n",
           "| Target | Now | Last week | Last month | Goal | Status |", "|---|---|---|---|---|---|"]
    for label, key, goal, ok in TARGETS:
        v = cur.get(key)
        status = "-" if v is None else ("ok" if ok(v, wk.get(key) if wk else None) else "miss")
        out.append(f"| {label} | {fmt(cur, key)} | {fmt(wk, key)} | {fmt(mo, key)} | {goal} | {status} |")
    return "\n".join(out) + "\n"


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--base", help="PR base ref or sha; enables the gate on new code")
    ap.add_argument("--json", help="write metrics and gate as JSON")
    ap.add_argument("--check-seconds", type=float, help="runtime of tools/check.py, measured by the caller")
    ap.add_argument("--index", help="print the trend table for this quality.jsonl and exit")
    a = ap.parse_args()
    if a.index:
        print(index(a.index), end="")
        return 0
    m, g = measure(a.base, a.check_seconds)
    if a.json:
        Path(a.json).write_text(json.dumps({"metrics": m, "gate": g}, indent=1) + "\n")
    print(render(m, g), end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
