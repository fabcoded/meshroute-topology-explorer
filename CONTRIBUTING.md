# Contributing

Project rules live in [AGENTS.md](AGENTS.md); they apply to people and AI agents alike. This file covers setup,
checks and bug reports.

1. Agree substantial new features in an issue first. Keep each change to one concern.
2. Write the change yourself or with an agent, from the specification and the Home Assistant docs, not from other
   projects' code.
3. Run `python3 tools/check.py`. Describe the change, its evidence and what remains untested as AGENTS.md
   ("Tests and handover") asks.
4. Add a provenance trailer to every commit: `Provenance: human`, or `Provenance: agent <tool>/<model>` with an
   optional `; brief <id>`. As the person submitting, sign off (`git commit -s`, the
   [Developer Certificate of Origin](https://developercertificate.org/)); agents never sign off.
5. Use anonymized captures only (`tools/anonymize_capture.py`); never post real ones in issues or pull requests.

By contributing you agree that your work is published under the MIT License.

## Development setup

Python 3.13 and Node.js 22 (22.13 or newer), as in CI; `tools/check.py` refuses other versions. The packages below
are for development only; the integration has no runtime dependencies and no build step. From the repository root:

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
CI runs the same script. Single steps while iterating:

| Command | Checks |
|---|---|
| `pre-commit run --all-files` | Ruff, ESLint, `tools/guard.py`, JSON/YAML/TOML, merge markers, keys, large files |
| `python3 -m unittest discover -s tests` | Python: integration setup, websocket API, zigpy routes, capture, guard |
| `npm test` | JavaScript: models, engines, rendering, UI behavior, CPU budgets |
| `node --test tests/<name>.test.mjs` | One JavaScript test file |

- `tools/guard.py` enforces the ground rules: allowed Home Assistant commands, no outside URLs or HTML sinks in
  shipped files, SPDX lines.
- The whitespace and end-of-file hooks fix files in place and fail; review the change, stage it and commit again.
- `npm run lint` runs only the ESLint in `node_modules`; without it, it stops and asks for `npm ci`.
- Versions are locked in `package-lock.json` and `.pre-commit-config.yaml`; Dependabot proposes updates monthly.
- Hassfest and, once the repository is public, HACS validation run only in CI: check the CI result of every push.

## Bug reports

Give the revision, Home Assistant version, network type, data source, steps, expected and actual result, and attach
an anonymized capture you have looked through. Search existing issues first. Security issues:
[SECURITY.md](SECURITY.md).
