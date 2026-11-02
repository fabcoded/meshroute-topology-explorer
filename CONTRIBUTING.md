# Contributing

Setup, checks and bug reports. The project rules for people and AI agents, including scope, clean-room origin,
provenance trailers, sign-off and captures, are in [AGENTS.md](AGENTS.md). By contributing you agree that your work
is published under the MIT License.

## Development setup

Python 3.13 and Node.js 22 (22.13 or newer), as in CI; `tools/check.py` refuses other versions. These packages are
for development only. From the repository root:

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements-dev.txt
npm ci
pre-commit install
```

The first hook run downloads the pinned hook environments and needs network access. Checks use fixtures, never a
Home Assistant instance or real credentials.

## Checks

`python3 tools/check.py` runs the hooks, the Python tests and the JavaScript tests and stops at the first failure.
CI runs the same script. Single steps:

| Command | Checks |
|---|---|
| `pre-commit run --all-files` | Ruff, ESLint, `tools/guard.py`, JSON/YAML/TOML, merge markers, keys, large files |
| `python3 -m unittest discover -s tests` | Python: integration setup, websocket API, zigpy routes, capture, guard |
| `npm test` | JavaScript: models, engines, rendering, UI behaviour, CPU budgets |
| `node --test tests/<name>.test.mjs` | One JavaScript test file |

- `tools/guard.py` enforces the ground rules: allowed Home Assistant commands, no outside URLs or HTML sinks in
  shipped files, SPDX lines.
- The whitespace and end-of-file hooks fix files in place and fail; review the change, stage it and commit again.
- `npm run lint` runs only the ESLint in `node_modules`; without it, it asks for `npm ci`.
- Versions are locked in `package-lock.json` and `.pre-commit-config.yaml`; Dependabot proposes updates monthly.
- Hassfest and, once the repository is public, HACS validation run only in CI.

## Bug reports

Search existing issues first. Give the revision, Home Assistant version, network type, data source, steps, expected
and actual result, and attach an anonymized capture you have looked through (see [README.md](README.md)).
Security issues: [SECURITY.md](SECURITY.md).
