import json
import os
import threading
import uuid
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

HOST = "127.0.0.1"
PORT = 8765
ROOT = Path(os.environ.get("PROGRAMDATA", Path.home())) / "PSK_Scanner_Agent"
INBOX = ROOT / "inbox"
INBOX.mkdir(parents=True, exist_ok=True)

try:
    import pythoncom
    import win32com.client
except Exception:
    pythoncom = None
    win32com = None

try:
    from PIL import Image
except Exception:
    Image = None


def scan_document():
    if pythoncom is None or win32com is None:
        raise RuntimeError("WIA/pywin32 не встановлені")
    if Image is None:
        raise RuntimeError("Pillow не встановлений")

    pythoncom.CoInitialize()
    try:
        dialog = win32com.client.Dispatch("WIA.CommonDialog")
        image = dialog.ShowAcquireImage()
        if image is None:
            raise RuntimeError("Сканування скасовано")

        scan_id = uuid.uuid4().hex
        jpg_path = INBOX / f"{scan_id}.jpg"
        pdf_path = INBOX / f"{scan_id}.pdf"
        image.SaveFile(str(jpg_path))

        with Image.open(jpg_path) as im:
            rgb = im.convert("RGB")
            rgb.save(pdf_path, "PDF", resolution=300.0)

        try:
            jpg_path.unlink()
        except OSError:
            pass

        return {
            "id": scan_id,
            "filename": pdf_path.name,
            "path": str(pdf_path),
            "size": pdf_path.stat().st_size,
            "created_at": datetime.now().isoformat(timespec="seconds"),
        }
    finally:
        pythoncom.CoUninitialize()


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")

    def _json(self, obj, status=200):
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            self._json({"ok": True, "agent": "PSK Scanner Agent", "version": "1.0.0", "port": PORT})
            return
        if parsed.path == "/info":
            self._json({"ok": True, "scanner": "Canon MF212w", "protocol": "WIA/TWAIN", "inbox": str(INBOX)})
            return
        if parsed.path == "/file":
            fid = parse_qs(parsed.query).get("id", [""])[0]
            if not fid or any(c in fid for c in "/\\"):
                self._json({"error": "Невірний id"}, 400)
                return
            path = INBOX / f"{fid}.pdf"
            if not path.exists():
                self._json({"error": "Файл не знайдено"}, 404)
                return
            data = path.read_bytes()
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "application/pdf")
            self.send_header("Content-Disposition", f'inline; filename="{path.name}"')
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        self._json({"ok": True, "service": "PSK Scanner Agent", "endpoints": ["/health", "/info", "/scan", "/file?id=..."]})

    def do_POST(self):
        if self.path != "/scan":
            self._json({"error": "Unknown endpoint"}, 404)
            return
        try:
            result = scan_document()
            result["download_url"] = f"http://{HOST}:{PORT}/file?id={result['id']}"
            self._json({"ok": True, "document": result})
        except Exception as e:
            self._json({"ok": False, "error": str(e)}, 500)

    def log_message(self, fmt, *args):
        print("[agent] " + fmt % args)


def main():
    print("PSK Scanner Agent 1.0.0")
    print(f"Storage: {INBOX}")
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Listening on http://{HOST}:{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
