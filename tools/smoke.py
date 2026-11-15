#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Browser smoke test: user journeys on the dev page's anonymised sample network, no Playwright.

  python3 tools/smoke.py [--chrome PATH]      exit 1 if any journey fails; one line per journey

Each journey is a dev-page URL (dev/panel.html, steps replayed by dev/panel-demo.js) read with the browser's
--dump-dom: the last step's state line in body[data-log] and uncaught errors in body[data-errors]. Serving and
finding Chrome come from tools/screenshots.py (a Chrome on PATH counts too, as on GitHub's runners). Plan: layer L3.
"""

from __future__ import annotations

import argparse
import html
import http.server
import re
import shutil
import subprocess
import sys
import threading
import time

from screenshots import ROOT, find_chrome, handler_for

PORT = 8899
INSET = 48  # the simulated system bar of #4, px
PAIR = "select=Router%2032&pair=Router%2019&history=long&steps=wait:300"  # Router 32 / Router 19 on the long history
ROUTE = "select=Router%2023&pair=Coordinator&history=long&htab=route&steps=wait:300"
# name, query, patterns the last state line must match (spec 12: the coordinator stage draws 95 lanes)
JOURNEYS = [
    ("overview draws 95 lanes", "steps=wait:100", [r"drawn 95 lanes", r"\bmodule panel\.js;"]),
    # #16: the shipped bundle alone (a source copy loaded too would win the element name and hide a broken bundle)
    ("bundle alone draws 95 lanes", "bundle=1&steps=wait:100", [r"drawn 95 lanes", r"\bmodule dist/panel\.js;"]),
    ("device row selects, opens Details", "left=devices&steps=click:.device-row:nth-child(3)",
     [r"selected \S+; left details"]),
    ("status pill opens network menu", "steps=click:%23mte-pill", [r"menu open"]),
    ("pair window: Timeline", PAIR.replace("&steps", "&htab=timeline&steps"), [r"history Timeline"]),
    ("pair window: Route, Metro-Map", ROUTE, [r"history Route"]),
    ("pair window: Route, Mesh", ROUTE + ";click:.hist-switch button:nth-child(2)", [r"history Route"]),
    ("pair window: Direct link", PAIR.replace("&steps", "&htab=lane&steps"), [r"history Direct link"]),
    ("pill click opens the Direct link card", "select=Router%2032&history=long&steps=pill:Router%2032>Router%2019",
     [r"card open"]),
    ("Esc closes the card", "select=Router%2032&history=long&steps=pill:Router%2032>Router%2019;key:Escape",
     [r"card closed"]),
    ("Esc closes window", PAIR + ";key:Escape", [r"history closed"]),
    # #15: without ZHA the Thread map loads, the View tab has no Zigbee controls, the pill menu lists no networks
    ("Thread only: map, View, pill menu", "nozha=1&matter=1&right=view&steps=wait:100;click:%23mte-pill",
     [r"menu open", r"source thread", r"networks 0;", r"zigbee-inputs 0;", r"right view"]),
    # #20: Home Assistant's Thread integration answers (dev page fake): the snapshot's 3 nodes and the unheard border
    # router make 4 devices; it adds no lane
    ("Thread border routers: 4 devices, 3 lanes", "network=thread&matter=borderrouters&steps=wait:300",
     [r"source thread; devices 4;", r"drawn 3 lanes"]),
    # #21: border routers A and B advertise different partitions: the pill's second line says so
    ("Thread partitions advertised: pill", "network=thread&matter=routes&partitions=1&steps=wait:300",
     [r"pill [^;]*Border routers advertise 2 partitions;"]),
]
# #22: the route card's hop list stays inside the card, with long names, at the default drawer and on a phone
ROUTE_QUERY = "network=thread&matter=routes&longnames=1&select=Motion%20sensor&left=details&steps=wait:300"
# #25: the tables panel, opened by "Tables" or by the route card's "i", beside the left panel or as a sheet (name,
# query, window, expected mode of the last state, patterns: a regex for the last state line, or (step, regex) for the
# state line after that step, counted from 0)
TABLES = "network=thread&matter=routes&longnames=1&left=details"
SENSOR = "aa:bb:cc:dd:00:00:00:0a"  # the motion sensor's id in tests/thread-routes-fixture.mjs
TABLES_JOURNEYS = [
    ("#25 Tables at 1280: beside the drawer", f"{TABLES}&select=Motion%20sensor&tables=1&steps=wait:300", "1280,800", "side",
     [r"info closed; tablesbutton true", r"tables 2 "]),
    ("#25 an 'i' at 1280: About these values expanded", f"{TABLES}&select=Motion%20sensor&tables=info&steps=wait:300", "1280,800", "side",
     [r"info open; tablesbutton true; panelfocus summary"]),
    ("#25 Tables at 1280 with both panels open", f"{TABLES}&select=Motion%20sensor&right=view&tables=1&steps=wait:300", "1280,800", "side",
     [r"right \d+,0,1280,800 "]),
    # the boundary: a 809 px map leaves 809 - 320 - 16 = 473 px beside the drawer, exactly the hop table's 424 px plus
    # padding and scrollbar gutter; the info section expanded makes the body scroll, the hop table must still fit
    ("#25 boundary 809 px, info expanded: side by side, no table scrolls sideways", f"{TABLES}&select=Motion%20sensor&tables=info&steps=wait:300",
     "809,800", "side", [r"box 320,49,793,", r"info open"]),
    ("#25 a border router: neighbours only", f"{TABLES}&select=Border%20router%20A&tables=1&steps=wait:300", "1280,800", "side",
     [r"tables 1 ", r"routehops - card -"]),
    ("#25 808 px: a sheet over the full width", f"{TABLES}&select=Motion%20sensor&tables=1&steps=wait:300", "808,800", "sheet", []),
    ("#25 phone: a sheet above the bottom sheet", f"{TABLES}&select=Motion%20sensor&tables=1&phone=1&steps=wait:300", "412,860", "sheet", []),
    # keyboard: Enter on "Tables" opens it with focus on its close button, Esc closes only the panel, focus back on "Tables"
    ("#25 keyboard: Enter on Tables, Esc", f"{TABLES}&select=Motion%20sensor&steps=wait:300;focus:.tables-button;key:Enter;key:Escape",
     "1280,800", None, [(2, r"slideout side "), (2, r"tablesbutton true; panelfocus close"),
                        r"focus button\.button\(Tables\)", r"slideout closed; tablesbutton false", r"left details"]),
    # Esc topmost first: with focus on the map or on a map button it closes the panel and keeps the selection; an open
    # Direct link card is above it and takes the first Esc (the card leaves focus nowhere, so the map is focused again)
    ("#25 Esc on the map closes the panel, keeps the selection", f"{TABLES}&select=Motion%20sensor&tables=1&steps=wait:300;focus:canvas;key:Escape",
     "1280,800", None, [r"focus canvas", r"slideout closed", rf"selected {SENSOR};"]),
    ("#25 Esc on a zoom button closes the panel", f"{TABLES}&select=Motion%20sensor&tables=1&steps=wait:300;focus:.zoom .icon-button;key:Escape",
     "1280,800", None, [r"focus button\.icon-button", r"slideout closed", rf"selected {SENSOR};", r"left details"]),
    ("#25 Esc in a Direct link card closes the card first",
     "network=thread&matter=routes&left=details&select=Motion%20sensor&tables=1&steps=wait:300;pill:Motion%20sensor>Plug%202;key:Escape;focus:canvas;key:Escape",
     "1280,800", None,
     [(1, r"slideout side "), (1, r"card open"), (2, r"slideout side "), (2, r"card closed"), r"slideout closed"]),
    ("#25 Esc in the path history window closes the window first",
     f"{TABLES}&select=Motion%20sensor&tables=1&steps=wait:300;click:.history-button;wait:300;key:Escape", "1280,800", None,
     [(2, r"history (Timeline|Route|Direct link);"), (2, r"slideout side "), r"history closed;", r"slideout side "]),
    ("#25 Esc in the status menu closes the menu first",
     f"{TABLES}&select=Motion%20sensor&tables=1&steps=wait:300;click:%23mte-pill;key:Escape", "1280,800", None,
     [(1, r"menu open"), r"menu closed", r"slideout side "]),
    # review S1: a status menu or a Direct link card left open is no layer above the panel where the key comes from
    # elsewhere: Esc in the panel or on the Details tab closes the panel only, the menu or card stays, so does the drawer
    ("#25 Esc in the panel with the status menu left open closes the panel only",
     f"{TABLES}&select=Motion%20sensor&steps=wait:300;click:%23mte-pill;click:.tables-button;key:Escape", "1280,800", None,
     [(2, r"slideout side "), (2, r"panelfocus close"), (2, r"menu open"), r"slideout closed", r"menu open", r"left details"]),
    ("#25 Esc on the Details tab with a Direct link card left open closes the panel only",
     "network=thread&matter=routes&left=details&select=Motion%20sensor&tables=1&steps=wait:300;pill:Motion%20sensor>Plug%202;"
     "focus:.drawer[data-side=left] [role=tab][aria-selected=true];key:Escape", "1280,800", None,
     [(2, r"slideout side "), (2, r"card open"), r"focus button\.tab", r"slideout closed", r"card open", r"left details"]),
    # narrowing the map turns the left panel into a collapsed sheet, which takes the panel away (focus
    # goes to the map, the "Tables" button being hidden); widening again leaves it closed, and it opens beside the drawer
    ("#25 narrowing to 600 px closes it, widening keeps it closed",
     "network=thread&matter=routes&select=Motion%20sensor&collapsed=1&steps=wait:300;click:.tables-button;width:600;width:;click:.tables-button",
     "1280,800", "side", [(1, r"slideout side "), (2, r"slideout closed"), (2, r"focus canvas"), (3, r"slideout closed")]),
    # another tab of the left panel takes it away
    ("#25 leaving the Details tab closes it", f"{TABLES}&select=Motion%20sensor&tables=1&steps=wait:300;click:[role=tab]:nth-child(2)",
     "1280,800", None, [r"slideout closed", r"left findings"]),
]
# #4: a phone window with a system bar; the dev page pads the panel's container as Home Assistant does
INSET_JOURNEYS = [
    ("#4 phone: pill and fit button clear of the system bar", f"inset={INSET}&steps=wait:300", "412,860"),
    # the owner's phone: the app reports no top inset (the WebView sits below the status bar), only the bottom one
    ("#4 phone, no top inset: pill and fit button clear of the system bar", f"inset=0,{INSET}&steps=wait:300", "412,860"),
]


def route_inside(state: str) -> list[str]:
    """#22: the widest element of the hop list ends at or left of the card's right edge."""
    found = re.search(r"routehops (\d+) card (\d+)", state)
    if not found:
        return ["no route card (routehops missing or '-')"]
    widest, card = map(int, found.groups())
    return [] if widest <= card else [f"hop list reaches {widest} px, the card ends at {card} px"]


def details_inside(state: str) -> list[str]:
    """#22: the Details' body does not scroll sideways and no element of a card reaches past the card's right edge."""
    found = re.search(r"detailsbody (\d+)/(\d+) over (\d+)", state)
    if not found:
        return ["no Details (detailsbody missing or '-')"]
    scroll, client, over = map(int, found.groups())
    return ([f"the Details scroll sideways: {scroll} > {client} px"] if scroll > client else []) + (
        [f"an element reaches {over} px past its card"] if over > 0 else [])


def slideout_placed(state: str, mode: str) -> list[str]:
    """#25: the open tables panel lies inside the map; side by side it starts at the left panel's edge below its tab
    head, at most 600 px wide and 16 px short of the right panel or the map's edge, and every table fits without
    scrolling (the threshold's promise); a sheet spans the map's width (on a phone: above the bottom sheet); its table
    boxes end inside it."""
    box4 = r"(-?\d+),(-?\d+),(-?\d+),(-?\d+)"
    found = re.search(rf"slideout (\w+) box {box4} map {box4} left ({box4}|-) head (\d+) right ({box4}|-) tables (\d+) fit (\d+) reach (\d+)", state)
    if not found:
        return ["tables panel closed or measures missing"]
    g = found.groups()
    got, (bl, bt, br, bb), (ml, mt, mr, mb) = g[0], map(int, g[1:5]), map(int, g[5:9])
    left = list(map(int, g[10:14])) if g[9] != "-" else None
    head = int(g[14])
    right = list(map(int, g[16:20])) if g[15] != "-" else None
    tables, fit, reach = int(g[20]), int(g[21]), int(g[22])
    problems = [] if got == mode else [f"mode {got}, expected {mode}"]
    if bl < ml - 1 or bt < mt - 1 or br > mr + 1 or bb > mb + 1:
        problems.append(f"panel {bl},{bt},{br},{bb} leaves the map {ml},{mt},{mr},{mb}")
    if reach > br + 1:
        problems.append(f"a table box reaches {reach} px, the panel ends at {br} px")
    if got == "side":
        edge = (right[0] if right else mr) - 16
        if left is None or abs(bl - left[2]) > 1 or bt < head - 1 or br > edge + 1 or br - bl > 601:
            problems.append(f"side panel {bl},{bt},{br},{bb}: left panel ends at {left and left[2]}, head at {head}, room to {edge}")
        if fit != tables:
            problems.append(f"{tables - fit} of {tables} tables scroll sideways beside the drawer")
    elif got == "sheet":
        if bl > ml + 1 or br < mr - 1:
            problems.append(f"sheet {bl}..{br} does not span the map {ml}..{mr}")
        if left and left[1] <= mt + 1 and bt < head - 1:
            problems.append(f"sheet top {bt} above the side panel's tab head {head}")
        if left and left[1] > mt and bb > left[1] + 1:
            problems.append(f"sheet ends at {bb} px, below the bottom sheet's top {left[1]}")
    return problems


def absent(patterns: list, lines: list[str]) -> list[str]:
    """The patterns not found: a regex in the last state line, or (step, regex) in the state line after that step."""
    out = []
    for pattern in patterns:
        step, regex = pattern if isinstance(pattern, tuple) else (len(lines) - 1, pattern)
        if not re.search(regex, lines[step] if step < len(lines) else ""):
            out.append(f"missing {regex} after step {step}")
    return out


def inset_clear(state: str) -> list[str]:
    """#4: with a 48 px system bar the pill's and the fit button's bottom edges lie at least 48 px above the window bottom."""
    found = re.search(r"edges pill (-?\d+) fit (-?\d+) window (\d+)", state)
    if not found:
        return ["edges missing"]
    pill, fit, window = map(int, found.groups())
    return [f"{name} bottom {edge} > {window - INSET}" for name, edge in (("pill", pill), ("fit", fit)) if not 0 < edge <= window - INSET]


def run_journey(chrome: str, query: str, size: str = "1280,800") -> tuple[str, str]:
    """Load one dev-page URL and return (last state line, errors)."""
    lines, errors = journey_log(chrome, query, size)
    return lines[-1], errors


def journey_log(chrome: str, query: str, size: str = "1280,800") -> tuple[list[str], str]:
    """Load one dev-page URL and return (the state line after each step, errors)."""
    url = f"http://127.0.0.1:{PORT}/dev/panel.html?{query}"
    # A fixed window: the overview skips lanes outside the view, and full Chrome's default window is smaller than
    # the headless shell's, so the lane count would depend on the browser (CI drew 91 of 95).
    dom = subprocess.run([chrome, "--headless", "--no-sandbox", f"--window-size={size}", "--virtual-time-budget=10000",  # noqa: S603 - fixed arguments
                          "--dump-dom", url],
                         check=True, capture_output=True, text=True, timeout=90).stdout
    grab = lambda name: html.unescape((re.search(rf'data-{name}="([^"]*)"', dom) or [None, ""])[1])  # noqa: E731
    return grab("log").split(" | "), grab("errors")


def main() -> int:
    parser = argparse.ArgumentParser(description="Browser smoke test on the dev page.")
    parser.add_argument("--chrome", help="Chrome or Chromium binary (default: Playwright cache, then PATH)")
    args = parser.parse_args()
    chrome = args.chrome or shutil.which("google-chrome") or shutil.which("chromium") or find_chrome(None)
    server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler_for(ROOT))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    failed = 0
    try:
        for name, query, patterns in JOURNEYS:
            started = time.monotonic()
            state, errors = run_journey(chrome, query)
            missing = [p for p in patterns if not re.search(p, state)]
            ok = state and not errors and not missing
            failed += not ok
            print(f"{'ok  ' if ok else 'FAIL'} {name} ({time.monotonic() - started:.1f}s)"
                  + ("" if ok else f"\n     state: {state or 'no data-log'}\n     errors: {errors or '-'}\n     missing: {missing}"))
        # #22, completed: the hop list inside its card, and nothing of the Details beyond its card or scrolling sideways,
        # also at 800 px, where the drawer is at its narrowest (320 px) and long names have to break
        for name, size in (("#22 route hop list inside the card, desktop", "1280,800"), ("#22 route hop list inside the card, phone", "412,860"),
                           ("#22 Details inside their cards, no sideways scroll, 800 px", "800,800")):
            started = time.monotonic()
            state, errors = run_journey(chrome, ROUTE_QUERY + ("&phone=1" if size.startswith("412") else ""), size)
            problems = route_inside(state) + details_inside(state)
            failed += bool(problems or errors)
            print(f"{'FAIL' if problems or errors else 'ok  '} {name} ({time.monotonic() - started:.1f}s)"
                  + (f"\n     {problems or errors}" if problems or errors else ""))
        for name, query, size, mode, patterns in TABLES_JOURNEYS:
            started = time.monotonic()
            lines, errors = journey_log(chrome, query, size)
            state = lines[-1]
            problems = absent(patterns, lines)
            if mode:
                problems += slideout_placed(state, mode) + (route_inside(state) if "routehops -" not in state else [])
            failed += bool(problems or errors)
            print(f"{'FAIL' if problems or errors else 'ok  '} {name} ({time.monotonic() - started:.1f}s)"
                  + (f"\n     {problems or errors}\n     state: {state}" if problems or errors else ""))
        for name, query, size in INSET_JOURNEYS:
            started = time.monotonic()
            state, errors = run_journey(chrome, query, size)
            problems = inset_clear(state)
            failed += bool(problems or errors)
            print(f"{'FAIL' if problems or errors else 'ok  '} {name} ({time.monotonic() - started:.1f}s)"
                  + (f"\n     {problems or errors}" if problems or errors else ""))
    finally:
        server.shutdown()
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
