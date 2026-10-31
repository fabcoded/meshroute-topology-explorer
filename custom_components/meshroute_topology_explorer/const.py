# SPDX-License-Identifier: MIT
"""Constants of the integration. The version must equal manifest.json and VERSION in frontend/panel.js
(tests/test_integration_files.py checks all three)."""

DOMAIN = "meshroute_topology_explorer"
VERSION = "0.1.0"
TITLE = "Meshroute Topology Explorer"
PANEL_URL_PATH = "meshroute-topology"
PANEL_ELEMENT = "meshroute-topology-explorer"
STATIC_URL_BASE = f"/{DOMAIN}/{VERSION}"

STORE_VERSION = 1
# Written one burst after the last change: the panel may send settings on every slider move.
STORE_SAVE_DELAY = 10  # seconds
# Spec section 10: payloads above this serialized size are rejected.
MAX_PAYLOAD_BYTES = 256 * 1024
# Network id as used by the panel (today the ZHA config entry id); spec section 10.
NETWORK_ID_PATTERN = r"[A-Za-z0-9_.:-]{1,64}"
