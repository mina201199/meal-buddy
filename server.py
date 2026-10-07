"""
今天吃什麼：本機伺服器（含 Jev 代轉）

用法：
    python server.py             開在 http://localhost:5173
    python server.py --open      順便打開瀏覽器
    python server.py 8080        換一個 port

為什麼需要它：
    TypeSafe 的 API 不接受網頁直接呼叫（會回 Disallowed CORS origin），
    而且 API 金鑰不能寫在網頁裡，所以由這支小程式在你的電腦上代轉。
    金鑰放在同一個資料夾的 .env（參考 .env.example）：
        TYPESAFE_API_KEY=你的金鑰

不想用 Jev 了：
    把 jev.js、server.py、start.bat、.env、.env.example 刪掉，
    再刪掉 index.html 最下面的 <script src="jev.js"></script>，直接打開 index.html 就好。

只用 Python 內建模組，不用另外安裝套件。
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
JEV_URL = os.environ.get("TYPESAFE_API_URL", "https://api.typesafe.ai/v1/systemone")
MAX_BODY = 512 * 1024
RETRY_STATUS = {429, 529}  # 官方建議：太多請求 / 伺服器過載時，等一下再重試
MAX_TRIES = 3
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}
PLACEHOLDER = "your-key-here"


def load_key():
    """每次請求都重新讀，改了 .env 不用重開也會生效。"""
    key = os.environ.get("TYPESAFE_API_KEY", "").strip()
    env = ROOT / ".env"
    if not key and env.exists():
        for line in env.read_text(encoding="utf-8-sig").splitlines():
            line = line.strip()
            if line.startswith("TYPESAFE_API_KEY="):
                key = line.split("=", 1)[1].strip().strip("\"'")
    return "" if key == PLACEHOLDER else key


def retry_delay(headers, attempt):
    """照伺服器給的 retry-after 等；沒給就 0.5、1 秒指數退避。最多等 5 秒。"""
    for name, scale in (("retry-after-ms", 0.001), ("Retry-After", 1)):
        try:
            return min(float(headers.get(name)) * scale, 5)
        except (TypeError, ValueError):
            pass
    return min(0.5 * 2 ** attempt, 5)


def call_jev(data, key):
    req = urllib.request.Request(
        JEV_URL,
        data=data,
        method="POST",
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "User-Agent": "sancan-local/1.0",
        },
    )
    for attempt in range(MAX_TRIES):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            if e.code in RETRY_STATUS and attempt < MAX_TRIES - 1:
                time.sleep(retry_delay(e.headers, attempt))
                continue
            return e.code, e.read()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_json(self, status, obj):
        self.send_bytes(status, json.dumps(obj, ensure_ascii=False).encode("utf-8"))

    def send_bytes(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def from_this_app(self):
        """只接受這個 app 自己的頁面來的請求，別的網站不能偷用你的額度。"""
        host = self.headers.get("Host", "")
        if urlsplit("//" + host).hostname not in LOCAL_HOSTS:
            return False
        origin = self.headers.get("Origin")
        return origin is None or urlsplit(origin).netloc == host

    def send_head(self):
        # 不讓瀏覽器讀到 .env（裡面有金鑰）
        if Path(self.translate_path(self.path)).name.lower().startswith(".env"):
            self.send_error(404)
            return None
        return super().send_head()

    def do_GET(self):
        if urlsplit(self.path).path == "/api/jev/status":
            return self.send_json(200, {"ready": bool(load_key())})
        super().do_GET()

    def do_POST(self):
        if urlsplit(self.path).path != "/api/jev":
            return self.send_error(404)
        if not self.from_this_app() or "application/json" not in self.headers.get("Content-Type", ""):
            return self.send_json(403, {"error": "forbidden"})
        key = load_key()
        if not key:
            return self.send_json(503, {"error": "no_key"})
        length = int(self.headers.get("Content-Length") or 0)
        if not 0 < length <= MAX_BODY:
            return self.send_json(413, {"error": "bad_size"})

        try:
            status, body = call_jev(self.rfile.read(length), key)
        except Exception as e:  # 網路斷線、逾時等
            return self.send_json(502, {"error": "upstream", "message": str(e)})
        self.send_bytes(status, body)

    def log_message(self, fmt, *args):
        # 只印 API 的請求，靜態檔案不洗版
        if args and "/api/" in str(args[0]):
            super().log_message(fmt, *args)


def main():
    try:  # 避免某些終端機印中文出錯、訊息卡在緩衝區
        sys.stdout.reconfigure(errors="replace", line_buffering=True)
    except (AttributeError, ValueError):
        pass
    args = sys.argv[1:]
    port = next((int(a) for a in args if a.isdigit()), 5173)
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    url = f"http://localhost:{port}"
    print(f"今天吃什麼：{url}")
    print("Jev 金鑰：" + ("已設定" if load_key() else "還沒設定（請建立 .env，參考 .env.example）"))
    print("按 Ctrl+C 結束")
    if "--open" in args:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
