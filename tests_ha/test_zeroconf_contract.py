# SPDX-License-Identifier: MIT
"""Contract with Home Assistant's zeroconf integration and the zeroconf library (#21; zeroconf 0.151.5 in Home
Assistant 2026.10.4, 0.152.0 in 2026.11.0): what thread_border_agents.py assumes still holds. The zeroconf integration
is set up with Home Assistant's own fixture mock_async_zeroconf (no sockets, no browser; the record cache is zeroconf's
real DNSCache), and records are put into that cache as zeroconf's record manager would after receiving them
(DNSPointer and DNSText with their reception time; an expired pointer, a record received again). Nothing is sent:
the command touches neither the instance nor a browser. Run: python3 -m pytest tests_ha"""

from zeroconf import DNSPointer, DNSText, current_time_millis

from homeassistant.setup import async_setup_component

from custom_components.meshroute_topology_explorer.const import DOMAIN

TYPE = "_meshcop._udp.local."
PTR, TXT, IN, UNIQUE = 12, 16, 1, 0x8000  # RFC 1035 3.2.2 and 3.2.4; the cache-flush bit, RFC 6762 10.2


def txt(*pairs):
    """TXT data as RFC 6763 6.1 writes it: per string one length byte, then key=value."""
    return b"".join(bytes([len(k) + 1 + len(v)]) + k + b"=" + v for k, v in pairs)


def agent(cache, name, text, age_ms, ttl=4500, pointer_ttl=4500):
    """A border agent's pointer and TXT record, received age_ms ago."""
    received = current_time_millis() - age_ms
    cache.async_add_records([DNSPointer(TYPE, PTR, IN, pointer_ttl, f"{name}.{TYPE}", created=received),
                             DNSText(f"{name}.{TYPE}", TXT, IN | UNIQUE, ttl, text, created=received)])


async def test_21_border_agents_from_the_real_zeroconf_cache(hass, hass_ws_client, entry, mock_async_zeroconf):
    command = {"type": f"{DOMAIN}/thread_border_agents"}
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    ws = await hass_ws_client(hass)  # after the setup: the minimum release freezes the web router with the client
    await ws.send_json_auto_id(command)
    refused = await ws.receive_json()
    assert refused["error"] == {"code": "not_supported", "message": "zeroconf_not_loaded: zeroconf is not loaded"}

    assert await async_setup_component(hass, "zeroconf", {})
    await hass.async_block_till_done()
    cache = mock_async_zeroconf.zeroconf.cache
    xp = bytes.fromhex("aabbccddeeff0101")
    agent(cache, "Garage", txt((b"rv", b"1"), (b"xa", bytes.fromhex("AABBCCDD00000110")), (b"xp", xp),
                               (b"pt", bytes.fromhex("89abcdef")), (b"nn", b"home"), (b"id", b"\x01" * 16)), 90_000)
    agent(cache, "Attic", txt((b"xa", bytes.fromhex("aabbccdd00000111")), (b"xp", xp), (b"pt", b"\x01\x02\x03")), 30_000)
    agent(cache, "Gone", txt((b"xa", bytes(8)), (b"xp", xp)), 200_000, ttl=120)  # expired 80 s ago: left out
    agent(cache, "Removed", txt((b"xa", b"\x11" * 8), (b"xp", xp)), 200_000, pointer_ttl=120)  # its pointer expired
    # The attic's TXT record received again 10 s ago, as zeroconf's record manager adds an answer: it replaces the old.
    agent(cache, "Attic", txt((b"xa", bytes.fromhex("aabbccdd00000111")), (b"xp", xp), (b"pt", b"\x01\x02\x03")), 10_000)
    calls = (list(mock_async_zeroconf.mock_calls), list(mock_async_zeroconf.zeroconf.mock_calls))

    await ws.send_json_auto_id(command)
    answer = await ws.receive_json()
    assert answer["success"], answer
    agents = answer["result"]["agents"]
    assert [{k: v for k, v in a.items() if k != "age"} for a in agents] == [
        {"ext_address": "aabbccdd00000110", "ext_pan_id": "aabbccddeeff0101", "partition_id": 0x89ABCDEF},
        {"ext_address": "aabbccdd00000111", "ext_pan_id": "aabbccddeeff0101", "partition_id": None}]
    # The age is the time since the record was received, in seconds (zeroconf's own clock; a test runs in well under 5 s).
    assert 90 <= agents[0]["age"] < 95 and 10 <= agents[1]["age"] < 15
    assert isinstance(answer["result"]["read_at"], float)
    # Read only: no call on the instance or on zeroconf (no query, no browser, no service lookup).
    assert (list(mock_async_zeroconf.mock_calls), list(mock_async_zeroconf.zeroconf.mock_calls)) == calls
