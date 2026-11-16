# Development notes

Capturing a network for a bug report and how the code is organized. Back to the [README](../README.md); rules in
[AGENTS.md](../AGENTS.md) and [CONTRIBUTING.md](../CONTRIBUTING.md).

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

- It sends four read commands (`config/area_registry/list`, `config/device_registry/list`, `config_entries/get`,
  `zha/devices`); `--matter` adds the Matter server's cached Thread topology (`matter/network_topology` without
  refresh) and the border-router reads the panel uses (`thread/list_datasets`, `thread/discover_routers`,
  `meshroute_topology_explorer/thread_border_agents`). No scan, and it talks only to the given address. `https://` uses the system's
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
| `engines/thread/` | Thread read through Matter: Matter mapping (`from-matter.js`), parents, pairs, status and findings (`model.js`), routes from the Matter cache's route tables (`routes.js`), parent, neighbour and route lanes (`lanes.js`, `scene.js`), status, Details, texts; `quality.js` (reception model, under review, not wired). |
| `adapters/` | Data sources: `zha.js` (scan, observations, fingerprints) and `matter.js`, each with its texts; `index.js` lists them for the shell. |
| `graph/` | Shared drawing: layout (springs from the engine's quality), camera, gestures, symbols, palette, labels, lane geometry and stroke looks, the renderer of the engine's scene. |
| `ui/` | Shared frames: controller, settings client (shell keys), network switch, drawers, Devices, Findings, Legend and View tabs, status pill, shared texts (`i18n.js`). |
| `panel.js` | The custom element that wires shell, engines and adapters together. |
| `dist/panel.js` | Generated, do not edit: the sources above bundled into the one file Home Assistant serves (`npm run bundle`, #16). |

`tests/engine-leaks.test.mjs` keeps the boundaries: no engine imports another, and shared code reaches the engines
only through `engines/index.js` and names no network or source.
