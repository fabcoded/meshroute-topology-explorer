#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Structure comparison of our frontend JavaScript against comparison sources, for the clean-room check.

  python3 tools/structure_compare.py [--ours DIR] --theirs DIR [--k 25] [--window 4] [--min-run 50] [--json]

Why: before a release the owner shows that no third-party code was taken. Names, comments and strings are easy to
change, structure is not, so both sides are reduced to a normalized token stream (identifiers ID, numbers NUM,
strings and template literals STR, regex literals REGEX; keywords and punctuation kept; comments dropped).
Reported per pair of files (ours, theirs): the share of our fingerprints found in theirs (k-gram hashes selected by
winnowing, Schleimer, Wilkerson and Aiken 2003: in every window of `window` hashes the smallest is kept, so any
shared run of at least k + window - 1 tokens is found), and the longest common normalized token run as OUR file's
line range. Runs of at least `--min-run` tokens are listed. A weak extra signal: non-trivial identifiers present in
both sides. The report never prints third-party code or lines, only their file paths, counts and percentages. Exit
code is always 0 (it is a report); `--json` prints the summary for the provenance line.

Main-session procedure (the tool itself never fetches anything; agents must not read these sources):
  1. In a fresh temp dir outside the repo: `npm pack <pkg>@<exact version>` for each comparison package, unpack.
  2. Run this tool with `--theirs` on that dir; look only at OUR line ranges at or above the threshold.
  3. Delete the temp dir; record date, tool, versions and maximum values as one line in docs/provenance.md.

Tokenizer heuristics (structure only, not a parser): a `/` starts a regex literal unless the previous token is an
identifier, number, string, `)`, `]` or `}` (a `}` or `)` before a regex is rare and then read as division); a regex
that does not close on its line is read as the operator. Template literals are one STR; `${...}` parts are skipped
with nesting, so expressions inside templates are not compared. Unterminated strings end at the line end. Rules:
AGENTS.md; procedure: docs/provenance.md.
"""

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

DEFAULT_OURS = "custom_components/meshroute_topology_explorer/frontend"
EXTENSIONS = {".js", ".mjs", ".cjs"}
KEYWORDS = frozenset(
    "async await break case catch class const continue debugger default delete do else export extends finally for "
    "from function if import in instanceof let new null of return static super switch this throw true false try "
    "typeof undefined var void while with yield get set".split()
)
# Keywords after which a `/` starts a regex rather than a division.
REGEX_AFTER_KEYWORD = frozenset("return typeof case delete void throw in of instanceof new do else yield await".split())
# Names too common to say anything; the overlap list is a weak signal and should not be dominated by them.
TRIVIAL_IDS = frozenset(
    "length push forEach filter reduce value values keys entries console document window Object Array String Number "
    "Boolean Math Map Set Promise JSON Error prototype constructor toString addEventListener removeEventListener "
    "querySelector getAttribute setAttribute appendChild createElement classList style textContent event target "
    "type name data node nodes index result error options config callback resolve reject".split()
)
OPERATORS = sorted(
    ">>>= ... === !== **= <<= >>= >>> &&= ||= ??= => == != <= >= && || ?? ?. ++ -- += -= *= /= %= &= |= ^= << >> **".split(),
    key=len, reverse=True,
)
IDENT_START = re.compile(r"[A-Za-z_$\u0080-￿]")
IDENT = re.compile(r"[A-Za-z0-9_$\u0080-￿]+")
NUMBER = re.compile(r"(?:0[xXbBoO][0-9a-fA-F_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?)n?")
MAX_ANCHORS = 40  # occurrences of one fingerprint per file used as run anchors (boilerplate guard)


def tokenize(src: str) -> tuple[list[str], list[int], list[str]]:
    """Return (normalized tokens, line of each token, raw identifiers in order); heuristics in the module doc."""
    tokens: list[str] = []
    lines: list[int] = []
    idents: list[str] = []
    i, n, line = 0, len(src), 1
    prev = ""  # previous normalized token

    def emit(tok: str) -> None:
        nonlocal prev
        tokens.append(tok)
        lines.append(line)
        prev = tok

    while i < n:
        c = src[i]
        if c == "\n":
            line += 1
            i += 1
        elif c in " \t\r\f\v﻿":
            i += 1
        elif src.startswith("//", i):
            j = src.find("\n", i)
            i = n if j < 0 else j
        elif src.startswith("/*", i):
            j = src.find("*/", i + 2)
            j = n if j < 0 else j + 2
            line += src.count("\n", i, j)
            i = j
        elif c in "'\"":
            j = i + 1
            while j < n and src[j] != c and src[j] != "\n":
                j += 2 if src[j] == "\\" else 1
            if j < n and src[j] == "\n":
                pass  # unterminated: stop at the line end
            else:
                j += 1
            line_at = line
            line += src.count("\n", i, min(j, n))  # a backslash-newline continues a string
            emit("STR")
            lines[-1] = line_at
            i = min(j, n)
        elif c == "`":
            j, depth = i + 1, 0
            line_at = line
            while j < n:
                ch = src[j]
                if ch == "\\":
                    j += 2
                    continue
                if depth == 0 and ch == "`":
                    break
                if ch == "$" and src.startswith("${", j):
                    depth += 1
                    j += 2
                    continue
                if depth and ch == "{":
                    depth += 1
                elif depth and ch == "}":
                    depth -= 1
                elif depth and ch in "'\"":  # a quoted string inside an expression may hold braces
                    k = j + 1
                    while k < n and src[k] != ch and src[k] != "\n":
                        k += 2 if src[k] == "\\" else 1
                    j = k
                elif depth and ch == "`":  # nested template: skip it whole, same rules
                    k = j + 1
                    while k < n and src[k] != "`":
                        k += 2 if src[k] == "\\" else 1
                    j = k
                j += 1
            j = min(j + 1, n)
            line += src.count("\n", i, j)
            emit("STR")
            lines[-1] = line_at
            i = j
        elif c == "/" and (prev == "" or (prev not in ("ID", "NUM", "STR", "REGEX", ")", "]", "}") and (
                prev in REGEX_AFTER_KEYWORD or prev not in KEYWORDS))):
            j, in_class = i + 1, False
            while j < n and src[j] != "\n":
                if src[j] == "\\":
                    j += 1
                elif src[j] == "[":
                    in_class = True
                elif src[j] == "]":
                    in_class = False
                elif src[j] == "/" and not in_class:
                    break
                j += 1
            if j < n and src[j] == "/":
                j += 1
                while j < n and (src[j].isalpha()):
                    j += 1
                emit("REGEX")
                i = j
            else:
                emit("/")
                i += 1
        elif c.isdigit() or (c == "." and i + 1 < n and src[i + 1].isdigit()):
            m = NUMBER.match(src, i)
            emit("NUM")
            i = m.end() if m and m.end() > i else i + 1
        elif IDENT_START.match(c):
            m = IDENT.match(src, i)
            word = m.group(0)
            if word in KEYWORDS:
                emit(word)
            else:
                emit("ID")
                idents.append(word)
            i = m.end()
        else:
            for op in OPERATORS:
                if src.startswith(op, i):
                    emit(op)
                    i += len(op)
                    break
            else:
                emit(c)
                i += 1
    return tokens, lines, idents


def fingerprints(tokens: list[str], k: int, window: int) -> dict[int, list[int]]:
    """Winnowing: map hash -> start positions of the k-grams selected as the minimum of a window."""
    count = len(tokens) - k + 1
    if count < 1:
        return {}
    hashes = [
        int.from_bytes(hashlib.blake2b(" ".join(tokens[p:p + k]).encode(), digest_size=8).digest(), "big")
        for p in range(count)
    ]
    chosen: dict[int, list[int]] = {}
    last = -1
    for start in range(max(1, count - window + 1)):
        span = hashes[start:start + window]
        low = min(span)
        pos = start + len(span) - 1 - span[::-1].index(low)  # rightmost minimum, as in the paper
        if pos != last:
            chosen.setdefault(hashes[pos], []).append(pos)
            last = pos
    return chosen


class Source:
    """One tokenized file with its fingerprints."""

    def __init__(self, path: Path, rel: str, k: int, window: int):
        self.rel = rel
        self.tokens, self.lines, self.idents = tokenize(path.read_text(encoding="utf-8", errors="replace"))
        self.fps = fingerprints(self.tokens, k, window)


def load(root: Path, k: int, window: int) -> list[Source]:
    """All JavaScript files below root, sorted, with paths relative to root."""
    files = sorted(p for p in root.rglob("*") if p.is_file() and p.suffix in EXTENSIONS)
    return [Source(p, p.relative_to(root).as_posix(), k, window) for p in files]


def common_runs(ours: Source, theirs: Source, min_len: int) -> list[tuple[int, int, int]]:
    """Maximal common token runs (length, our start, our end) seen from shared fingerprints, longest first."""
    runs: list[tuple[int, int, int]] = []
    covered: dict[int, list[tuple[int, int]]] = {}  # diagonal -> our token intervals already inside a run
    a, b = ours.tokens, theirs.tokens
    for h, our_pos in ours.fps.items():
        their_pos = theirs.fps.get(h)
        if not their_pos:
            continue
        for p in our_pos[:MAX_ANCHORS]:
            for q in their_pos[:MAX_ANCHORS]:
                diag = p - q
                if any(lo <= p < hi for lo, hi in covered.get(diag, ())):
                    continue
                s, e = p, p
                while s > 0 and s - diag > 0 and a[s - 1] == b[s - 1 - diag]:
                    s -= 1
                while e < len(a) and e - diag < len(b) and a[e] == b[e - diag]:
                    e += 1
                if e - s >= min_len:  # also drops a hash collision (empty or short extension)
                    covered.setdefault(diag, []).append((s, e))
                    runs.append((e - s, s, e - 1))
    return sorted(runs, reverse=True)


def identifier_overlap(ours: list[Source], theirs: list[Source], top: int = 20) -> list[tuple[str, int, int]]:
    """Non-trivial identifiers in both sides as (name, count ours, count theirs); weak signal, distinctive first."""
    def count(sources: list[Source]) -> dict[str, int]:
        out: dict[str, int] = {}
        for s in sources:
            for w in s.idents:
                out[w] = out.get(w, 0) + 1
        return out
    mine, theirs_count = count(ours), count(theirs)
    common = [
        w for w in mine
        if w in theirs_count and len(w) >= 5 and w not in TRIVIAL_IDS and not w.isupper()
    ]

    def score(w: str) -> tuple[int, int, str]:
        compound = bool(re.search(r"[a-z][A-Z]|_", w))  # camelCase or snake_case names carry more than one word
        return (-(len(w) + (6 if compound else 0)), -mine[w], w)
    return [(w, mine[w], theirs_count[w]) for w in sorted(common, key=score)[:top]]


def compare(ours: list[Source], theirs: list[Source], min_run: int) -> dict:
    """Build the summary: pairs with shared fingerprints, per-file best, totals, identifier overlap."""
    theirs_hashes: set[int] = set()
    for t in theirs:
        theirs_hashes.update(t.fps)
    files, total_fps, total_hit = [], 0, 0
    for o in ours:
        pairs = []
        for t in theirs:
            shared = len(o.fps.keys() & t.fps.keys())
            if not shared:
                continue
            runs = common_runs(o, t, 1)
            longest = runs[0] if runs else (0, 0, 0)
            pairs.append({
                "theirs": t.rel,
                "shared": shared,
                "share": shared / len(o.fps),
                "longest_run_tokens": longest[0],
                "longest_run_lines": [o.lines[longest[1]], o.lines[longest[2]]] if runs else None,
                "runs_over_threshold": [
                    {"tokens": n, "lines": [o.lines[s], o.lines[e]]} for n, s, e in runs if n >= min_run
                ][:10],
            })
        pairs.sort(key=lambda p: (-p["share"], p["theirs"]))
        hit = len(o.fps.keys() & theirs_hashes)
        total_fps += len(o.fps)
        total_hit += hit
        files.append({
            "ours": o.rel, "tokens": len(o.tokens), "fingerprints": len(o.fps),
            "share_any": hit / len(o.fps) if o.fps else None, "pairs": pairs[:5],
        })
    maxima = [p for f in files for p in f["pairs"]]
    return {
        "files": files,
        "total_fingerprints": total_fps,
        "total_share": total_hit / total_fps if total_fps else None,
        "max_pair_share": max((p["share"] for p in maxima), default=0.0),
        "max_run_tokens": max((p["longest_run_tokens"] for p in maxima), default=0),
        "runs_over_threshold": sum(len(p["runs_over_threshold"]) for p in maxima),
        "identifier_overlap": [
            {"name": w, "ours": a, "theirs": b} for w, a, b in identifier_overlap(ours, theirs)
        ],
    }


def pct(x: float | None) -> str:
    return "n/a" if x is None else f"{100 * x:.1f}%"


def render(summary: dict, params: dict) -> str:
    """Plain-text report: our paths and line ranges, their file paths and numbers only, never their content."""
    out = [
        "Structure comparison (normalized token streams, winnowing)",
        f"k={params['k']} window={params['window']} min-run={params['min_run']} "
        f"ours={params['ours_files']} files, theirs={params['theirs_files']} files",
        "",
    ]
    for f in summary["files"]:
        out.append(f"{f['ours']}: {f['tokens']} tokens, {f['fingerprints']} fingerprints, found in any theirs: "
                   f"{pct(f['share_any'])}")
        for p in f["pairs"]:
            lines = p["longest_run_lines"]
            where = f", our lines {lines[0]}-{lines[1]}" if lines else ""
            out.append(f"  vs {p['theirs']}: {pct(p['share'])} ({p['shared']} shared), "
                       f"longest run {p['longest_run_tokens']} tokens{where}")
            for r in p["runs_over_threshold"]:
                out.append(f"    ABOVE THRESHOLD: {r['tokens']} tokens, our lines {r['lines'][0]}-{r['lines'][1]}")
    out += [
        "",
        f"Total: {pct(summary['total_share'])} of {summary['total_fingerprints']} fingerprints found in theirs; "
        f"max pair share {pct(summary['max_pair_share'])}; longest run {summary['max_run_tokens']} tokens; "
        f"runs at or above threshold: {summary['runs_over_threshold']}",
        "",
        "Identifier overlap (weak signal: names present in both, common names excluded; says nothing alone):",
    ]
    out += [f"  {i['name']} (ours {i['ours']}x, theirs {i['theirs']}x)" for i in summary["identifier_overlap"]] or ["  none"]
    return "\n".join(out)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Structure comparison for the clean-room check (report only).")
    ap.add_argument("--ours", default=DEFAULT_OURS)
    ap.add_argument("--theirs", required=True)
    ap.add_argument("--k", type=int, default=25)
    ap.add_argument("--window", type=int, default=4)
    ap.add_argument("--min-run", type=int, default=50)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)
    ours_root, theirs_root = Path(args.ours), Path(args.theirs)
    if not ours_root.is_dir() or not theirs_root.is_dir():
        print("Both --ours and --theirs must be directories.", file=sys.stderr)
        return 0  # a report tool: never fails the caller's pipeline
    ours = load(ours_root, args.k, args.window)
    theirs = load(theirs_root, args.k, args.window)
    summary = compare(ours, theirs, args.min_run)
    params = {"k": args.k, "window": args.window, "min_run": args.min_run,
              "ours_files": len(ours), "theirs_files": len(theirs)}
    if args.json:
        print(json.dumps({"params": params, **summary}, indent=2))
    else:
        print(render(summary, params))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
