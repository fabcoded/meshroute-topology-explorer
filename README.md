# Meshroute Topology Explorer

An interactive map of the Zigbee and Thread networks that Home Assistant manages: radio links and their quality,
the routes packets actually take, and how fresh and complete the data behind the picture is. Built for finding
real problems in real networks, quiet by default. Read-only: it never controls devices, and it causes radio traffic
only when you press a button for it (a topology scan, reading one cluster's values).

**Status:** early development, nothing to install yet.

- Sources: Home Assistant's ZHA integration first, Thread through Home Assistant's Matter integration later.
- No build step: the files in this repository are what Home Assistant serves. No outside requests, except map
  tiles from an address you configure yourself.
- Zigbee and Matter are trademarks of the Connectivity Standards Alliance, Thread is a trademark of the Thread Group.
  This project is not affiliated with or endorsed by them, the Home Assistant project or the Open Home Foundation.

## Capturing your network for a bug report

`tools/capture.py` reads what the panel reads (areas, devices, config entries, ZHA devices with their neighbour and
route tables) from your Home Assistant and writes an anonymized file you can attach to an issue. Python 3.10 or newer,
no installation.

1. In Home Assistant open your profile and create a long-lived access token (an administrator account is needed for
   the ZHA command).
2. Run it. The token comes from the environment or a prompt without echo; there is no `--token` option, because a
   command line stays in the shell history.

```sh
read -rs HASS_TOKEN && export HASS_TOKEN      # type or paste the token, nothing is shown
python3 tools/capture.py --url http://homeassistant.local:8123 --out capture.json
unset HASS_TOKEN
```

- Read only: it sends exactly four commands (`config/area_registry/list`, `config/device_registry/list`,
  `config_entries/get`, `zha/devices`), no scan, and talks only to the address you give. `https://` uses your
  system's certificate store; `--cafile ca.pem` adds your own CA. Certificate checks cannot be switched off.
- By default the result is anonymized before it is written: addresses, names, areas and ids are replaced, see
  `tools/anonymize_capture.py`. Look through the file once before you share it. Never paste a token into an issue.
- `--raw` skips anonymizing and writes real addresses and names. Do not share that file; run
  `python3 tools/anonymize_capture.py raw.json safe.json` on it first.
- Exit codes: 0 ok, 1 usage, 2 cannot connect, 3 authentication failed, 4 command refused, 5 timeout, 6 anonymizer refused.

Contributions from humans and AI agents are welcome, see [AGENTS.md](AGENTS.md) and [CONTRIBUTING.md](CONTRIBUTING.md).
Security issues: [SECURITY.md](SECURITY.md). License: [MIT](LICENSE).
