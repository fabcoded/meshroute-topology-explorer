# Contributing

Project rules live in [AGENTS.md](AGENTS.md); they apply to people and AI agents alike.

1. Agree substantial new features in an issue or an existing maintainer brief. Keep each change focused.
2. Write the change yourself or with an agent, from the specification and the Home Assistant docs, not from other
   projects' code.
3. Run the checks below. Explain the behavior before and after the change, its evidence and any limitations.
4. Add a provenance trailer to every commit: `Provenance: human`, or `Provenance: agent <tool>/<model>` with an
   optional `; brief <id>`. As the person submitting, sign off (`git commit -s`, the
   [Developer Certificate of Origin](https://developercertificate.org/)); agents never sign off.
5. Use anonymized captures only (`tools/anonymize_capture.py`); never post real ones in issues or pull requests.

By contributing you agree that your work is published under the MIT License.

## Development setup

Use Python 3.13 and Node.js 22.13 or newer in the 22.x series, matching CI. The integration has no new runtime dependencies or build step;
the packages below only support development. Run from the repository root:

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements-dev.txt
npm ci
pre-commit install
```

Pre-commit installs its pinned Python hook environments on first use; that step needs network access. Ordinary
tests use fixtures, not a Home Assistant instance. Do not configure real credentials for development checks.

## Checks

One command runs hooks, Python tests and JavaScript tests, stopping on the first failure:

```sh
python3 tools/check.py
```

| Command | Purpose |
|---|---|
| `pre-commit run --all-files` | File hygiene, structured files, private keys, Python/JS lint and safety guard |
| `python3 -m unittest discover -s tests -v` | Python behavior, anonymization, persistence and HA API boundaries |
| `npm test` | Node unit tests for models, engines, rendering contracts and UI behavior |
| `npm run lint` | ESLint recommended correctness rules, unused bindings, equality and focused-test checks |
| `pre-commit run ruff --all-files` | Python import/runtime mistakes and Bugbear checks (E4/E7/E9/F/B) |
| `python3 tools/guard.py` | Project-specific API, privacy, HTML-sink and source-header checks |

Hooks also validate JSON/YAML/TOML, reject merge markers, case-conflicting names, added files above 1 MiB and
private keys, and repair trailing whitespace and final newlines. Review any automatic edits and rerun before
committing. These checks do not guarantee that captures contain no personal data; inspect them yourself.

Linters do not reformat the existing codebase. CI runs the same hooks and tests plus hassfest and, for a public
repository, HACS validation. JavaScript packages are locked in `package-lock.json`; Python hook versions are pinned
in `.pre-commit-config.yaml`. Update development dependencies deliberately and rerun the full command.

For a focused iteration, run a relevant test file, then the full check before handover:

```sh
python3 -m unittest discover -s tests -p test_guard.py -v
node --test tests/model-table-view.test.mjs
```

New logic needs behavioral tests for relevant failures and boundaries. Pure explanatory text changes do not need
new tests that assert their exact wording. For UI changes, additionally check the affected desktop/mobile view,
keyboard focus and interaction. Record what was actually exercised. See AGENTS.md for evidence and writing rules.

## Reports and reviews

Bug reports should include the revision, HA version, network type, data source, reproduction, expected result and
actual result. Check for an existing report and attach only inspected, anonymized data. Report security issues
through [SECURITY.md](SECURITY.md).

A PR should explain one concrete change, cite relevant evidence and give the commands and results used to validate
it. Disclose agent assistance through the existing provenance trailers. The human submitter reviews the result and
handles follow-up; generated prose is not evidence that a test ran or a protocol claim is correct.
