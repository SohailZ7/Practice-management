#!/usr/bin/env python3
"""Tiny local HTTP server for the release gate: answers 200 to every method, echoing the request body size."""
import http.server, sys, json
class H(http.server.BaseHTTPRequestHandler):
    def _do(self):
        n = int(self.headers.get("content-length") or 0); body = self.rfile.read(n) if n else b""
        out = json.dumps({"echo": len(body)}).encode()
        self.send_response(200); self.send_header("content-type", "application/json"); self.send_header("content-length", "0" if self.command == "HEAD" else str(len(out))); self.end_headers()
        if self.command != "HEAD": self.wfile.write(out)
    do_GET = do_HEAD = do_POST = do_PUT = do_PATCH = do_DELETE = _do
    def log_message(self, *a): pass
http.server.ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
