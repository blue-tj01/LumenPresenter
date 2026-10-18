"""Tests for server.py. Run with: python3 -m unittest discover tests"""
import http.client
import json
import os
import shutil
import sys
import tempfile
import threading
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import server  # noqa: E402

LIB = {'presentations': [{'id': 'a', 'name': 'Song', 'groups': [], 'bg': None}], 'playlist': ['a'], 'media': []}


class ServerTest(unittest.TestCase):
    token = ''

    def setUp(self):
        self.data = tempfile.mkdtemp()
        self.start()

    def start(self):
        self.srv = server.LumenServer(('127.0.0.1', 0), self.data, self.token)
        self.port = self.srv.server_address[1]
        self.thread = threading.Thread(target=self.srv.serve_forever, daemon=True)
        self.thread.start()

    def stop(self):
        self.srv.shutdown()
        self.srv.server_close()

    def tearDown(self):
        self.stop()
        shutil.rmtree(self.data, ignore_errors=True)

    def req(self, method, path, body=None, headers=None):
        c = http.client.HTTPConnection('127.0.0.1', self.port, timeout=5)
        h = dict(headers or {})
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode()
            h.setdefault('Content-Type', 'application/json')
        if self.token:
            h.setdefault('X-Lumen-Token', self.token)
        c.request(method, path, body, h)
        r = c.getresponse()
        data = r.read()
        c.close()
        return r, data

    def events(self):
        """Open the event stream and return a reader of (event, data) pairs."""
        c = http.client.HTTPConnection('127.0.0.1', self.port, timeout=5)
        c.request('GET', '/api/events')
        r = c.getresponse()
        self.assertEqual(r.getheader('Content-Type'), 'text/event-stream')

        def next_event():
            ev, data = None, None
            while True:
                line = r.fp.readline().decode().rstrip('\n')
                if line.startswith('event: '):
                    ev = line[7:]
                elif line.startswith('data: '):
                    data = json.loads(line[6:])
                elif line == '' and ev:
                    return ev, data
        return c, next_event

    def test_static_allowlist(self):
        r, body = self.req('GET', '/')
        self.assertEqual(r.status, 200)
        self.assertIn(b'Lumen Presenter', body)
        self.assertEqual(self.req('GET', '/sync.js')[0].status, 200)
        for path in ('/server.py', '/.git/config', '/data/library.json', '/../etc/passwd', '/tests/test_server.py'):
            self.assertEqual(self.req('GET', path)[0].status, 404, path)

    def test_library_roundtrip_and_persistence(self):
        r, body = self.req('GET', '/api/library')
        self.assertEqual(json.loads(body), {'rev': 0, 'library': None})
        r, body = self.req('PUT', '/api/library', {'client': 'x', 'library': LIB})
        self.assertEqual(json.loads(body)['rev'], 1)
        self.stop()
        self.start()  # survives a restart
        self.assertEqual(json.loads(self.req('GET', '/api/library')[1]), {'rev': 1, 'library': LIB})

    def test_library_validation(self):
        self.assertEqual(self.req('PUT', '/api/library', {'library': {'nope': 1}})[0].status, 400)
        self.assertEqual(self.req('PUT', '/api/library', b'not json', {'Content-Type': 'application/json'})[0].status, 400)

    def test_live_is_pushed_and_persisted(self):
        c, next_event = self.events()
        ev, hello = next_event()
        self.assertEqual(ev, 'hello')
        self.assertIsNone(hello['live'])
        live = {'slide': {'text': 'Amazing grace'}, 'idx': 0}
        self.assertEqual(self.req('POST', '/api/live', {'client': 'op1', 'live': live})[0].status, 200)
        ev, d = next_event()
        self.assertEqual((ev, d['live'], d['origin']), ('state', live, 'op1'))
        self.req('PUT', '/api/library', {'client': 'op1', 'library': LIB})
        ev, d = next_event()
        self.assertEqual((ev, d['rev']), ('library', 1))
        c.close()
        self.stop()
        self.start()
        self.assertEqual(json.loads(self.req('GET', '/api/live')[1])['live'], live)
        c, next_event = self.events()
        self.assertEqual(next_event()[1]['live'], live)  # reconnecting windows get it straight away
        c.close()

    def test_media_upload_range_and_delete(self):
        blob = bytes(range(256)) * 40
        r, body = self.req('POST', '/api/media', blob, {'Content-Type': 'video/mp4', 'X-Filename': 'My%20Clip.mp4'})
        self.assertEqual(r.status, 201)
        m = json.loads(body)
        self.assertEqual((m['name'], m['type']), ('My Clip.mp4', 'video'))
        self.assertRegex(m['src'], r'^media/[a-z0-9]{16}\.mp4$')
        r, body = self.req('GET', '/' + m['src'])
        self.assertEqual((r.status, body, r.getheader('Content-Type')), (200, blob, 'video/mp4'))
        r, body = self.req('GET', '/' + m['src'], headers={'Range': 'bytes=100-199'})
        self.assertEqual((r.status, body, r.getheader('Content-Range')), (206, blob[100:200], f'bytes 100-199/{len(blob)}'))
        r, body = self.req('GET', '/' + m['src'], headers={'Range': 'bytes=-10'})
        self.assertEqual(body, blob[-10:])
        self.assertEqual(self.req('GET', '/' + m['src'], headers={'Range': 'bytes=999999-'})[0].status, 416)
        self.assertEqual(self.req('DELETE', '/api/' + m['src'])[0].status, 200)
        self.assertEqual(self.req('GET', '/' + m['src'])[0].status, 404)

    def test_media_extension_comes_from_media_types_only(self):
        page = b'<script>alert(1)</script>'
        r, body = self.req('POST', '/api/media', page, {'Content-Type': 'image/png', 'X-Filename': 'evil.html'})
        self.assertEqual(r.status, 201)
        src = json.loads(body)['src']
        self.assertTrue(src.endswith('.png'), src)
        r, _ = self.req('GET', '/' + src)
        self.assertEqual(r.getheader('Content-Type'), 'image/png')
        self.assertIn('sandbox', r.getheader('Content-Security-Policy'))
        r, body = self.req('POST', '/api/media', page, {'Content-Type': 'image/x-unknown', 'X-Filename': 'a.js'})
        self.assertEqual(r.status, 400)

    def test_media_rejects_other_types_and_bad_names(self):
        self.assertEqual(self.req('POST', '/api/media', b'x', {'Content-Type': 'text/html'})[0].status, 400)
        self.assertEqual(self.req('DELETE', '/api/media/..%2Flibrary.json')[0].status, 400)
        self.assertEqual(self.req('GET', '/media/..%2Flibrary.json')[0].status, 404)


class TokenTest(ServerTest):
    token = 's3cret'

    def test_writes_need_token(self):
        c = http.client.HTTPConnection('127.0.0.1', self.port, timeout=5)
        c.request('POST', '/api/live', json.dumps({'live': {}}), {'Content-Type': 'application/json'})
        self.assertEqual(c.getresponse().status, 401)
        c.close()
        c = http.client.HTTPConnection('127.0.0.1', self.port, timeout=5)
        c.request('POST', '/api/live', json.dumps({'live': {}}),
                  {'Content-Type': 'application/json', 'Authorization': 'Bearer s3cret'})
        self.assertEqual(c.getresponse().status, 200)
        c.close()
        self.assertTrue(json.loads(self.req('GET', '/api/health')[1])['auth'])


if __name__ == '__main__':
    unittest.main()
