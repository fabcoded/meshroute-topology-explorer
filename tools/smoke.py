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
    # #20: Home Assistant's Thread integration answers (dev page fake); the unheard border router adds no lane
    ("Thread border routers: the subscription runs, 3 lanes", "network=thread&matter=borderrouters&steps=wait:300",
     [r"source thread", r"drawn 3 lanes"]),
]
# #4: a phone window with a system bar; the dev page pads the panel's container as Home Assistant does
INSET_JOURNEYS = [
    ("#4 phone: pill and fit button clear of the system bar", f"inset={INSET}&steps=wait:300", "412,860"),
    # the owner's phone: the app reports no top inset (the WebView sits below the status bar), only the bottom one
    ("#4 phone, no top inset: pill and fit button clear of the system bar", f"inset=0,{INSET}&steps=wait:300", "412,860"),
]


def inset_clear(state: str) -> list[str]:
    """#4: with a 48 px system bar the pill's and the fit button's bottom edges lie at least 48 px above the window bottom."""
    found = re.search(r"edges pill (-?\d+) fit (-?\d+) window (\d+)", state)
    if not found:
        return ["edges missing"]
    pill, fit, window = map(int, found.groups())
    return [f"{name} bottom {edge} > {window - INSET}" for name, edge in (("pill", pill), ("fit", fit)) if not 0 < edge <= window - INSET]


def run_journey(chrome: str, query: str, size: str = "1280,800") -> tuple[str, str]:
    """Load one dev-page URL and return (last state line, errors)."""
    url = f"http://127.0.0.1:{PORT}/dev/panel.html?{query}"
    # A fixed window: the overview skips lanes outside the view, and full Chrome's default window is smaller than
    # the headless shell's, so the lane count would depend on the browser (CI drew 91 of 95).
    dom = subprocess.run([chrome, "--headless", "--no-sandbox", f"--window-size={size}", "--virtual-time-budget=10000",  # noqa: S603 - fixed arguments
                          "--dump-dom", url],
                         check=True, capture_output=True, text=True, timeout=90).stdout
    grab = lambda name: html.unescape((re.search(rf'data-{name}="([^"]*)"', dom) or [None, ""])[1])  # noqa: E731
    return grab("log").split(" | ")[-1], grab("errors")


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
