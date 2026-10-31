#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Write the derived test fixtures of spec section 12 from the anonymized sample.

  python3 tools/make_derived_fixtures.py            # rewrites tests/fixtures/zha-sample-*.json

A table is "removed" by emptying a router's `neighbors` and `routes`, which is what a router that never answered a
scan looks like. Which routers lose their table is fixed by a rule, so the files are reproducible and the tests
stay hard: available routers are ranked by the number of end devices they list as `Child` (most first, ties by
address) and the top ones are taken, because those removals hide the most parents.

  zha-sample-minus1.json            the top-ranked router
  zha-sample-minus3.json            the top three
  zha-sample-coordinator-only.json  every router, available or not; only the coordinator's table stays

Each file carries a "derived" block naming the source and the removed addresses. Plan: docs/spec.md section 12.
"""

import json
import sys
from pathlib import Path

FIXTURES = Path(__file__).resolve().parent.parent / "tests" / "fixtures"


def rank_routers(devices: list[dict]) -> list[str]:
    """Available routers with a table, ranked by the end devices they list as Child, then by address."""
    end_devices = {d["ieee"] for d in devices if d["device_type"] == "EndDevice"}

    def children(device: dict) -> int:
        return sum(1 for n in device["neighbors"] if n["relationship"] == "Child" and n["ieee"] in end_devices)

    routers = [d for d in devices if d["device_type"] == "Router" and d["available"] and d["neighbors"]]
    return [d["ieee"] for d in sorted(routers, key=lambda d: (-children(d), d["ieee"]))]


def derive(sample: dict, removed: set[str], note: str) -> dict:
    """Copy of the sample with the tables of `removed` devices emptied."""
    out = json.loads(json.dumps(sample))
    for device in out["responses"]["zha/devices"]:
        if device["ieee"] in removed:
            device["neighbors"] = []
            device["routes"] = []
    out["derived"] = {"from": "zha-sample.json", "rule": note, "removed_tables": sorted(removed)}
    return out


def main() -> int:
    sample = json.loads((FIXTURES / "zha-sample.json").read_text(encoding="utf-8"))
    devices = sample["responses"]["zha/devices"]
    ranked = rank_routers(devices)
    every_router = {d["ieee"] for d in devices if d["device_type"] == "Router"}
    plans = {
        "zha-sample-minus1.json": (set(ranked[:1]), "the available router with most end-device children"),
        "zha-sample-minus3.json": (set(ranked[:3]), "the three available routers with most end-device children"),
        "zha-sample-coordinator-only.json": (every_router, "every router; only the coordinator's table stays"),
    }
    for name, (removed, note) in plans.items():
        (FIXTURES / name).write_text(json.dumps(derive(sample, removed, note), indent=1, ensure_ascii=False) + "\n",
                                     encoding="utf-8")
        print(f"{name}: {len(removed)} tables removed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
