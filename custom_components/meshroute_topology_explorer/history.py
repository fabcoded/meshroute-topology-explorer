# SPDX-License-Identifier: MIT
"""Reception history on disk: append-only JSON lines, one file per network and UTC day. Standard library only.

Plan: docs/spec.md section 10.2 (board M34 option A). Blocking file I/O: callers run it in the executor.

File `<quoted network id>.<YYYY-MM-DD>.jsonl`, one JSON object per line:
- `{"k": [key, ...]}` extends the file's key table (device keys: IEEE for Zigbee, the Thread adapter's key for Thread; a
  network address no device holds is kept as its text, e.g. "0x2B82"); a row refers to a key by its position over all
  `k` lines of the file, so a file never needs rewriting.
- `{"t": epoch_seconds, "e": [...], "r": [...], "l": [...], "p": [...]}` one record, all tables of the network:
  `e` neighbour entries [receiver, sender, lqi(, rssi)]: receiver = the device whose table reports the value (it hears
  the sender), lqi and rssi numbers or null, the trailing rssi left out when null;
  `r` routing entries [holder, destination, next hop, status]: status is ZHA's text ("Active", ...);
  `l` route records [device, [relay, ...]]: the relays between the device and the coordinator, as zigpy holds them.
  `p` parent links [child, parent], from the neighbour entries' relationship (see sources.py);
  `r`, `l` and `p` are left out when empty (Thread has none of them).
- `{"t": epoch_seconds}` alone: nothing changed since the previous record. The first record of a file is always full,
  so a day file can be read without its neighbours.
Deleting a day file is the whole retention; the previous record per network is the only history held in memory.
"""

from __future__ import annotations

import json
import os
from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any, NamedTuple
from urllib.parse import quote, unquote

SUFFIX = ".jsonl"
# Neighbour table entries: (receiver key, sender key) -> (lqi, rssi).
Entries = dict[tuple[str, str], tuple[int | None, int | None]]


class Snapshot(NamedTuple):
    """Everything one record holds: neighbour entries, routing entries (holder, destination, next hop, status; sorted)
    and route records (device, relays; sorted). Equality is the dedupe rule."""

    neighbours: Entries
    routes: tuple[tuple[str, str, str, str], ...] = ()
    relays: tuple[tuple[str, tuple[str, ...]], ...] = ()
    parents: tuple[tuple[str, str], ...] = ()  # (child, parent) from the neighbour entries' relationship; sorted

    def is_empty(self) -> bool:
        return not (self.neighbours or self.routes or self.relays or self.parents)


def _rows(snapshot: Snapshot, index: dict[str, int]) -> dict[str, Any]:
    """The `e`, `r`, `l` members of a record line for a key table."""
    out: dict[str, Any] = {"e": []}
    for (receiver, sender), (lqi, rssi) in sorted(snapshot.neighbours.items()):
        out["e"].append([index[receiver], index[sender], lqi] + ([] if rssi is None else [rssi]))
    if snapshot.routes:
        out["r"] = [[index[h], index[d], index[n], status] for h, d, n, status in snapshot.routes]
    if snapshot.relays:
        out["l"] = [[index[d], [index[x] for x in relays]] for d, relays in snapshot.relays]
    if snapshot.parents:
        out["p"] = [[index[child], index[parent]] for child, parent in snapshot.parents]
    return out


def _keys_of(snapshot: Snapshot) -> list[str]:
    """Every key a snapshot refers to, in a stable order."""
    seen: dict[str, None] = {}
    for pair in sorted(snapshot.neighbours):
        seen.update(dict.fromkeys(pair))
    for row in snapshot.routes:
        seen.update(dict.fromkeys(row[:3]))
    for device, relays in snapshot.relays:
        seen.update(dict.fromkeys((device, *relays)))
    for pair in snapshot.parents:
        seen.update(dict.fromkeys(pair))
    return list(seen)


def _day(t: float) -> date:
    return datetime.fromtimestamp(t, UTC).date()


def _split(name: str) -> tuple[str, date] | None:
    """(network id, day) of a history file name, or None for any other file."""
    if not name.endswith(SUFFIX):
        return None
    parts = name[: -len(SUFFIX)].rsplit(".", 1)
    if len(parts) != 2:
        return None
    try:
        return unquote(parts[0]), date.fromisoformat(parts[1])
    except ValueError:
        return None


def _parse(path: Path, keys: list[str] | None = None) -> Iterator[tuple[float, Snapshot]]:
    """Replay one day file: (time, snapshot) per record; a time-only line repeats the previous snapshot.

    A line that does not parse (a write cut short by a power loss) is skipped, so one damaged line costs one record.
    `keys` (optional) receives the file's key table, so the appender needs only this one pass.
    """
    keys = [] if keys is None else keys
    current = Snapshot({})
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            try:
                obj = json.loads(line)
                if "k" in obj:
                    keys.extend(obj["k"])
                    continue
                if "e" in obj:
                    current = Snapshot(
                        {(keys[e[0]], keys[e[1]]): (e[2], e[3] if len(e) > 3 else None) for e in obj["e"]},
                        tuple((keys[r[0]], keys[r[1]], keys[r[2]], r[3]) for r in obj.get("r", [])),
                        tuple((keys[x[0]], tuple(keys[i] for i in x[1])) for x in obj.get("l", [])),
                        tuple((keys[c], keys[q]) for c, q in obj.get("p", [])))
                yield float(obj["t"]), current
            except (ValueError, KeyError, IndexError, TypeError):
                continue


class HistoryFiles:
    """The history folder. Not thread-safe: the recorder serialises all calls (one at a time through the executor)."""

    def __init__(self, folder: str | Path) -> None:
        self.folder = Path(folder)
        # network -> (day file, key list, last snapshot) of the file being appended to; loaded once per network.
        self._state: dict[str, tuple[date, list[str], Snapshot]] = {}

    def _files(self, network: str | None = None) -> list[tuple[str, date, Path]]:
        if not self.folder.is_dir():
            return []
        found = []
        for path in self.folder.iterdir():
            split = _split(path.name)
            if split and (network is None or split[0] == network):
                found.append((split[0], split[1], path))
        return sorted(found, key=lambda f: (f[0], f[1]))

    def _path(self, network: str, day: date) -> Path:
        return self.folder / f"{quote(network, safe='')}.{day.isoformat()}{SUFFIX}"

    def _load_state(self, network: str, day: date, path: Path) -> tuple[list[str], Snapshot]:
        """Key table and last snapshot of today's file (so a restart does not write a full record for nothing)."""
        cached = self._state.get(network)
        if cached and cached[0] == day:
            return cached[1], cached[2]
        keys: list[str] = []
        records = list(_parse(path, keys)) if path.is_file() else []  # one day file: a few dozen records
        return keys, records[-1][1] if records else Snapshot({})

    def append(self, network: str, t: float, snapshot: Snapshot) -> bool:
        """Add a record; returns False when it was a time-only record (nothing changed).

        The cached state (key table, last snapshot) is replaced only after the write succeeded; any failure drops it,
        so the next call reads the file again instead of trusting keys that never reached the disk.
        """
        day = _day(t)
        self.folder.mkdir(parents=True, exist_ok=True)
        path = self._path(network, day)
        new_file = not path.exists()
        try:
            keys, last = ([], Snapshot({})) if new_file else self._load_state(network, day, path)
            keys = list(keys)  # a copy: the cache keeps the old table until the write is done
            full = new_file or snapshot != last
            lines: list[dict[str, Any]] = []
            if full:
                known = set(keys)
                fresh = [k for k in _keys_of(snapshot) if k not in known]
                if fresh:
                    keys.extend(fresh)
                    lines.append({"k": fresh})
                lines.append({"t": int(t), **_rows(snapshot, {key: i for i, key in enumerate(keys)})})
            else:
                lines.append({"t": int(t)})
            text = "".join(json.dumps(line, separators=(",", ":")) + "\n" for line in lines)
            if not new_file and path.stat().st_size:
                with path.open("rb") as tail:
                    tail.seek(-1, os.SEEK_END)
                    # A write cut short earlier leaves a last line without newline; start on a fresh line so that
                    # only that one record is lost and not this one too.
                    text = text if tail.read(1) == b"\n" else "\n" + text
            with path.open("ab") as handle:
                handle.write(text.encode("utf-8"))
        except BaseException:
            self._state.pop(network, None)
            raise
        self._state[network] = (day, keys, snapshot)
        return full

    def prune(self, now: float, keep_days: int) -> int:
        """Delete day files that ended more than `keep_days` ago; returns how many."""
        limit = _day(now) - timedelta(days=keep_days)
        removed = 0
        for _network, day, path in self._files():
            if day < limit:
                path.unlink(missing_ok=True)
                removed += 1
        return removed

    def delete_all(self) -> None:
        """Remove every day file and the folder (history deleted by the user, or the integration removed)."""
        for _n, _d, path in self._files():
            path.unlink(missing_ok=True)
        self._state.clear()
        try:
            self.folder.rmdir()
        except OSError:
            pass  # absent or holding files that are not ours: leave it

    def series(self, network: str, receiver: str, sender: str, since: float) -> list[list[Any]]:
        """Points [time, lqi(, rssi)] of what `receiver`'s table reported for `sender`, records since `since`."""
        points: list[list[Any]] = []
        for _n, day, path in self._files(network):
            if day < _day(since):
                continue
            for t, snapshot in _parse(path):
                value = snapshot.neighbours.get((receiver, sender))
                if t >= since and value is not None:
                    points.append([int(t), value[0]] + ([value[1]] if value[1] is not None else []))
        return points

    def info(self) -> dict[str, Any]:
        """Number of records, first and last time (epoch seconds, None when empty) and bytes on disk."""
        count, first, last, size = 0, None, None, 0
        for _n, _d, path in self._files():
            size += path.stat().st_size
            for t, _snapshot in _parse(path):
                count += 1
                first = t if first is None else min(first, t)
                last = t if last is None else max(last, t)
        return {"records": count, "first": first, "last": last, "bytes": size}

    def records(self, network: str, since: float, until: float) -> dict[str, Any]:
        """Records of a network with since <= time <= until in the file format with one key table over the range:
        {"k": [...], "records": [{"t", "e", "r", "l", "p"} or {"t"} where nothing changed]}. The first record is full."""
        keys: list[str] = []
        index: dict[str, int] = {}
        out: list[dict[str, Any]] = []
        previous = None
        for _n, day, path in self._files(network):
            if day < _day(since) or day > _day(until):
                continue
            for t, snapshot in _parse(path):
                if not since <= t <= until:
                    continue
                if previous is not None and snapshot == previous:
                    out.append({"t": int(t)})
                    continue
                for key in _keys_of(snapshot):
                    if key not in index:
                        index[key] = len(keys)
                        keys.append(key)
                out.append({"t": int(t), **_rows(snapshot, index)})
                previous = snapshot
        return {"k": keys, "records": out}
