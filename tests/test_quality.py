# SPDX-License-Identifier: MIT
"""Unit tests for the pure parts of tools/quality.py (index trend, grouping). Run: python3 -m unittest discover -s tests."""

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
import quality


class QualityTest(unittest.TestCase):
    def test_group(self):
        base = quality.FRONT
        self.assertEqual(quality.group(base + "engines/zigbee/a.js"), "engines")
        self.assertEqual(quality.group(base + "panel.js"), "panel")
        self.assertEqual(quality.group("custom_components/x/store.py"), "python")

    def test_index_trend(self):
        rows = [{"date": d, "sha": "abcdef1234", "cov_python": c, "cc_js": 5, "dup_pct": 0.2, "lint_findings": 0}
                for d, c in (("2026-10-01", 80), ("2026-10-25", 84), ("2026-11-01", 90))]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "q.jsonl"
            path.write_text("\n".join(json.dumps(r) for r in rows))
            text = quality.index(path)
        self.assertIn("| Coverage Python (%) | 90 | 84 | 80 | >= 85 | ok |", text)
        self.assertIn("| Duplication (%) | 0.2 | 0.2 | 0.2 | <= 3 | ok |", text)


class ToolFailureTest(unittest.TestCase):
    def test_crashed_tool_stops_the_report(self):
        # A crash must not read as 0 findings (seen 2026-11-06: missing ESLint plugin gave complexity 0).
        with self.assertRaises(SystemExit):
            quality.tool_json([sys.executable, "-c", "import sys; sys.exit(2)"])
        with self.assertRaises(SystemExit):
            quality.tool_json([sys.executable, "-c", "print('not json')"])
        self.assertEqual(quality.tool_json([sys.executable, "-c", "print('[]'); raise SystemExit(1)"]), [])

if __name__ == "__main__":
    unittest.main()
