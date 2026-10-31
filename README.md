# Meshroute Topology Explorer

An interactive map of the Zigbee and Thread networks that Home Assistant manages: radio links and their quality,
the routes packets actually take, and how fresh and complete the data behind the picture is. Built for finding
real problems in real networks, quiet by default. Read-only: it never controls devices.

**Status:** early development, nothing to install yet.

- Sources: Home Assistant's ZHA integration first, Thread through Home Assistant's Matter integration later.
- No build step: the files in this repository are what Home Assistant serves. No outside requests, except map
  tiles from an address you configure yourself.
- Zigbee and Matter are trademarks of the Connectivity Standards Alliance, Thread is a trademark of the Thread Group.
  This project is not affiliated with or endorsed by them, the Home Assistant project or the Open Home Foundation.

Contributions from humans and AI agents are welcome, see [AGENTS.md](AGENTS.md) and [CONTRIBUTING.md](CONTRIBUTING.md).
Security issues: [SECURITY.md](SECURITY.md). License: [MIT](LICENSE).
