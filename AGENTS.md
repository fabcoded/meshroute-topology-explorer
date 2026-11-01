# AGENTS.md

These are the shared project rules for people and coding agents. Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup
and checks. Tool-specific instruction files only point here; do not maintain competing policies.

## What we build

Meshroute Topology Explorer shows the Zigbee and Thread networks Home Assistant manages as a map: who hears whom,
which paths the available data supports, and how much the data can be trusted. It is a tool for debugging real
networks, so depth matters, but the default view stays calm: raw values, tables and scans live one click away, not on
top.

## Ground rules

- **Read only.** Radio traffic only on a button the user presses: the topology scan, and reading a cluster's attribute
  values once (`zha/devices/clusters/attributes/value`, decision by Fabian Schwamborn, 2026-11-01). Never automatic,
  never a write, no reporting, no binding; ZHA's own device page does those.
- **No secrets.** Never call commands that return network keys (`zha/network/*`, `otbr/*`, `thread/get_dataset*`)
  or change the network. `tools/guard.py` checks this and allows exactly the one attribute read.
- **Nothing leaves the house.** No telemetry, no CDNs. A map background may load tiles only from an address the
  user configured; no outside URL is ever written into the code.
- **Ship what you read.** No bundler and no runtime dependencies; the repository is what Home Assistant serves.
  The panel is plain DOM custom elements.
- **Unknown beats wrong.** Incomplete data is shown as unknown, never as weak or missing.

## Privacy and safety

- Agents never connect to a real Home Assistant or radio network; captures are made by people.
- Never commit a real capture, and never paste addresses, tokens or captures into issues or pull requests.
  Anonymize with `tools/anonymize_capture.py` first.
- Device and area names come from users and devices: render them as text, never as HTML.
- Report security problems privately, see [SECURITY.md](SECURITY.md).

## Own work, clear origin

- Build from the specification `docs/spec.md`, the Home Assistant developer docs and the anonymized captures in
  `tests/fixtures/`. Algorithms from papers and documentation are fine; please don't read or copy the source of
  other projects, mesh maps and graph libraries included.
- Home Assistant's own source (core and frontend) may be read for API contracts and public conventions only (event
  names, CSS variables, websocket behaviour), never for its network visualisation, and is cited where it matters.
- Code under a permissive licence (MIT, ISC, BSD) may be adopted only with its licence text in `NOTICE`; ask first.
- Name Zigbee, Matter, Thread and Home Assistant only to describe what the project shows: no logos, no
  "compatible" or "certified" claims.
- Every commit carries `Provenance: human` or `Provenance: agent <tool>/<model>` (optionally `; brief <id>`).
  Agents never add `Signed-off-by`; the person who reviewed the change and submits it does (`git commit -s`).

## Code

- English in code, comments and docs. Plain ES modules (no TypeScript, no decorators). The integration uses only
  what Home Assistant ships; Python tools and unit tests use the standard library only. Development linters and
  hooks are pinned in `package-lock.json` and `.pre-commit-config.yaml` and never shipped.
- Each file opens with what it does and how to run it, and an SPDX line (`SPDX-License-Identifier: MIT`).
  Comments explain why, not what.
- Run `python3 tools/check.py` before handing over a change; [CONTRIBUTING.md](CONTRIBUTING.md) has setup and single
  steps. Unit tests run without devices and in under a minute.

## Scope and evidence

- One agreed problem per change. Agree substantial features in an issue or a maintainer brief first; an agreed brief
  needs no further approval step.
- No unrelated refactoring in the change; remove what it makes obsolete. Never overwrite someone else's uncommitted
  work; use your own checkout or worktree for parallel edits.
- Protocol rules live in their network's viewer engine; data-source adapters carry no network semantics; presentation
  is shared where behavior is the same. Thread never inherits a Zigbee assumption to fill missing data.
- Cite source and version for protocol rules, thresholds and API assumptions. Keep reported values, table-derived
  paths, assumptions and computed candidates apart. Missing data never proves a failed link.
- No building, device list or capture in reusable code. Operational quirks go into the docs of the affected
  subsystem, not into agent memory. Update the existing account of a rule instead of adding a second one.

## Review criteria for generated-code habits

Defects a reviewer can point to, whoever wrote the change. This is not an AI detector and not a word list; ESLint,
Ruff and `tools/guard.py` catch what they can (unused code, `==`, focused tests, console output in shipped code,
commands outside the allow-list).

- **Invented interfaces:** a Home Assistant command, ZHA or Matter field or option that is not in the spec, the HA
  docs or a capture-derived fixture. A fixture written for the same change is no evidence that the field exists.
- **Unknown turned into a value:** `?? 0`, `|| []`, a guessed default or a broad `catch` that makes a missing reading
  look weak, a missing table look empty or a failure look like success. Keep it unknown; catch only where the code
  can act on the error, and keep its context.
- **Speculative structure:** factories, base classes, generic helpers, options or dependencies without a current
  caller. A new abstraction names its callers.
- **Noise in code:** comments that restate the next line, commented-out code, unused imports, TODOs without a
  follow-up, debug output.
- **Noise in text:** promotional or hedging phrases, canned introductions and closing summaries, invented terms,
  "robust" or "complete" without a test or measurement. UI annotations explain the shown value in one or two
  sentences in a formal technical register; protocol background goes into `docs/`, not into a help system.
- **Claims without evidence:** "tests pass" without command and numbers, a threshold without source, a screenshot
  presented as an interaction test.

## Tests and handover

- Test changed parsing, routing, rating, persistence and security boundaries, with missing, malformed and
  contradictory data, both directions, loops and limits where relevant. A fixed bug gets a test that fails without
  the fix, where practical.
- Expected values come from the spec, a protocol source or a hand-checked fixture, not from running the code under
  test. Assert behavior and meaning; pin exact text only for contracts (command allow-list, stored keys, terms the
  owner fixed), not to freeze an explanatory sentence.
- Fixtures are synthetic or anonymized and minimal; look through one before committing it, anonymization does not
  replace that. Inject clocks and timers, fix random seeds; no live services, credentials or sleeps in unit tests.
  CPU budgets measure CPU time in a single-threaded child process (`tests/layout-time.mjs`), never wall time.
- Never weaken, skip or delete a meaningful test to get a green run. No focused tests in commits; a `todo` or `skip`
  names what resolves it.
- Report the revision, the commands and their results with numbers (test cases, not files) and what remains
  untested. Never claim a check, browser test or device test that did not run.
- UI changes: inspect the affected views in a browser and state which views, keyboard and touch interactions were
  exercised.
- After a push, check the CI run of that revision; hassfest and HACS validation run only there.

## Responsibility

- AI-assisted contributions are welcome. The person who submits one understands the change, has reviewed its diff
  and evidence, and handles follow-up. Provenance and sign-off: see "Own work, clear origin".
- No messages or changes sent to outside services on someone's behalf without authorization.
- Hooks are a local convenience; CI runs the same checks. Never bypass a failing check (`--no-verify`) or add a broad
  lint exclusion; fix the cause or add a narrow exception with its reason.
