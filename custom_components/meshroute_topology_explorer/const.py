# SPDX-License-Identifier: MIT
"""Constants of the integration. The version must equal manifest.json and VERSION in frontend/panel.js
(tests/test_integration_files.py checks all three)."""

DOMAIN = "meshroute_topology_explorer"
VERSION = "0.1.1"
TITLE = "Meshroute Topology Explorer"
PANEL_URL_PATH = "meshroute-topology"
PANEL_ELEMENT = "meshroute-topology-explorer"
# The panel files are served under this prefix plus a content hash of the frontend folder (__init__.py).
STATIC_URL_PREFIX = f"/{DOMAIN}"

STORE_VERSION = 1
# Written one burst after the last change: the panel may send settings on every slider move.
STORE_SAVE_DELAY = 10  # seconds
# Spec section 10: payloads above this serialized size are rejected.
MAX_PAYLOAD_BYTES = 256 * 1024
# Network id as used by the panel (today the ZHA config entry id); spec section 10.
NETWORK_ID_PATTERN = r"[A-Za-z0-9_.:-]{1,64}"

# Options (entry.options; docs/spec.md section 10.1). Defaults apply to keys an entry does not hold yet.
CONF_SIDEBAR = "sidebar"
CONF_RADIO_ACTIONS = "radio_actions"
CONF_RECORD = "record"
CONF_RECORD_HOURS = "record_hours"
CONF_KEEP_DAYS = "keep_days"
# Form-only fields, never stored: the confirmation of a short interval and the delete-on-submit switch.
CONF_CONFIRM_SHORT = "confirm_short"
CONF_DELETE_HISTORY = "delete_history"
DEFAULT_OPTIONS = {CONF_SIDEBAR: True, CONF_RADIO_ACTIONS: True, CONF_RECORD: True, CONF_RECORD_HOURS: 3,
                   CONF_KEEP_DAYS: 30}
RECORD_HOURS_RANGE = (1, 24)
KEEP_DAYS_RANGE = (1, 90)
# ZHA reads its tables every 4 h by default; a shorter record interval mostly repeats values (board M33), so it
# needs a confirmation.
RECOMMENDED_RECORD_HOURS = 3
HISTORY_DIR = f"{DOMAIN}_history"  # below /config/.storage
