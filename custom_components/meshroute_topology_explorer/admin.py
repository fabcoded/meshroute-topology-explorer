# SPDX-License-Identifier: MIT
"""The one administrator check of every websocket command of the integration (docs/spec.md section 10)."""

from __future__ import annotations

from typing import Any

from homeassistant.components import websocket_api


def check_admin(connection: Any, msg_id: int) -> bool:
    """Answer `unauthorized` and return False for anyone but an administrator (no user counts as none)."""
    user = connection.user
    if user is None or not user.is_admin:
        connection.send_error(msg_id, websocket_api.ERR_UNAUTHORIZED, "Unauthorized")
        return False
    return True
