"""Serve the demo app on the board's loopback with caching off.

A preview must show the file as it is on disk right now (broken, then fixed),
so every response says ``no-store``.
"""

from __future__ import annotations

import functools
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoStoreHandler(SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *args) -> None:  # keep the container log quiet
        pass


if __name__ == "__main__":
    root, port = sys.argv[1], int(sys.argv[2])
    handler = functools.partial(NoStoreHandler, directory=root)
    ThreadingHTTPServer(("127.0.0.1", port), handler).serve_forever()
