#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Render the README screenshots (docs/images/*.png) from the dev page and its anonymized sample.

  python3 tools/screenshots.py [--chrome PATH] [--out DIR] [--only NAME ...]
      --chrome  headless Chromium or chrome-headless-shell binary (default: newest under ~/.cache/ms-playwright,
                installed by `npx playwright install chromium`)
      --out     where the PNGs go (default docs/images of this checkout)
      --only    render just these shots (names as in SHOTS)

Serves this checkout on 127.0.0.1:8793 with one extra page, /dev/shot.html: dev/panel.html with the dev menu
hidden. Every shot is a query of that page (see dev/panel-demo.js), rendered by the Chromium binary directly (no
npm package needed), then reduced to a 256-colour palette (Pillow, requirements-dev.txt). The sample network ships
with the repository and holds no real names or addresses, so the images can be published. The history shots read
the long synthetic sample history (tests/fixtures/zha-history-sample-long.json), never a capture.
Why dense: at the default density the base fit lets a spread map reach past a 1280 px window (graph-view.js
_fitCamera), and the README's first picture should show the whole network.
"""

from __future__ import annotations

import argparse
import functools
import glob
import http.server
import os
import subprocess
import sys
import threading
from pathlib import Path

from PIL import Image

PORT = int(os.environ.get("SHOT_PORT", 8793))  # SHOT_PORT: another port when 8793 is taken
ROOT = Path(__file__).resolve().parent.parent

HIST = (1100, 640)

# name, window (CSS px), device scale, query of dev/shot.html
SHOTS = [
    ("map-light", (1280, 760), 1.5, "density=dense&colors=1"),
    ("map-dark", (1280, 760), 1.5, "density=dense&colors=1&dark=1"),
    ("path-router16", (1440, 810), 1.5, "density=dense&colors=1&select=Router%2016&left=details"),
    # Path history window of the pair Router 23 / Coordinator (the lane: its hop Router 32 / Router 19) on the long synthetic sample history (7 days, 6 h steps).
    ("history-timeline", HIST, 1.5, "density=dense&colors=1&history=long&select=Router%2023&pair=Coordinator&htab=timeline&hrange=7d"),
    ("history-route", HIST, 1.5, "density=dense&colors=1&history=long&select=Router%2023&pair=Coordinator&htab=route&hrange=7d"),
    ("history-lane", HIST, 1.5, "density=dense&colors=1&history=long&select=Router%2032&pair=Router%2019&htab=lane&hrange=7d"),
    ("history-route-dark", HIST, 1.5, "density=dense&colors=1&dark=1&history=long&select=Router%2023&pair=Coordinator&htab=route&hrange=7d"),
    ("phone-map", (390, 844), 2, "phone=1&dark=1&density=dense&colors=1"),
    ("phone-findings", (390, 844), 2, "phone=1&dark=1&colors=1&left=findings"),
    ("phone-details", (390, 844), 2, "phone=1&dark=1&density=dense&colors=1&select=Router%2016&left=details"),
]


def handler_for(root: Path):
    """Static files of the checkout; /dev/shot.html is dev/panel.html with the dev menu hidden."""

    class Handler(http.server.SimpleHTTPRequestHandler):
        extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                          ".js": "text/javascript", ".mjs": "text/javascript"}

        def do_GET(self):
            if self.path.split("?")[0] != "/dev/shot.html":
                return super().do_GET()
            html = (root / "dev/panel.html").read_text(encoding="utf-8")
            hide = "<style>.dev-burger,.dev-menu{display:none!important}</style>"
            body = html.replace("</head>", hide + "</head>", 1).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return None

        def log_message(self, *args):
            pass

    return functools.partial(Handler, directory=str(root))


def find_chrome(explicit: str | None) -> str:
    """The given binary, else Playwright's headless shell, else its full Chromium."""
    if explicit:
        if not Path(explicit).is_file():
            sys.exit(f"--chrome: no such file: {explicit}")
        return explicit
    for pattern in ("chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell",
                    "chromium-*/chrome-linux64/chrome"):
        found = sorted(glob.glob(str(Path.home() / ".cache/ms-playwright" / pattern)))
        if found:
            return found[-1]
    sys.exit("no Chromium found under ~/.cache/ms-playwright (run `npx playwright install chromium`) "
             "- or pass --chrome PATH")


def main() -> None:
    parser = argparse.ArgumentParser(description="Render the README screenshots.")
    parser.add_argument("--chrome", help="Chromium or chrome-headless-shell binary")
    parser.add_argument("--out", type=Path, default=ROOT / "docs/images", help="output directory")
    parser.add_argument("--only", nargs="+", metavar="NAME", help="render only these shots")
    args = parser.parse_args()
    out = args.out.resolve()
    browser = find_chrome(args.chrome)
    out.mkdir(parents=True, exist_ok=True)
    server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler_for(ROOT))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        for name, (w, h), scale, query in SHOTS:
            if args.only and name not in args.only:
                continue
            png = out / f"{name}.png"
            # The virtual time budget lets the layout settle and the camera fit before the capture.
            subprocess.run([browser, "--no-sandbox", "--hide-scrollbars", f"--force-device-scale-factor={scale}",
                            f"--window-size={w},{h}", "--virtual-time-budget=8000", f"--screenshot={png}",
                            f"http://127.0.0.1:{PORT}/dev/shot.html?{query}"],
                           check=True, capture_output=True, timeout=90)
            # A palette keeps flat UI colours exact and the files small enough for a README.
            Image.open(png).convert("RGB").quantize(256, method=Image.Quantize.MEDIANCUT).save(png, optimize=True)
            print(f"{png.name}: {png.stat().st_size // 1024} KiB")
    finally:
        server.shutdown()


if __name__ == "__main__":
    main()
