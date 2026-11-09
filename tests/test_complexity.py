# SPDX-License-Identifier: MIT
"""Tests for the complexity ratchet in tools/complexity.py: its logic and Ruff's isolated run (skipped without Ruff on
PATH).  python3 -m unittest discover -s tests"""

import contextlib
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
import complexity
from complexity import Finding

BASE = {"js": {"a.js": {"big": 30, "C.m": 20}}, "python": {"t.py": {"check": 16}}}


def js(name, score, file="a.js", line=1):
    return Finding("js", file, name, line, score)


class CompareTest(unittest.TestCase):
    def kinds(self, findings, scope=None, base=BASE):
        return [(kind, f.file, f.name, old) for kind, f, old in complexity.compare(base, findings, scope)]

    def test_unchanged_baseline_passes(self):
        self.assertEqual(self.kinds([js("big", 30), js("C.m", 20), Finding("python", "t.py", "check", 3, 16)]), [])

    def test_new_function_above_limit_fails_even_in_a_listed_file(self):
        found = [js("big", 30), js("C.m", 20), js("other", 16), Finding("python", "t.py", "check", 3, 16)]
        self.assertEqual(self.kinds(found), [("new", "a.js", "other", None)])

    def test_listed_function_rising_fails(self):
        found = [js("big", 31), js("C.m", 20), Finding("python", "t.py", "check", 3, 16)]
        self.assertEqual(self.kinds(found), [("rose", "a.js", "big", 30)])

    def test_same_name_in_another_language_or_file_is_new(self):
        found = [js("big", 30), js("C.m", 20), Finding("python", "t.py", "check", 3, 16), js("big", 30, file="b.js"),
                 Finding("python", "a.js", "big", 1, 30)]
        self.assertEqual([k[:3] for k in self.kinds(found)], [("new", "b.js", "big"), ("new", "a.js", "big")])

    def test_fallen_or_vanished_entry_makes_the_baseline_stale(self):
        # big fell to 25, C.m is no longer reported (15 or less, renamed or removed), check unchanged.
        found = [js("big", 25), Finding("python", "t.py", "check", 3, 16)]
        problems = complexity.compare(BASE, found)
        self.assertEqual([(k, f.name, f.score, old) for k, f, old in problems],
                         [("stale", "C.m", None, 20), ("stale", "big", 25, 30)])

    def test_a_scope_judges_only_the_listed_entries_of_its_files(self):
        # Only t.py was measured (a commit that touches one Python file): a.js's entries are not stale.
        self.assertEqual(self.kinds([Finding("python", "t.py", "check", 3, 16)], scope={"t.py"}), [])
        self.assertEqual(self.kinds([], scope={"t.py"}), [("stale", "t.py", "check", 16)])

    def test_rename_reads_as_new_plus_stale(self):
        found = [js("big", 30), js("C.renamed", 20), Finding("python", "t.py", "check", 3, 16)]
        self.assertEqual(self.kinds(found), [("new", "a.js", "C.renamed", None), ("stale", "a.js", "C.m", 20)])


class UpdateTest(unittest.TestCase):
    def test_update_lowers_and_drops_but_never_adds_or_raises(self):
        found = [js("big", 22), js("C.m", 25), js("fresh", 40), Finding("python", "t.py", "check", 3, 16)]
        # big lowered to 22, C.m keeps 20 (it rose and still fails), fresh is not added; nothing is dropped here.
        self.assertEqual(complexity.updated(BASE, found),
                         {"js": {"a.js": {"big": 22, "C.m": 20}}, "python": {"t.py": {"check": 16}}})

    def test_update_drops_fallen_functions_and_empty_files(self):
        self.assertEqual(complexity.updated(BASE, [js("big", 30)]), {"js": {"a.js": {"big": 30}}})
        self.assertEqual(complexity.updated(BASE, []), {})

    def test_updated_baseline_passes_except_new_and_risen(self):
        found = [js("big", 22), js("C.m", 25), js("fresh", 40)]
        problems = complexity.compare(complexity.updated(BASE, found), found)
        self.assertEqual([(k, f.name) for k, f, _ in problems], [("rose", "C.m"), ("new", "fresh")])

    def test_seed_takes_every_finding(self):
        found = [js("big", 30), Finding("python", "t.py", "check", 3, 16)]
        self.assertEqual(complexity.seeded(found), {"js": {"a.js": {"big": 30}}, "python": {"t.py": {"check": 16}}})


class ScopeTest(unittest.TestCase):
    def test_source_files_are_a_scope(self):
        self.assertEqual(complexity.scope_of(["a.js", "./t.py", "x/y.mjs"]), {"a.js", "t.py", "x/y.mjs"})

    def test_listed_files_that_are_gone_are_always_judged(self):
        # A commit that deletes or renames a.js never names it; its entries must still read as stale.
        self.assertEqual(complexity.scope_of(["t.py"], missing={"a.js"}), {"t.py", "a.js"})
        self.assertIsNone(complexity.scope_of([], missing={"a.js"}))

    def test_no_files_baseline_or_config_measures_everything(self):
        self.assertIsNone(complexity.scope_of([]))
        self.assertIsNone(complexity.scope_of(["a.js", "tools/complexity-baseline.json"]))


class MessageTest(unittest.TestCase):
    def test_messages_name_place_score_and_fix(self):
        new = complexity.message("new", js("route", 31, file="r.js", line=262), None)
        self.assertIn("r.js:262 route: complexity 31, above 15", new)
        self.assertIn("split it into named helpers", new)
        self.assertIn("not for new code", new)
        rose = complexity.message("rose", js("big", 31), 30)
        self.assertIn("listed at 30", rose)
        stale = complexity.message("stale", Finding("js", "a.js", "C.m", None, None), 20)
        self.assertEqual(stale, "a.js C.m: listed at 20, now not above 15 or gone (stale)")


@unittest.skipUnless(shutil.which("ruff"), "Ruff not on PATH (the pre-commit hook installs it)")
class RuffIsolatedTest(unittest.TestCase):
    def test_project_settings_exempt_no_python_file(self):
        # Review rev-s10 F2: per-file-ignores exempted a file, extend-exclude made commit and CI modes disagree.
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = Path(tmp.name)
        busy = "def busy(x):\n" + "".join(f"    if x == {i}:\n        return {i}\n" for i in range(16)) + "    return -1\n"
        for name in ("ignored.py", "excluded.py"):
            (root / name).write_text(busy, encoding="utf-8")
        (root / "pyproject.toml").write_text('[tool.ruff]\nextend-exclude = ["excluded.py"]\n'
                                             '[tool.ruff.lint.per-file-ignores]\n"ignored.py" = ["C901"]\n', encoding="utf-8")
        with mock.patch.object(complexity, "ROOT", root), contextlib.chdir(root):
            everything = complexity.py_findings(None)
            named = complexity.py_findings(["excluded.py"])
        self.assertEqual(sorted((f.file, f.name, f.score) for f in everything),
                         [("excluded.py", "busy", 17), ("ignored.py", "busy", 17)])
        self.assertEqual([(f.file, f.score) for f in named], [("excluded.py", 17)])


class PythonNamesTest(unittest.TestCase):
    def test_qualified_names_by_def_line(self):
        src = (
            "def outer():\n"            # 1
            "    def inner():\n"        # 2
            "        pass\n"
            "class C:\n"                # 4
            "    def m(self):\n"        # 5
            "        def inner():\n"    # 6
            "            pass\n"
            "    async def a(self):\n"  # 8
            "        pass\n"
            "@decorator\n"
            "def decorated():\n"        # 11
            "    pass\n"
            "def outer():\n"            # 13: a redefinition gets #2
            "    pass\n"
        )
        self.assertEqual(complexity.py_names(src), {
            (1, "outer"): "outer", (2, "inner"): "outer>inner", (5, "m"): "C.m", (6, "inner"): "C.m>inner",
            (8, "a"): "C.a", (11, "decorated"): "decorated", (13, "outer"): "outer#2"})


if __name__ == "__main__":
    unittest.main()
