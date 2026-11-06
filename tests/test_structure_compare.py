# SPDX-License-Identifier: MIT
"""Tests for tools/structure_compare.py with synthetic JavaScript only.  python3 -m unittest discover -s tests"""

import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
import structure_compare as sc

MARKER = "ZXQ_UNIQUE_MARKER_7731"

ORIGINAL = """
// computes things
export function simulate(nodes, links, steps) {
  const forces = new Map();
  for (let step = 0; step < steps; step++) {
    for (const link of links) {
      const dx = link.target.x - link.source.x;
      const dy = link.target.y - link.source.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const pull = (dist - link.length) * 0.03 / dist;
      forces.set(link.source.id, (forces.get(link.source.id) || 0) + pull * dx);
      forces.set(link.target.id, (forces.get(link.target.id) || 0) - pull * dy);
    }
    for (const node of nodes) {
      const f = forces.get(node.id) || 0;
      if (f > 10) { node.x += f * 0.5; } else { node.y -= f * 0.25; }
      node.vx = node.vx * 0.9 + f;
    }
  }
  return nodes.map((node) => ({ id: node.id, x: node.x, y: node.y }));
}
"""

RENAMED = """
/* totally different comment */
export function run(items, edges, rounds) {
  const acc = new Map();
  for (let r = 0; r < rounds; r++) {
    for (const e of edges) {
      const a = e.target.x - e.source.x;
      const b = e.target.y - e.source.y;
      const d = Math.sqrt(a * a + b * b) || 1;
      const q = (d - e.length) * 0.07 / d;
      acc.set(e.source.id, (acc.get(e.source.id) || 0) + q * a);
      acc.set(e.target.id, (acc.get(e.target.id) || 0) - q * b);
    }
    for (const item of items) {
      const g = acc.get(item.id) || 0;
      if (g > 10) { item.x += g * 0.5; } else { item.y -= g * 0.25; }
      item.vx = item.vx * 0.9 + g;
    }
  }
  return items.map((item) => ({ id: item.id, x: item.x, y: item.y }));
}
"""

UNRELATED = """
export class Palette {
  constructor(colors) { this.colors = colors; this.cursor = 0; }
  next() {
    if (this.cursor >= this.colors.length) this.cursor = 0;
    return this.colors[this.cursor++];
  }
  toHex(value) { return '#' + value.toString(16).padStart(6, '0'); }
  mix(first, second, ratio) {
    const out = [];
    for (let i = 0; i < 3; i++) out.push(Math.round(first[i] * (1 - ratio) + second[i] * ratio));
    return out;
  }
}
"""


class StructureCompareTest(unittest.TestCase):
    def folder(self, files: dict[str, str]) -> Path:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = Path(tmp.name)
        for rel, text in files.items():
            (root / rel).parent.mkdir(parents=True, exist_ok=True)
            (root / rel).write_text(text, encoding="utf-8")
        return root

    def run_tool(self, ours: dict[str, str], theirs: dict[str, str], *extra: str) -> tuple[int, str]:
        args = ["--ours", str(self.folder(ours)), "--theirs", str(self.folder(theirs)), "--k", "10", "--window", "3",
                "--min-run", "30", *extra]
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = sc.main(args)
        return code, out.getvalue()

    def summary(self, ours: dict[str, str], theirs: dict[str, str]) -> dict:
        code, text = self.run_tool(ours, theirs, "--json")
        self.assertEqual(code, 0)
        return json.loads(text)

    def test_renamed_copy_scores_high_with_long_run(self):
        s = self.summary({"a.js": RENAMED}, {"t.js": ORIGINAL})
        self.assertGreater(s["max_pair_share"], 0.8)
        self.assertGreater(s["max_run_tokens"], 150)
        self.assertGreater(s["runs_over_threshold"], 0)

    def test_unrelated_code_scores_near_zero(self):
        s = self.summary({"a.js": UNRELATED}, {"t.js": ORIGINAL})
        self.assertLess(s["total_share"], 0.1)
        self.assertLess(s["max_run_tokens"], 30)

    def test_comments_strings_and_numbers_are_normalized(self):
        a = sc.tokenize("// one\nconst x = 'abc' + 12; /* c */ foo(x)")[0]
        b = sc.tokenize("const y = \"zzzz\" + 99; bar(y) // other")[0]
        self.assertEqual(a, b)

    def test_line_numbers_follow_multiline_comments_and_templates(self):
        tokens, lines, _ = sc.tokenize("/* a\nb */\nlet x = `p\nq`;\nfoo()")
        self.assertEqual(lines[0], 3)
        self.assertEqual(lines[-1], 5)
        self.assertEqual(tokens[3], "STR")

    def test_regex_division_and_templates_do_not_crash(self):
        src = (
            "const r = /ab+[/]c\\/d/gi; const q = a / b / c; const s = x.replace(/\\s+/g, '');\n"
            "const t = `a ${ f(`n ${ y }`, '}') } b`; const bad = /unterminated\n"
            "const u = 'open\nconst v = `never closed ${ 1 "
        )
        tokens, _, _ = sc.tokenize(src)
        self.assertEqual(tokens[3], "REGEX")
        self.assertEqual(tokens[:3] + tokens[4:5], ["const", "ID", "=", ";"])
        self.assertIn("/", tokens)  # a / b / c stays division
        self.assertEqual(tokens.count("REGEX"), 2)  # the second one is the replace argument

    def test_report_never_contains_their_lines(self):
        theirs = ORIGINAL + f"\nconst planted = '{MARKER}'; // {MARKER}\nfunction {MARKER.lower()}Fn() {{}}\n"
        code, text = self.run_tool({"a.js": RENAMED}, {"deep/t.js": theirs})
        self.assertEqual(code, 0)
        self.assertNotIn(MARKER, text)
        self.assertNotIn(MARKER.lower(), text)
        self.assertNotIn("link.source.id", text)
        self.assertIn("deep/t.js", text)  # only their path is named
        self.assertNotIn(MARKER, self.run_tool({"a.js": RENAMED}, {"deep/t.js": theirs}, "--json")[1])

    def test_identifier_overlap_is_listed_as_weak_signal(self):
        code, text = self.run_tool({"a.js": "const sharedDistinctiveName = 1;"}, {"t.js": "let sharedDistinctiveName;"})
        self.assertEqual(code, 0)
        self.assertIn("sharedDistinctiveName", text)
        self.assertIn("weak signal", text)

    def test_missing_directory_still_exits_zero(self):
        self.assertEqual(sc.main(["--ours", "/nonexistent-a", "--theirs", "/nonexistent-b"]), 0)

    def test_short_file_has_no_fingerprints(self):
        s = self.summary({"a.js": "let a = 1;"}, {"t.js": ORIGINAL})
        self.assertIsNone(s["files"][0]["share_any"])


if __name__ == "__main__":
    unittest.main()
