# Quality

How this project is tested and measured, what blocks a change and what only reports. Setup and single commands:
[CONTRIBUTING.md](../CONTRIBUTING.md); rules for people and agents: [AGENTS.md](../AGENTS.md).

## Test pyramid

| Layer | Catches | Command |
|---|---|---|
| L0 lint and guard | Bug patterns, unsafe code, complexity, outside URLs, commands outside the allow-list, stale bundle | `pre-commit run --all-files` (Ruff, ESLint, `tools/complexity.py`, `tools/guard.py`, `node tools/bundle.mjs --check`) |
| L1 unit | Logic per function in Python and JavaScript, without devices; seeded random round trips (history files, routing walks) | `python3 -m unittest discover -s tests`, `npm test` |
| L1.5 shared goldens | Python and JavaScript disagreeing on a format both touch: history answer, route reads, stored data, day files. Python writes `tests/fixtures/golden/`, both languages read it | part of L1; `MESHROUTE_UPDATE_GOLDENS=1 python3 -m unittest discover -s tests` rewrites them |
| L2 real Home Assistant | Setup, options flow, websocket commands, panel registration, recorder timers and the zigpy topology contract on the minimum and the latest supported release | `python3 -m pytest tests_ha` in its own environment ([CONTRIBUTING.md](../CONTRIBUTING.md#tests-against-a-real-home-assistant-tests_ha)); CI runs both pins |
| L3 browser smoke | User journeys on the dev page in a real Chrome, checked against the page's `data-log` and numbers from the spec | `python3 tools/smoke.py` |
| L4 live check | What no fixture shows: a real installation after a release. The maintainer reads the history info, the Home Assistant log and a topology scan | by hand, by the maintainer, before a release is announced |

`python3 tools/check.py` runs L0 and L1 and stops at the first failure; `--full` adds L2 (when its package is
installed) and L3. CI runs the same script, plus hassfest and HACS validation, which exist only there. Spelling and
the other measures below run in `tools/quality.py` and in CI.

## Measures

`python3 tools/quality.py --base origin/main` takes all of them (needs `npm ci` and `requirements-quality.txt`).
Targets are trends unless a gate says otherwise.

| Measure | Tool | Target |
|---|---|---|
| Coverage per directory (adapters, engines, model, graph, ui, panel, Python) | `node --test` coverage, coverage.py | testable JavaScript (adapters, engines, model) and Python at least 85 %; graph, ui and panel are reported only, because the fake DOM cannot run the canvas code |
| Duplication | jscpd, 100 tokens and 10 lines | at most 3 % |
| Complexity | ESLint `sonarjs` (cognitive) for JavaScript, Ruff C901 (McCabe) for Python | no function above 15; the number falls, never rises; blocking for new code (Gates) |
| Type checking | pyright (basic mode, `pyproject.toml`) over `custom_components` and `tools`; `tsc` with `checkJs` and `noEmit` over the frontend (`jsconfig.json`; nothing is built or emitted) | the number falls, never rises |
| Licences | `license-checker-rseidelsohn` (npm) and `pip-licenses`; allowed: MIT, BSD-2-Clause, BSD-3-Clause, ISC, Apache-2.0, Python-2.0, 0BSD, BlueOak-1.0.0, MIT-CMU; LGPL-3.0 only in development tools and always flagged | no violation |
| Spelling | `typos` over code, docs and UI text (`_typos.toml`; fixtures, captures and the generated bundle are excluded) | no finding; project words go into the config with a reason |
| Dead code | `knip` (`knip.jsonc`): unused files and exports in the frontend | the number falls, never rises |
| Lint | Ruff, ESLint | no finding |
| Mutation tests | planned: StrykerJS on the engines, weekly | baseline first, then rising |

All measuring tools are development dependencies with exact pins (`requirements-quality.txt`, `tools/quality.py`);
nothing of them ships. The type, licence and dead-code counts depend on what is installed: they are taken in the
CI environment, without Home Assistant, so imports from it are unresolved and not counted.

Dead code: tests count as users, so an export that only a test imports is not reported. Exports that nothing at all
imports are findings; exports used only by tests are tolerated, because the engines expose pure functions to be
tested directly.

## Gates

- **Blocks today:** the CI job `ci` (L0, L1, `check.py`, L2 on both Home Assistant pins, hassfest, HACS validation).
- **Complexity ratchet** (L0, owner 2026-11-09): `tools/complexity.py`, pre-commit hook `complexity`. It fails when
  a function above 15 is not listed in `tools/complexity-baseline.json`, when a listed one rises, and when the list
  is stale (a listed function fell or is gone): `python3 tools/complexity.py --update` lowers and drops entries, never
  adds one. 15 means cognitive complexity for JavaScript (ESLint `sonarjs`) and McCabe complexity for Python (Ruff
  C901; `noqa` does not exempt). Functions are keyed by file and qualified name (`Class.method`, `outer>inner`,
  callbacks by their call, such as `test("title")`), so moved lines keep the key; a rename reads as new plus stale:
  rename the key in the same commit.
- **Reports only, with a PASS or FAIL line on new code:** coverage of changed lines (at least 80 %, from 20 changed
  lines), duplication on new code (at most 3 %), no new type finding on changed lines, no new Ruff or ESLint
  finding; the complexity line repeats the blocking gate. The summary of the CI job `quality` shows them per pull
  request.
- **Reports only, no gate line:** licences, spelling, dead code, the browser smoke test.
- **Planned:** the other gate lines become blocking when their weekly values have been stable for a few weeks.

## Weekly report

A scheduled run measures `main` every Monday and appends one line to `quality.jsonl` on the branch `quality`;
`quality/index.md` there is the trend table (now, last week, last month, target, status). The branch holds nothing
else and is never merged.

## How a change is reviewed

1. An issue states the problem or user story with acceptance criteria.
2. The change is built with tests that fail without it.
3. An independent review reads the diff against the issue and the rules; the author does not review their own work.
4. Findings are fixed; the checks run again and the evidence (commands, numbers, what stays untested) is reported.
5. The maintainer approves; the submitter signs off (`git commit -s`). A release or a deploy to a real installation
   needs the maintainer's explicit go.
