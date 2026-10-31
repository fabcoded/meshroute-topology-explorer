# SPDX-License-Identifier: MIT
"""Constants of the integration. The version must equal manifest.json and VERSION in frontend/panel.js
(tests/test_integration_files.py checks all three)."""

DOMAIN = "meshroute_topology_explorer"
VERSION = "0.1.0"
TITLE = "Meshroute Topology Explorer"
PANEL_URL_PATH = "meshroute-topology"
PANEL_ELEMENT = "meshroute-topology-explorer"
STATIC_URL_BASE = f"/{DOMAIN}/{VERSION}"
