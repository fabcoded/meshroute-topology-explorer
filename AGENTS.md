# AGENTS.md

Hello! Humans and AI agents are both welcome here, and the same few rules apply to everyone.

## What we build

Meshroute Topology Explorer shows the Zigbee and Thread networks Home Assistant manages as a map: who hears whom,
which way packets travel, and how much the data can be trusted. It is a tool for debugging real networks, so depth
matters, but the default view stays calm: raw values, tables and scans live one click away, not on top.

## Ground rules

- **Read only.** The one thing that may cause radio traffic is a topology scan the user starts with a button.
- **No secrets.** Never call commands that return network keys (`zha/network/*`, `otbr/*`, `thread/get_dataset*`)
  or change the network. `tools/guard.py` checks this.
- **Nothing leaves the house.** No telemetry, no CDNs. A map background may load tiles only from an address the
  user configured; no outside URL is ever written into the code.
- **Ship what you read.** No bundler; the repository is what Home Assistant serves. One runtime dependency
  (lit-core), pinned by hash.
- **Unknown beats wrong.** Incomplete data is shown as unknown, never as weak or missing.

## Privacy and safety

- Agents never connect to a real Home Assistant or radio network; captures are made by people.
- Never commit a real capture, and never paste addresses, tokens or captures into issues or pull requests.
  Anonymize with `tools/anonymize_capture.py` first.
- Device and area names come from users and devices: render them as text, never as HTML.
- Report security problems privately, see [SECURITY.md](SECURITY.md).

## Own work, clear origin

- Build from the specification in `docs/` (in progress), the Home Assistant developer docs and the anonymized
  captures in `tests/fixtures/`. Algorithms from papers and documentation are fine; please don't read or copy the
  source of other projects, mesh maps and graph libraries included.
- Code under a permissive licence (MIT, ISC, BSD) may be adopted only with its licence text in `NOTICE`; ask first.
- Name Zigbee, Matter, Thread and Home Assistant only to describe what the project shows: no logos, no
  "compatible" or "certified" claims.
- Every commit carries `Provenance: human` or `Provenance: agent <tool>/<model>` (optionally `; brief <id>`).
  Agents never add `Signed-off-by`; the person who reviewed the change and submits it does (`git commit -s`).

## Code

- English in code, comments and docs. Plain ES modules (no TypeScript, no decorators). The integration uses only
  what Home Assistant ships; tools and tests use the Python standard library only.
- Each file opens with what it does and how to run it, and an SPDX line (`SPDX-License-Identifier: MIT`).
  Comments explain why, not what.
- Tests run without devices and in under a minute: `python3 tools/guard.py`, `python3 -m unittest discover -s tests`
  and `node --test "tests/**/*.test.mjs"`.
- Keep changes small and the tests green.

Thank you for helping build the best free map of home radio networks.
