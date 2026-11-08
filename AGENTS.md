# AGENTS.md

Shared project rules for people and coding agents; setup and checks are in [CONTRIBUTING.md](CONTRIBUTING.md).
Tool-specific instruction files only point here.

## What we build

Meshroute Topology Explorer maps the Zigbee and Thread networks Home Assistant manages: who hears whom, which paths
the data supports, and how far the data can be trusted. It is a debugging tool for real networks; the default view
stays calm, and raw values, tables and scans are one click away.

## Ground rules

- **Read only.** Radio traffic only on a button the user presses: the topology scan, and one read of a cluster's
  attribute values (`zha/devices/clusters/attributes/value`). Never automatic, never a write, no reporting, no
  binding; ZHA's device page does those. One exception, owner 2026-11-03: the optional one-time
  scan 30 minutes after a start (`zha/topology/update` through ZHA's handler, off by default, spec 10.1).
- **No secrets.** Never call commands that return network keys (`zha/network/*`, `otbr/*`, `thread/get_dataset*`)
  or change the network. `tools/guard.py` enforces this and allows exactly the one attribute read.
- **Nothing leaves the house.** No telemetry, no CDNs. Map tiles only from an address the user configured; no outside
  URL in the code.
- **Ship what you read.** Home Assistant serves one generated, readable file, `frontend/dist/panel.js`: Rollup builds
  it from the sources beside it, without minifying and with comments kept, and a check (`node tools/bundle.mjs
  --check`, pre-commit and CI) proves it matches them (owner 2026-11-08, #16). No runtime dependencies; the panel is
  plain DOM custom elements.
- **Unknown beats wrong.** Incomplete data is shown as unknown, never as weak or missing.

## Privacy and safety

- Agents never connect to a real Home Assistant or radio network; people make captures.
- Never commit a real capture; never paste addresses, tokens or captures into issues or pull requests. Anonymize
  with `tools/anonymize_capture.py` first.
- Render device and area names as text, never as HTML.
- Report security problems privately: [SECURITY.md](SECURITY.md).

## Own work, clear origin

- Build from `docs/spec.md`, the Home Assistant developer docs and the anonymized captures in `tests/fixtures/`.
  Algorithms from papers and documentation are fine; do not read or copy the source of other projects, mesh maps and
  graph libraries included.
- Home Assistant's source (core, frontend) may be read for API contracts and public conventions only (event names,
  CSS variables, websocket behaviour), never for its network visualisation; cite it where it matters.
- Permissive code (MIT, ISC, BSD) only after asking, with its licence text in `NOTICE`.
- Name Zigbee, Matter, Thread and Home Assistant only to describe what the project shows: no logos, no "compatible"
  or "certified" claims.
- Every commit carries `Provenance: human` or `Provenance: agent <tool>/<model>` (optionally `; brief <id>`). Agents
  never add `Signed-off-by`; the person who reviewed and submits the change signs off (`git commit -s`, the
  [Developer Certificate of Origin](https://developercertificate.org/)).
- Sign-off is required from the release commit 0.1.0 on and for every external pull request. Older commits stay as
  they are.

## Code

- English in code, comments and docs. Plain ES modules (no TypeScript, no decorators). The integration uses only what
  Home Assistant ships; Python tools and unit tests (`tests/`) use the standard library only; the one exception is `tests_ha/`, which
  runs pytest against a real Home Assistant (owner decision 2026-11-06, quality plan L2) and is never part of `tests/`. Development linters, hooks and the bundler are
  pinned in `package-lock.json` and `.pre-commit-config.yaml` and never shipped.
- Each file opens with what it does, how to run it, and `SPDX-License-Identifier: MIT`. Comments explain why.
- Run `python3 tools/check.py` before handing over a change. Unit tests run without devices in under a minute.

## Scope and evidence

- One agreed problem per change. Agree substantial features in an issue or a maintainer brief first; an agreed brief
  needs no further approval.
- No unrelated refactoring; remove what the change makes obsolete. Never overwrite someone else's uncommitted work;
  use your own checkout or worktree for parallel edits.
- Protocol rules live in their network's viewer engine; data-source adapters carry no network semantics; presentation
  is shared where behaviour is the same. Thread never inherits a Zigbee assumption to fill missing data.
- Cite source and version for protocol rules, thresholds and API assumptions. Keep reported values, table-derived
  paths, assumptions and computed candidates apart. Missing data never proves a failed link.
- No building, device list or capture in reusable code. Operational quirks go into the docs of the affected
  subsystem, not into agent memory. Update the existing account of a rule instead of adding a second one.

## Review criteria for generated-code habits

Defects a reviewer can point to, whoever wrote the change; not an AI detector, not a word list. ESLint, Ruff and
`tools/guard.py` catch unused code, `==`, focused tests, console output in shipped code and commands outside the
allow-list.

- **Invented interfaces:** a Home Assistant command, ZHA or Matter field or option not in the spec, the HA docs or a
  capture-derived fixture. A fixture written for the same change is no evidence.
- **Unknown turned into a value:** `?? 0`, `|| []`, a guessed default or a broad `catch` that makes a missing reading
  look weak, a missing table empty or a failure a success. Catch only where the code can act, and keep the context.
- **Speculative structure:** factories, base classes, generic helpers, options or dependencies without a current
  caller. A new abstraction names its callers.
- **Noise in code:** comments restating the next line, commented-out code, unused imports, TODOs without follow-up,
  debug output.
- **Noise in text:** promotional or hedging phrases, canned introductions and summaries, invented terms, "robust" or
  "complete" without a test or measurement. UI annotations explain the shown value in one or two formal sentences;
  protocol background goes into `docs/`, not into a help system.
- **Claims without evidence:** "tests pass" without command and numbers, a threshold without source, a screenshot
  presented as an interaction test.

## Tests and handover

- Test changed parsing, routing, rating, persistence and security boundaries with missing, malformed and
  contradictory data, both directions, loops and limits. A fixed bug gets a test that fails without the fix, where
  practical.
- Expected values come from the spec, a protocol source or a hand-checked fixture, never from running the code under
  test. Assert behaviour; pin exact text only for contracts (command allow-list, stored keys, fixed terms).
- Fixtures are synthetic or anonymized and minimal; read each one before committing it. Inject clocks and timers, fix
  seeds; no live services, credentials or sleeps in unit tests. CPU budgets measure CPU time in a single-threaded
  child process (`tests/layout-time.mjs`), never wall time.
- Never weaken, skip or delete a meaningful test to get a green run. No focused tests in commits; a `todo` or `skip`
  names what resolves it.
- Report revision, commands and results with numbers (test cases, not files) and what remains untested. Never claim a
  check, browser test or device test that did not run.
- UI changes: inspect the affected views in a browser and state which views, keyboard and touch interactions ran.
- After a push, check the CI run of that revision; hassfest and HACS validation run only there.

## Responsibility

- AI-assisted contributions are welcome. The submitter understands the change, has reviewed its diff and evidence,
  and handles follow-up.
- No messages or changes to outside services on someone's behalf without authorization.
- Hooks are a local convenience; CI runs the same checks. Never bypass a failing check (`--no-verify`) or add a broad
  lint exclusion; fix the cause or add a narrow exception with its reason.
