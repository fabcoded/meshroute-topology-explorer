# Meshroute Topology Explorer

An interactive map of the Zigbee and Thread networks that Home Assistant manages: radio links and their quality, the
paths the available tables support, and how fresh and complete the data is. Built for finding problems in real
networks, quiet by default. Read only: it never controls devices and causes radio traffic only on a button you press
(a topology scan, reading one cluster's values).

**Status:** early development, nothing to install yet.

- Sources: Home Assistant's ZHA integration; Thread through Home Assistant's Matter integration as a preview.
- No build step and no outside requests, except map tiles from an address you configure. Behaviour:
  [docs/spec.md](docs/spec.md).
- Zigbee and Matter are trademarks of the Connectivity Standards Alliance, Thread is a trademark of the Thread Group.
  This project is not affiliated with or endorsed by them, the Home Assistant project or the Open Home Foundation.

## Capturing your network for a bug report

`tools/capture.py` reads what the panel reads (areas, devices, config entries, ZHA devices with their neighbour and
route tables) and writes an anonymized file to attach to an issue. Python 3.10 or newer, no installation.

1. In Home Assistant, create a long-lived access token in your profile (an administrator account is needed for the
   ZHA command).
2. Run the tool. The token comes from the environment or a prompt without echo; there is no `--token` option,
   because a command line stays in the shell history.

```sh
read -rs HASS_TOKEN && export HASS_TOKEN      # type or paste the token, nothing is shown
python3 tools/capture.py --url http://homeassistant.local:8123 --out capture.json
unset HASS_TOKEN
```

- It sends exactly four read commands (`config/area_registry/list`, `config/device_registry/list`,
  `config_entries/get`, `zha/devices`), no scan, and talks only to the given address. `https://` uses the system's
  certificate store; `--cafile ca.pem` adds your own CA. Certificate checks cannot be switched off.
- Addresses, names, areas and ids are replaced before the file is written (`tools/anonymize_capture.py`). Look
  through the file before you share it. Never paste a token into an issue.
- `--raw` writes real addresses and names. Do not share that file; run
  `python3 tools/anonymize_capture.py raw.json safe.json` on it first.
- Exit codes: 0 ok, 1 usage, 2 cannot connect, 3 authentication failed, 4 command refused, 5 timeout, 6 anonymizer
  refused.

## How the code is organized

The panel lives in `custom_components/meshroute_topology_explorer/frontend/`, plain JavaScript. One viewer engine per
network type, one adapter per data source, and a shared shell that knows neither (spec 4.6):

| Folder | What it holds |
|---|---|
| `engines/index.js` | The registry: `engineFor(network)` finds a network's engine and never falls back to one. |
| `engines/zigbee/` | Zigbee semantics: ZHA schema mapping (`from-zha.js`, with ZHA's capability set), model, paths and theoretical paths, findings, lane classes and the three path views (`lanes.js`, `scene.js`), options, settings keys, status line, texts, Details (`ui/`). |
| `engines/thread/` | Thread read through Matter: Matter mapping (`from-matter.js`), parents, pairs, status and findings (`model.js`), parent and neighbour lanes (`lanes.js`, `scene.js`), status, Details, texts; `quality.js` (reception model, under review, not wired). |
| `adapters/` | Data sources: `zha.js` (scan, observations, fingerprints) and `matter.js`, each with its texts; `index.js` lists them for the shell. |
| `graph/` | Shared drawing: layout (springs from the engine's quality), camera, gestures, symbols, palette, labels, lane geometry and stroke looks, the renderer of the engine's scene. |
| `ui/` | Shared frames: controller, settings client (shell keys), network switch, drawers, Devices, Findings, Legend and View tabs, status line frame, shared texts (`i18n.js`). |
| `panel.js` | The custom element that wires shell, engines and adapters together. |

`tests/engine-leaks.test.mjs` keeps the boundaries: no engine imports another, and shared code reaches the engines
only through `engines/index.js` and names no network or source.

Contributions from people and AI agents are welcome: [AGENTS.md](AGENTS.md), [CONTRIBUTING.md](CONTRIBUTING.md).
Security issues: [SECURITY.md](SECURITY.md). License: [MIT](LICENSE).
