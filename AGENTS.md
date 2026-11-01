# AGENTS.md

These are the shared project rules for people and coding agents. Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup
and checks. Tool-specific instruction files only point here; do not maintain competing policies.

## What we build

Meshroute Topology Explorer shows the Zigbee and Thread networks Home Assistant manages as a map: who hears whom,
which paths the available data supports, and how much the data can be trusted. It is a tool for debugging real networks, so depth
matters, but the default view stays calm: raw values, tables and scans live one click away, not on top.

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
  what Home Assistant ships; Python tools and unit tests use the standard library only. Pinned development linters
  and hooks are separate from runtime dependencies.
- Each file opens with what it does and how to run it, and an SPDX line (`SPDX-License-Identifier: MIT`).
  Comments explain why, not what.
- Run `python3 tools/check.py` before handing over a code change. Setup and individual checks are in CONTRIBUTING.md.
  Tests run without devices; keep the ordinary unit suites under a minute on a development machine.

## Scope, evidence and architecture

- Work on one agreed problem at a time. Agree substantial new features in an issue or an existing maintainer brief;
  an agreed brief does not need another approval step. Prefer a small, testable increment.
- Keep unrelated refactoring out of the change; remove code made obsolete by it. Do not overwrite another person's
  uncommitted work. Use an isolated checkout for parallel edits and report the revision you reviewed.
- Keep protocol rules in their network's viewer engine. Share presentation where behavior is the same; data-source
  adapters are separate from network semantics. Do not make Thread inherit Zigbee assumptions to fill missing data.
- Cite sources and versions for protocol rules, thresholds and API assumptions. Distinguish reported values,
  table-derived paths, assumptions and computed candidates. Missing data does not prove a failed link.
- Keep reusable behavior independent of one building or capture. Document operational quirks near the affected
  subsystem, not in agent memory. Update affected documentation instead of adding a second account of the same rule.

## Avoid generated-code and writing habits

- Do not introduce factories, inheritance layers, generic helpers, dependencies or configuration switches for
  hypothetical future uses. Follow existing conventions; explain a necessary abstraction in terms of current callers.
- Do not hide unexpected failures with broad catches, silent defaults or guessed values. Catch errors at the boundary
  that can handle them; preserve useful context and expose missing data. Document intentional recovery behavior.
- Comments explain constraints and reasons, not a translation of each statement. Remove unused imports, dead code,
  commented-out alternatives and placeholder TODOs without a concrete follow-up.
- Use direct, specific English in code, UI and public docs. Avoid promotional claims, canned introductions,
  repeated summaries, invented jargon and claims of robustness or completeness without evidence.
- UI help explains the displayed value or option in one or two sentences. Put research and protocol background in
  technical documentation. Do not add help navigation to compensate for an unclear label.
- These are review criteria, not an AI detector or a vocabulary blacklist. Enforce objective defects with linters;
  judge clarity and scope in review, including human-written changes.

## Tests and handover

- Test changed parsing, routing, rating, persistence and security boundaries. Cover missing, malformed and
  contradictory data, directionality, loops and boundaries where relevant. Bug fixes should include a reproducer.
- Assert public behavior and independently justified expected results. Do not mirror the implementation in the test
  or freeze an explanatory sentence merely to prevent rewording. Security allow-lists and public contracts may need
  exact assertions. Do not weaken or delete meaningful tests just to get a passing run.
- Use synthetic or anonymized fixtures, controlled clocks and deterministic seeds. No live services, credentials,
  or arbitrary sleeps in unit tests. Separate tight performance benchmarks from ordinary correctness checks.
- Keep fixtures minimal, clean up temporary state and test both success and failure for data-writing code. No focused
  tests in commits; explain any skipped test. Anonymization does not replace inspecting a fixture before sharing it.
- Inspect UI changes in a browser. State which views, keyboard and touch interactions were exercised; screenshots
  alone are not interaction tests. Report untested cases explicitly.
- Report the revision, commands, results and remaining limitations. Distinguish test cases from test files; never
  claim a check or a device test that was not run.

## Responsibility

- AI-assisted contributions are welcome. The submitting person must understand the change, review its diff and
  evidence, and remain responsible for follow-up. The provenance and human sign-off rules above still apply.
- Do not send messages or publish changes to external services on someone's behalf without authorization.
- Installation of a hook is a local convenience, not enforcement: CI runs the same checks. Never bypass failing
  checks or add broad lint exclusions to finish a task; fix the issue or explain a narrow, justified exception.
