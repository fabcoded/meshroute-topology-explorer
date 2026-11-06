# SPDX-License-Identifier: MIT
"""Golden files for history (the `history/records` answer, the raw day file) and the store file, plus a seeded round
trip of the day-file writer and reader (damaged lines skipped). The JavaScript tests read the same goldens.
Rewrite goldens: MESHROUTE_UPDATE_GOLDENS=1 python3 -m unittest discover -s tests"""

import random
import sys
import tempfile
import unittest
from datetime import UTC, datetime
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).parent))
import golden
import ha_stubs

T0 = datetime(2026, 11, 1, 12, 0, tzinfo=UTC).timestamp()


class GoldenTest(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.dict(sys.modules)
        patcher.start()
        self.addCleanup(patcher.stop)
        ha_stubs.install()
        root = str(Path(__file__).resolve().parent.parent)
        sys.path.insert(0, root)
        self.addCleanup(sys.path.remove, root)
        self.history = ha_stubs.load(".history")
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.files = self.history.HistoryFiles(Path(self.tmp.name) / "h")

    def known_day(self):
        """Full record (neighbours with and without rssi, routes, relays, parent), a time-only record, a changed one."""
        snap = self.history.Snapshot
        full = snap({("c", "r1"): (200, -50), ("r1", "c"): (180, None), ("r1", "e1"): (90, -70)},
                    (("c", "e1", "r1", "Active"),), (("e1", ("r1",)),), (("e1", "r1"),))
        self.files.append("zha", T0, full)
        self.files.append("zha", T0 + 3600, full)
        self.files.append("zha", T0 + 7200, snap({("c", "r2"): (255, None)}, (), (("r2", ()),), ()))

    def test_history_goldens(self):
        self.known_day()
        golden.check(self, "history-records.json", golden.dumps(self.files.records("zha", T0, T0 + 86400)))
        golden.check(self, "history-day.jsonl", (self.files.folder / "zha.2026-11-01.jsonl").read_text("utf-8"))

    def test_store_golden(self):
        store = ha_stubs.load(".store").PanelStore(ha_stubs.FakeHass())
        ha_stubs.run(store.async_set("zha", "settings", {"spread": 1.44, "pins": {"00:11": [0.5, 0.25]}}))
        ha_stubs.run(store.async_set("zha", "observations", {"fingerprints": {"00:11": {"h": "abc", "t": 1}}}))
        data = ha_stubs.FakeStore.instances[-1].delay_calls[-1][0]()
        golden.check(self, "store-v1.json", golden.dumps({"version": 1, "data": data}))

    def test_seeded_round_trip_skips_damaged_lines(self):
        keys = ["k0", "k1", "k2", "k3", "0x2B82"]
        snap = self.history.Snapshot
        for seed in range(5):
            rng = random.Random(seed)  # noqa: S311 - fixed seed for reproducible test data
            files = self.history.HistoryFiles(Path(self.tmp.name) / f"s{seed}")
            expected, last = [], None
            for i in range(12):
                if last is None or rng.random() > 0.3:
                    pairs = {(a, b): (rng.randint(0, 255), rng.choice([None, -rng.randint(30, 90)]))
                             for a, b in (rng.sample(keys, 2) for _ in range(rng.randint(0, 5)))}
                    routes = tuple(sorted((*rng.sample(keys, 3), "Active") for _ in range(rng.randint(0, 3))))
                    last = snap(pairs, routes, (("k1", tuple(rng.sample(keys, 2))),) if rng.random() < 0.5 else ())
                files.append("n/1", T0 + 60 * i, last)
                expected.append((int(T0 + 60 * i), last))
            path = files.folder / "n%2F1.2026-11-01.jsonl"
            lines = path.read_text("utf-8").splitlines()
            lines.insert(rng.randrange(1, len(lines)), '{"t": 5, "e": [[0,')  # a cut write in the middle
            path.write_text("\n".join(lines) + "\n{garbage", encoding="utf-8")  # and one without newline at the end
            fresh = self.history.HistoryFiles(files.folder)
            fresh.append("n/1", T0 + 3600, last)
            expected.append((int(T0 + 3600), last))
            self.assertEqual([(int(t), s) for t, s in self.history._parse(path)], expected, f"seed {seed}")


if __name__ == "__main__":
    unittest.main()
