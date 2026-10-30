"""server.py 的測試：金鑰讀取、重試與本機代轉的安全檢查。

執行：python -m unittest discover -s tests
"""
import http.client
import io
import json
import os
import sys
import tempfile
import threading
import unittest
import urllib.error
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import server  # noqa: E402


def http_error(code, headers=None):
  return urllib.error.HTTPError(server.JEV_URL, code, "error", headers or {}, io.BytesIO(b"{}"))


class FakeResponse:
  status = 200

  def read(self):
    return b'{"ok": true}'

  def __enter__(self):
    return self

  def __exit__(self, *args):
    return False


class LoadKeyTest(unittest.TestCase):
  def setUp(self):
    self.tmp = tempfile.TemporaryDirectory()
    self.addCleanup(self.tmp.cleanup)
    # 不讓開發者電腦上真的金鑰影響測試結果
    patches = [mock.patch.object(server, "ROOT", Path(self.tmp.name)), mock.patch.dict(os.environ, clear=True)]
    for p in patches:
      p.start()
      self.addCleanup(p.stop)

  def write_env(self, text):
    Path(self.tmp.name, ".env").write_text(text, encoding="utf-8")

  def test_environment_variable_wins_over_env_file(self):
    self.write_env("TYPESAFE_API_KEY=from-file\n")
    os.environ["TYPESAFE_API_KEY"] = " from-env "
    self.assertEqual(server.load_key(), "from-env")

  def test_reads_quoted_key_from_env_file(self):
    self.write_env('# 註解\nTYPESAFE_API_KEY="from-file"\n')
    self.assertEqual(server.load_key(), "from-file")

  def test_placeholder_and_missing_key_mean_not_ready(self):
    self.assertEqual(server.load_key(), "")
    self.write_env("TYPESAFE_API_KEY=your-key-here\n")
    self.assertEqual(server.load_key(), "")


class RetryTest(unittest.TestCase):
  def test_retry_delay_prefers_server_hint_and_caps_at_five_seconds(self):
    self.assertEqual(server.retry_delay({"retry-after-ms": "250"}, 0), 0.25)
    self.assertEqual(server.retry_delay({"Retry-After": "2"}, 0), 2)
    self.assertEqual(server.retry_delay({"Retry-After": "60"}, 0), 5)
    self.assertEqual(server.retry_delay({}, 0), 0.5)
    self.assertEqual(server.retry_delay({}, 1), 1)

  @mock.patch.object(server.time, "sleep")
  def test_retries_on_429_then_succeeds(self, sleep):
    responses = [http_error(429), http_error(529), FakeResponse()]
    with mock.patch.object(server.urllib.request, "urlopen", side_effect=responses) as urlopen:
      self.assertEqual(server.call_jev(b"{}", "key"), (200, b'{"ok": true}'))
    self.assertEqual(urlopen.call_count, 3)
    self.assertEqual(sleep.call_count, 2)

  @mock.patch.object(server.time, "sleep")
  def test_gives_up_after_max_tries(self, sleep):
    with mock.patch.object(server.urllib.request, "urlopen", side_effect=[http_error(429)] * server.MAX_TRIES):
      status, _ = server.call_jev(b"{}", "key")
    self.assertEqual(status, 429)

  def test_does_not_retry_client_errors(self):
    with mock.patch.object(server.urllib.request, "urlopen", side_effect=[http_error(401)]) as urlopen:
      status, _ = server.call_jev(b"{}", "key")
    self.assertEqual(status, 401)
    self.assertEqual(urlopen.call_count, 1)


class HandlerTest(unittest.TestCase):
  def setUp(self):
    self.tmp = tempfile.TemporaryDirectory()
    self.addCleanup(self.tmp.cleanup)
    Path(self.tmp.name, "index.html").write_text("<h1>ok</h1>", encoding="utf-8")
    Path(self.tmp.name, ".env").write_text("TYPESAFE_API_KEY=secret-key\n", encoding="utf-8")
    patches = [
      mock.patch.object(server, "ROOT", Path(self.tmp.name)),
      mock.patch.dict(os.environ, clear=True),
      mock.patch.object(server.Handler, "log_message", lambda *args: None),
    ]
    for p in patches:
      p.start()
      self.addCleanup(p.stop)
    self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
    threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
    self.addCleanup(self.httpd.server_close)
    self.addCleanup(self.httpd.shutdown)

  def request(self, method, path, body=None, headers=None):
    conn = http.client.HTTPConnection("127.0.0.1", self.httpd.server_address[1], timeout=5)
    self.addCleanup(conn.close)
    conn.request(method, path, body=body, headers=headers or {})
    res = conn.getresponse()
    return res.status, res.read()

  def post_jev(self, body=b"{}", **headers):
    return self.request("POST", "/api/jev", body, {"Content-Type": "application/json", **headers})

  def test_serves_static_files_but_never_env(self):
    self.assertEqual(self.request("GET", "/index.html")[0], 200)
    status, body = self.request("GET", "/.env")
    self.assertEqual(status, 404)
    self.assertNotIn(b"secret-key", body)

  def test_status_reports_whether_key_is_set(self):
    self.assertEqual(json.loads(self.request("GET", "/api/jev/status")[1]), {"ready": True})
    Path(self.tmp.name, ".env").unlink()
    self.assertEqual(json.loads(self.request("GET", "/api/jev/status")[1]), {"ready": False})

  def test_rejects_requests_from_other_sites(self):
    self.assertEqual(self.post_jev(Origin="https://evil.example")[0], 403)

  def test_rejects_non_json_requests(self):
    status, _ = self.request("POST", "/api/jev", b"{}", {"Content-Type": "text/plain"})
    self.assertEqual(status, 403)

  def test_rejects_empty_or_oversized_body(self):
    self.assertEqual(self.post_jev(b"")[0], 413)
    self.assertEqual(self.post_jev(b"x" * (server.MAX_BODY + 1))[0], 413)

  def test_returns_503_without_key(self):
    Path(self.tmp.name, ".env").unlink()
    self.assertEqual(self.post_jev()[0], 503)

  def test_forwards_body_and_key_to_upstream(self):
    with mock.patch.object(server, "call_jev", return_value=(200, b'{"answer": 1}')) as call:
      status, body = self.post_jev(b'{"q": 1}')
    self.assertEqual((status, body), (200, b'{"answer": 1}'))
    call.assert_called_once_with(b'{"q": 1}', "secret-key")

  def test_upstream_failure_becomes_502(self):
    with mock.patch.object(server, "call_jev", side_effect=OSError("timeout")):
      status, body = self.post_jev()
    self.assertEqual(status, 502)
    self.assertEqual(json.loads(body)["error"], "upstream")


if __name__ == "__main__":
  unittest.main()
