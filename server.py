#!/usr/bin/env python3
"""Lumen Presenter server.

Serves the app, stores the library, media and live state on disk, and pushes live
changes to every connected window (on any device) over Server-Sent Events.
Standard library only.

    python3 server.py                       # http://127.0.0.1:8642, data in ./data
    python3 server.py --host 0.0.0.0 --token secret   # reachable from the LAN
"""
import argparse
import json
import mimetypes
import os
import queue
import re
import secrets
import shutil
import sys
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit

VERSION = 1
APP_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC = {'index.html', 'output.html', 'stage.html', 'app.js', 'app.css', 'render.js', 'render.css', 'sync.js'}
MEDIA_NAME = re.compile(r'^[a-z0-9]{16}\.[a-z0-9]{1,5}$')
MEDIA_TYPES = ('image/', 'video/')
# The stored extension decides the Content-Type the file is served with, so it must be a media type,
# never whatever the uploader's filename says (e.g. .html, which would run as a page on this origin).
MEDIA_EXT = {'image': {'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg'},
             'video': {'mp4', 'webm', 'mov', 'm4v', 'ogv'}}
# Media is only ever displayed, never run: neutralises scripts in an SVG opened directly.
MEDIA_CSP = "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox"
MAX_JSON = 64 * 1024 * 1024
BACKUP_EVERY = 600  # seconds between library snapshots in data/backups
BACKUP_KEEP = 50
HEARTBEAT = 15


def now_ms():
    return int(time.time() * 1000)


def write_atomic(path, data):
    tmp = f'{path}.{secrets.token_hex(4)}.tmp'
    with open(tmp, 'wb') as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def read_json(path):
    try:
        with open(path, 'rb') as f:
            return json.load(f)
    except FileNotFoundError:
        return None
    except (OSError, ValueError) as e:
        print(f'warning: could not read {path}: {e}', file=sys.stderr)
        return None


class Store:
    """On-disk state. All mutation happens under one lock."""

    def __init__(self, data_dir):
        self.dir = os.path.abspath(data_dir)
        self.media_dir = os.path.join(self.dir, 'media')
        self.backup_dir = os.path.join(self.dir, 'backups')
        for d in (self.dir, self.media_dir, self.backup_dir):
            os.makedirs(d, exist_ok=True)
        self.lib_path = os.path.join(self.dir, 'library.json')
        self.live_path = os.path.join(self.dir, 'live.json')
        self.lock = threading.Lock()

        lib = read_json(self.lib_path)
        self.library = lib.get('library') if isinstance(lib, dict) else None
        self.rev = lib.get('rev', 0) if isinstance(lib, dict) else 0
        live = read_json(self.live_path)
        self.live = live.get('live') if isinstance(live, dict) else None
        self.live_origin = None
        self.last_backup = 0

    def set_library(self, library, origin):
        with self.lock:
            self._backup()
            self.rev += 1
            self.library = library
            write_atomic(self.lib_path, json.dumps({'rev': self.rev, 'saved': now_ms(), 'library': library}).encode())
            return self.rev

    def _backup(self):
        if not os.path.exists(self.lib_path) or time.time() - self.last_backup < BACKUP_EVERY:
            return
        self.last_backup = time.time()
        name = time.strftime('library-%Y%m%d-%H%M%S.json')
        shutil.copy2(self.lib_path, os.path.join(self.backup_dir, name))
        old = sorted(f for f in os.listdir(self.backup_dir) if f.startswith('library-'))
        for f in old[:-BACKUP_KEEP]:
            os.remove(os.path.join(self.backup_dir, f))

    def set_live(self, live, origin):
        with self.lock:
            self.live, self.live_origin = live, origin
            write_atomic(self.live_path, json.dumps({'saved': now_ms(), 'live': live}).encode())


class Hub:
    """Fan-out of events to connected SSE clients."""

    def __init__(self):
        self.clients = set()
        self.lock = threading.Lock()

    def add(self):
        q = queue.Queue(maxsize=256)
        with self.lock:
            self.clients.add(q)
        return q

    def remove(self, q):
        with self.lock:
            self.clients.discard(q)

    def send(self, event, data):
        msg = f'event: {event}\ndata: {json.dumps(data)}\n\n'.encode()
        with self.lock:
            clients = list(self.clients)
        for q in clients:
            try:
                q.put_nowait(msg)
            except queue.Full:  # a stalled client; drop it, EventSource will reconnect
                self.remove(q)
                try:
                    q.get_nowait()
                    q.put_nowait(None)
                except (queue.Empty, queue.Full):
                    pass

    def count(self):
        with self.lock:
            return len(self.clients)


class Handler(BaseHTTPRequestHandler):
    server_version = f'Lumen/{VERSION}'
    protocol_version = 'HTTP/1.1'

    @property
    def store(self):
        return self.server.store

    @property
    def hub(self):
        return self.server.hub

    def log_message(self, fmt, *args):
        if self.server.verbose:
            super().log_message(fmt, *args)

    # ---------- helpers ----------
    def send_json(self, obj, status=200):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def error(self, status, msg):
        self.close_connection = True  # any unread request body must not be parsed as the next request
        self.send_json({'error': msg}, status)

    def authorized(self):
        token = self.server.token
        if not token:
            return True
        given = self.headers.get('X-Lumen-Token', '')
        auth = self.headers.get('Authorization', '')
        if auth.startswith('Bearer '):
            given = auth[7:]
        return secrets.compare_digest(given.encode(), token.encode())

    def read_body_json(self):
        n = int(self.headers.get('Content-Length') or 0)
        if n <= 0 or n > MAX_JSON:
            raise ValueError('body missing or too large')
        return json.loads(self.rfile.read(n))

    # ---------- routing ----------
    def route(self, method):
        path = urlsplit(self.path).path
        if path.startswith('/api/'):
            name = path[5:]
            if method not in ('GET', 'HEAD') and not self.authorized():
                return self.error(HTTPStatus.UNAUTHORIZED, 'token required')
            fn = getattr(self, f'api_{method.lower()}_{name.split("/")[0]}', None)
            if not fn:
                return self.error(HTTPStatus.NOT_FOUND, 'no such endpoint')
            try:
                return fn(name)
            except (ValueError, KeyError, TypeError) as e:
                return self.error(HTTPStatus.BAD_REQUEST, str(e))
        if method not in ('GET', 'HEAD'):
            return self.error(HTTPStatus.METHOD_NOT_ALLOWED, 'method not allowed')
        if path.startswith('/media/'):
            return self.serve_media(unquote(path[7:]))
        return self.serve_static(path)

    def do_GET(self):
        self.route('GET')

    def do_HEAD(self):
        self.route('HEAD')

    def do_POST(self):
        self.route('POST')

    def do_PUT(self):
        self.route('PUT')

    def do_DELETE(self):
        self.route('DELETE')

    # ---------- API ----------
    def api_get_health(self, _):
        self.send_json({'ok': True, 'version': VERSION, 'time': now_ms(), 'auth': bool(self.server.token),
                        'clients': self.hub.count()})

    def api_get_library(self, _):
        with self.store.lock:
            self.send_json({'rev': self.store.rev, 'library': self.store.library})

    def api_put_library(self, _):
        body = self.read_body_json()
        lib = body['library']
        if not isinstance(lib, dict) or not isinstance(lib.get('presentations'), list):
            raise ValueError('library.presentations must be a list')
        origin = str(body.get('client', ''))
        rev = self.store.set_library(lib, origin)
        self.send_json({'rev': rev})
        self.hub.send('library', {'rev': rev, 'origin': origin, 'time': now_ms()})

    def api_get_live(self, _):
        self.send_json({'live': self.store.live, 'time': now_ms()})

    def api_post_live(self, _):
        body = self.read_body_json()
        live = body['live']
        if not isinstance(live, dict):
            raise ValueError('live must be an object')
        origin = str(body.get('client', ''))
        self.store.set_live(live, origin)
        self.send_json({'ok': True})
        self.hub.send('state', {'live': live, 'origin': origin, 'time': now_ms()})

    def api_post_media(self, _):
        ctype = (self.headers.get('Content-Type') or '').split(';')[0].strip().lower()
        if not ctype.startswith(MEDIA_TYPES):
            raise ValueError('only image and video uploads are accepted')
        n = int(self.headers.get('Content-Length') or 0)
        if n <= 0:
            raise ValueError('empty upload')
        if n > self.server.max_upload:
            return self.error(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, 'file too large')
        name = unquote(self.headers.get('X-Filename') or 'upload')[:200]
        kind = 'video' if ctype.startswith('video/') else 'image'
        ext = os.path.splitext(name)[1][1:].lower()
        if ext not in MEDIA_EXT[kind]:
            ext = (mimetypes.guess_extension(ctype) or '.')[1:]
        if ext not in MEDIA_EXT[kind]:
            raise ValueError(f'unsupported {kind} type')
        fname = f'{secrets.token_hex(8)}.{ext}'
        final = os.path.join(self.store.media_dir, fname)
        tmp = final + '.part'
        try:
            with open(tmp, 'wb') as f:
                left = n
                while left:
                    chunk = self.rfile.read(min(left, 1 << 20))
                    if not chunk:
                        raise ValueError('upload interrupted')
                    f.write(chunk)
                    left -= len(chunk)
            os.replace(tmp, final)
        finally:
            if os.path.exists(tmp):
                os.remove(tmp)
        self.send_json({'name': name, 'type': kind, 'src': f'media/{fname}'}, HTTPStatus.CREATED)

    def api_delete_media(self, name):
        fname = name.split('/', 1)[1] if '/' in name else ''
        if not MEDIA_NAME.match(fname):
            raise ValueError('bad media name')
        try:
            os.remove(os.path.join(self.store.media_dir, fname))
        except FileNotFoundError:
            pass
        self.send_json({'ok': True})

    def api_get_events(self, _):
        q = self.hub.add()
        try:
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Accel-Buffering', 'no')  # don't let nginx buffer the stream
            self.end_headers()
            self.close_connection = True
            with self.store.lock:
                hello = {'live': self.store.live, 'origin': self.store.live_origin, 'rev': self.store.rev,
                         'time': now_ms()}
            self.wfile.write(f'retry: 2000\nevent: hello\ndata: {json.dumps(hello)}\n\n'.encode())
            self.wfile.flush()
            while not self.server.stopping.is_set():
                try:
                    msg = q.get(timeout=HEARTBEAT)
                except queue.Empty:
                    msg = f'event: ping\ndata: {{"time": {now_ms()}}}\n\n'.encode()
                if msg is None:
                    break
                self.wfile.write(msg)
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, TimeoutError, OSError):
            pass
        finally:
            self.hub.remove(q)

    # ---------- files ----------
    def serve_static(self, path):
        name = path.lstrip('/') or 'index.html'
        if name not in STATIC:
            return self.error(HTTPStatus.NOT_FOUND, 'not found')
        self.serve_file(os.path.join(APP_DIR, name), cache='no-cache')

    def serve_media(self, name):
        if not MEDIA_NAME.match(name):
            return self.error(HTTPStatus.NOT_FOUND, 'not found')
        # Names are random and never reused, so the content can be cached forever.
        self.serve_file(os.path.join(self.store.media_dir, name), cache='public, max-age=31536000, immutable',
                        csp=MEDIA_CSP)

    def serve_file(self, fpath, cache, csp=None):
        try:
            f = open(fpath, 'rb')
        except OSError:
            return self.error(HTTPStatus.NOT_FOUND, 'not found')
        with f:
            size = os.fstat(f.fileno()).st_size
            start, end = 0, size - 1
            rng = self.headers.get('Range')
            m = re.fullmatch(r'bytes=(\d*)-(\d*)', rng.strip()) if rng else None
            if m and (m.group(1) or m.group(2)):
                if m.group(1):
                    start = int(m.group(1))
                    end = min(int(m.group(2)), size - 1) if m.group(2) else size - 1
                else:
                    start = max(0, size - int(m.group(2)))
                if start > end or start >= size:
                    self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                    self.send_header('Content-Range', f'bytes */{size}')
                    self.send_header('Content-Length', '0')
                    self.end_headers()
                    return
                self.send_response(HTTPStatus.PARTIAL_CONTENT)
                self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
            else:
                self.send_response(HTTPStatus.OK)
            ctype = mimetypes.guess_type(fpath)[0] or 'application/octet-stream'
            if ctype.startswith('text/') or ctype == 'application/javascript':
                ctype += '; charset=utf-8'
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(end - start + 1))
            self.send_header('Accept-Ranges', 'bytes')
            self.send_header('Cache-Control', cache)
            self.send_header('X-Content-Type-Options', 'nosniff')
            if csp:
                self.send_header('Content-Security-Policy', csp)
            self.end_headers()
            if self.command == 'HEAD':
                return
            f.seek(start)
            left = end - start + 1
            try:
                while left:
                    chunk = f.read(min(left, 1 << 20))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    left -= len(chunk)
            except (BrokenPipeError, ConnectionResetError):
                pass


class LumenServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, addr, data_dir, token='', max_upload_mb=4096, verbose=False):
        super().__init__(addr, Handler)
        self.store = Store(data_dir)
        self.hub = Hub()
        self.token = token
        self.max_upload = max_upload_mb * 1024 * 1024
        self.verbose = verbose
        self.stopping = threading.Event()

    def shutdown(self):
        self.stopping.set()
        super().shutdown()


def main(argv=None):
    p = argparse.ArgumentParser(description='Lumen Presenter server')
    p.add_argument('--host', default=os.environ.get('LUMEN_HOST', '127.0.0.1'),
                   help='address to bind (0.0.0.0 for all interfaces; default 127.0.0.1)')
    p.add_argument('--port', type=int, default=int(os.environ.get('LUMEN_PORT', 8642)))
    p.add_argument('--data', default=os.environ.get('LUMEN_DATA', os.path.join(APP_DIR, 'data')),
                   help='directory for the library, media and live state (default ./data)')
    p.add_argument('--token', default=os.environ.get('LUMEN_TOKEN', ''),
                   help='require this token for any change (recommended when not bound to localhost)')
    p.add_argument('--max-upload-mb', type=int, default=int(os.environ.get('LUMEN_MAX_UPLOAD_MB', 4096)))
    p.add_argument('-v', '--verbose', action='store_true', help='log every request')
    a = p.parse_args(argv)

    mimetypes.add_type('application/javascript', '.js')
    mimetypes.add_type('video/mp4', '.mp4')
    mimetypes.add_type('video/webm', '.webm')
    mimetypes.add_type('video/quicktime', '.mov')
    srv = LumenServer((a.host, a.port), a.data, a.token, a.max_upload_mb, a.verbose)
    local = a.host in ('127.0.0.1', 'localhost', '::1')
    print(f'Lumen Presenter on http://{"localhost" if local else a.host}:{srv.server_address[1]}  (data: {srv.store.dir})')
    if not local and not a.token:
        print('warning: reachable from the network with no --token; anyone on it can control the output',
              file=sys.stderr)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.stopping.set()
        srv.server_close()


if __name__ == '__main__':
    main()
