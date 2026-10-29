
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse
from datetime import datetime, timezone
from html import escape
import json

ROOT = Path(__file__).resolve().parent
VISITS_FILE = ROOT / "visits.jsonl"

HOST = "0.0.0.0"
PORT = int(__import__("os").environ.get("PORT", "8080"))
# Only explicitly listed files can be served.
PUBLIC_FILES = {
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/salah.html": ("salah.html", "text/html; charset=utf-8"),
    "/surahs.html": ("surahs.html", "text/html; charset=utf-8"),
    "/styles.css": ("styles.css", "text/css; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
    "/sw.js": ("sw.js", "text/javascript; charset=utf-8"),
    "/manifest.webmanifest": (
        "manifest.webmanifest",
        "application/manifest+json; charset=utf-8",
    ),
    "/data/prayer-times.json": (
        "data/prayer-times.json",
        "application/json; charset=utf-8",
    ),
}


class Handler(BaseHTTPRequestHandler):

    def log_message(self, fmt, *args):
        print(f"{self.client_address[0]} - {fmt % args}")

    def send_bytes(self, data, content_type, status=200):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(data)

    def send_text(self, message, status=200):
        self.send_bytes(
            message.encode("utf-8"),
            "text/plain; charset=utf-8",
            status,
        )

    def record_visit(self, path):
        entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(
                timespec="seconds"
            ),
            "client_ip": self.client_address[0],
            "path": path,
        }

        try:
            with VISITS_FILE.open("a", encoding="utf-8") as file:
                file.write(json.dumps(entry) + "\n")
        except OSError as error:
            print("Could not record visit:", error)

    def do_GET(self):
        path = urlparse(self.path).path

        # Homepage
        if path == "/":
            self.record_visit("/")
            path = "/index.html"

        # Server health check
        if path == "/health":
            self.send_bytes(
                b'{"status":"ok"}',
                "application/json; charset=utf-8",
            )
            return

        # Visitor history: local computer only
        if path == "/visitors":
            if self.client_address[0] not in ("127.0.0.1", "::1"):
                self.send_text(
                    "Visitor history is available only on this computer.",
                    403,
                )
                return

            self.show_visitors()
            return

        # Reject unlisted paths
        if path not in PUBLIC_FILES:
            self.send_text("Not found", 404)
            return

        filename, content_type = PUBLIC_FILES[path]
        file_path = ROOT / filename

        if not file_path.is_file():
            self.send_text(
                f"Missing project file: {filename}. "
                "Check your project folder.",
                404,
            )
            return

        try:
            self.send_bytes(file_path.read_bytes(), content_type)
        except OSError as error:
            print(f"Could not read {filename}: {error}")
            self.send_text("Could not read the requested file.", 500)

    def show_visitors(self):
        entries = []

        try:
            if VISITS_FILE.exists():
                lines = VISITS_FILE.read_text(
                    encoding="utf-8"
                ).splitlines()[-200:]

                for line in lines:
                    try:
                        entries.append(json.loads(line))
                    except json.JSONDecodeError:
                        continue
        except OSError as error:
            print("Could not read visitor history:", error)

        entries.reverse()

        rows = "".join(
            "<tr><td>{}</td><td>{}</td><td>{}</td></tr>".format(
                escape(str(item.get("timestamp", ""))),
                escape(str(item.get("client_ip", ""))),
                escape(str(item.get("path", ""))),
            )
            for item in entries
        )

        if not rows:
            rows = (
                '<tr><td colspan="3">'
                "No visits recorded."
                "</td></tr>"
            )

        page = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Visitor History</title>
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<main class="container">
<section class="card">
<h1>Visitor History</h1>
<p>Latest 200 homepage visits. Times are UTC.</p>
<div class="table-wrap">
<table>
<thead>
<tr>
<th>Timestamp</th>
<th>IP address</th>
<th>Path</th>
</tr>
</thead>
<tbody>""" + rows + """</tbody>
</table>
</div>
<p><a href="/">Back to portal</a></p>
</section>
</main>
</body>
</html>"""

        self.send_bytes(
            page.encode("utf-8"),
            "text/html; charset=utf-8",
        )


if __name__ == "__main__":
    print("Islamic Welcome Portal")
    print(f"Local PC: http://127.0.0.1:{PORT}")
    print(f"Other devices: http://192.168.12.41:{PORT}")
    print("Press Ctrl+C to stop.")

    server = ThreadingHTTPServer((HOST, PORT), Handler)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
    finally:
        server.server_close()
