"""Tests for server.py. Run with: python3 -m unittest discover tests"""
import contextlib
import http.client
import io
import json
import os
import shutil
import socket
import struct
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock

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


class NetworkModeTest(unittest.TestCase):
    """Network mode switched from the console: a saved token, rebinding, and who may see or change it."""

    def setUp(self):
        self.data = tempfile.mkdtemp()
        self.start()

    def start(self):
        self.srv = server.LumenServer((None, 0), self.data)
        self.port = self.srv.server_address[1]
        self.thread = threading.Thread(target=self.srv.serve, daemon=True)
        self.thread.start()

    def stop(self):
        self.srv.shutdown()
        self.srv.server_close()
        self.thread.join(5)

    def tearDown(self):
        self.stop()
        shutil.rmtree(self.data, ignore_errors=True)

    def req(self, method, path, body=None, headers=None):
        c = http.client.HTTPConnection('127.0.0.1', self.port, timeout=15)
        h = dict(headers or {})
        if body is not None:
            body = json.dumps(body).encode()
            h['Content-Type'] = 'application/json'
        c.request(method, path, body, h)
        r = c.getresponse()
        data = r.read()
        c.close()
        return r.status, json.loads(data) if data else None

    def test_local_only_by_default_with_a_saved_token(self):
        self.assertEqual(self.srv.server_address[0], '127.0.0.1')
        status, n = self.req('GET', '/api/network')
        self.assertEqual(status, 200)
        self.assertFalse(n['network'])
        self.assertFalse(n['locked'])
        self.assertRegex(n['token'], r'^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$')
        self.assertEqual(self.req('POST', '/api/live', {'live': {}})[0], 200)  # no token needed locally
        with open(os.path.join(self.data, 'settings.json')) as f:
            self.assertEqual(json.load(f)['token'], n['token'])
        if os.name == 'posix':
            self.assertEqual(os.stat(os.path.join(self.data, 'settings.json')).st_mode & 0o777, 0o600)

    def test_switching_on_rebinds_requires_the_token_and_persists(self):
        token = self.req('GET', '/api/network')[1]['token']
        status, n = self.req('POST', '/api/network', {'network': True})
        self.assertEqual(status, 200)
        self.assertTrue(n['network'])
        self.assertEqual(self.srv.server_address, ('0.0.0.0', self.port))
        self.assertEqual(self.req('POST', '/api/live', {'live': {}})[0], 401)
        self.assertEqual(self.req('POST', '/api/live', {'live': {}}, {'X-Lumen-Token': token})[0], 200)
        self.assertEqual(self.req('POST', '/api/network', {'network': False})[0], 401)

        self.stop()  # a restart (or an updated server.py) keeps both the mode and the token
        self.start()
        self.assertEqual(self.srv.server_address[0], '0.0.0.0')
        self.assertEqual(self.req('GET', '/api/network')[1]['token'], token)

        status, n = self.req('POST', '/api/network', {'network': False}, {'X-Lumen-Token': token})
        self.assertEqual(status, 200)
        self.assertEqual(self.srv.server_address[0], '127.0.0.1')
        self.assertEqual(self.req('POST', '/api/live', {'live': {}})[0], 200)

    def test_regenerate_token(self):
        old = self.req('GET', '/api/network')[1]['token']
        new = self.req('POST', '/api/network', {'regenerate': True})[1]['token']
        self.assertNotEqual(old, new)
        self.assertEqual(self.req('GET', '/api/network')[1]['token'], new)

    def test_proxied_requests_get_no_token_and_cannot_switch(self):
        fwd = {'X-Forwarded-For': '203.0.113.9'}
        status, n = self.req('GET', '/api/network', headers=fwd)
        self.assertEqual(status, 200)
        self.assertNotIn('token', n)
        self.assertEqual(self.req('POST', '/api/network', {'network': True}, fwd)[0], 403)
        self.assertEqual(self.srv.server_address[0], '127.0.0.1')

    def test_other_devices_need_the_token_to_see_anything(self):
        token = self.req('POST', '/api/network', {'network': True})[1]['token']
        remote = {'X-Forwarded-For': '192.168.1.20'}  # counts as another device

        def get(path, headers=None):
            c = http.client.HTTPConnection('127.0.0.1', self.port, timeout=5)
            c.request('GET', path, headers={**remote, **(headers or {})})
            r = c.getresponse()
            body = r.read()
            c.close()
            return r, body

        r, body = get('/output.html')
        self.assertEqual(r.status, 401)
        self.assertIn(b'access token', body)
        self.assertEqual(get('/api/library')[0].status, 401)
        self.assertEqual(get('/render.js')[0].status, 401)
        self.assertEqual(get('/api/health')[0].status, 200)
        self.assertEqual(get('/stage.html?token=nope')[0].status, 401)

        r, _ = get(f'/stage.html?token={token}')  # a link from the Network tab
        self.assertEqual(r.status, 303)
        self.assertEqual(r.getheader('Location'), '/stage.html')
        cookie = r.getheader('Set-Cookie').split(';')[0]
        self.assertIn('HttpOnly', r.getheader('Set-Cookie'))
        for path in ('/stage.html', '/render.js', '/api/library', '/api/live'):
            self.assertEqual(get(path, {'Cookie': cookie})[0].status, 200, path)
        self.assertEqual(self.req('POST', '/api/live', {'live': {}}, {**remote, 'Cookie': cookie})[0], 200)

        self.assertNotIn(token, cookie)  # the cookie holds a sign-in for this device, not the token itself

        self.req('POST', '/api/network', {'regenerate': True}, {'X-Lumen-Token': token})
        self.assertEqual(get('/stage.html', {'Cookie': cookie})[0].status, 401)  # signed out by a new token
        self.assertEqual(self.req('GET', '/api/library')[0], 200)  # this computer never needs it to read

    def sign_in(self, token, page='/output.html', agent='Mozilla/5.0 (iPhone) Safari/604.1'):
        c = http.client.HTTPConnection('127.0.0.1', self.port, timeout=5)
        c.request('GET', f'{page}?token={token}', headers={'X-Forwarded-For': '192.168.1.20', 'User-Agent': agent})
        r = c.getresponse()
        r.read()
        c.close()
        self.assertEqual(r.status, 303)
        return {'X-Forwarded-For': '192.168.1.20', 'Cookie': r.getheader('Set-Cookie').split(';')[0]}

    def test_devices_are_listed_and_can_be_disconnected(self):
        token = self.req('POST', '/api/network', {'network': True})[1]['token']
        phone = self.sign_in(token)
        laptop = self.sign_in(token, '/stage.html', 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36')

        c = http.client.HTTPConnection('127.0.0.1', self.port, timeout=5)  # the phone shows the output
        c.request('GET', '/api/events', headers={**phone, 'Referer': f'http://192.168.1.5:{self.port}/output.html'})
        stream = c.getresponse()
        self.assertEqual(stream.status, 200)
        stream.fp.readline()

        devices = self.req('GET', '/api/network', headers={'X-Lumen-Token': token})[1]['devices']
        self.assertEqual(sorted(d['device'] for d in devices), ['Chrome on Windows', 'Safari on iPhone'])
        iphone = next(d for d in devices if d['device'] == 'Safari on iPhone')
        self.assertEqual(iphone['open'], ['Audience output'])
        self.assertNotIn('token', self.req('GET', '/api/network', headers=phone)[1])
        self.assertTrue(self.req('GET', '/api/network', headers=phone)[1]['signedIn'])

        status, n = self.req('POST', '/api/network', {'disconnect': iphone['id']}, {'X-Lumen-Token': token})
        self.assertEqual([d['device'] for d in n['devices']], ['Chrome on Windows'])
        self.assertEqual(self.req('GET', '/api/library', headers=phone)[0], 401)
        self.assertEqual(self.req('GET', '/api/library', headers=laptop)[0], 200)
        while stream.fp.readline():  # the phone's open stream is closed too
            pass
        c.close()

        self.req('POST', '/api/network', {'disconnect': 'all'}, {'X-Lumen-Token': token})
        self.assertEqual(self.req('GET', '/api/library', headers=laptop)[0], 401)

    def test_a_device_can_sign_itself_out(self):
        token = self.req('POST', '/api/network', {'network': True})[1]['token']
        phone = self.sign_in(token, '/')
        c = http.client.HTTPConnection('127.0.0.1', self.port, timeout=5)
        c.request('POST', '/api/logout', headers=phone)
        r = c.getresponse()
        r.read()
        c.close()
        self.assertEqual(r.status, 200)
        self.assertIn('Max-Age=0', r.getheader('Set-Cookie'))
        self.assertEqual(self.req('GET', '/api/library', headers=phone)[0], 401)
        self.assertEqual(self.req('GET', '/api/network', headers={'X-Lumen-Token': token})[1]['devices'], [])

    def test_sign_ins_survive_a_restart(self):
        token = self.req('POST', '/api/network', {'network': True})[1]['token']
        phone = self.sign_in(token)
        self.stop()
        self.start()
        self.assertEqual(self.req('GET', '/api/library', headers=phone)[0], 200)

    def test_host_from_command_line_locks_the_switch(self):
        self.stop()
        self.srv = server.LumenServer(('127.0.0.1', 0), self.data)
        self.port = self.srv.server_address[1]
        self.thread = threading.Thread(target=self.srv.serve, daemon=True)
        self.thread.start()
        self.assertTrue(self.req('GET', '/api/network')[1]['locked'])
        self.assertEqual(self.req('POST', '/api/network', {'network': True})[0], 409)


class ErrorLogTest(ServerTest):
    def errors(self, act):
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            act()
            time.sleep(0.3)  # let the handler thread finish
        return err.getvalue()

    def test_client_dropping_the_connection_is_silent(self):
        def drop():
            s = socket.create_connection(('127.0.0.1', self.port))
            s.sendall(b'GET /api/health HTTP/1.1\r\nHost: x')  # half a request, then a reset
            time.sleep(0.1)
            s.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, struct.pack('ii', 1, 0))
            s.close()
        self.assertEqual(self.errors(drop), '')

    def test_real_error_is_one_line(self):
        with mock.patch.object(server.Handler, 'api_get_health', side_effect=RuntimeError('boom')):
            out = self.errors(lambda: self.assertRaises(Exception, self.req, 'GET', '/api/health'))
        self.assertRegex(out, r'^error: request from 127\.0\.0\.1 failed: RuntimeError: boom at \S+:\d+\n$')


if __name__ == '__main__':
    unittest.main()
