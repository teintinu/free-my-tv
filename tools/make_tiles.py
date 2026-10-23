#!/usr/bin/env python3
"""Draws the apps' faces: web/icons/tile-<slug>.png (the tile at rest) and .gif (the same tile when it has the focus).

The TV gives a Developer Mode app no icons at all, so the home draws them itself (see web/brands.js). Drawing them
here, once, instead of in CSS per frame, is what lets the focus animation be a GIF: on webOS 4 (Chromium 53) an
animated image costs the compositor nothing, while the same effect in CSS would animate box-shadows and gradients,
which that engine repaints on the CPU.

The page the frames are taken from (tools/tiles.html) loads the home's own stylesheet, so the baked tile has exactly
the look the TV would give it. Needs Google Chrome (--headless=new) and Pillow; Python 3 only otherwise.

    python3 tools/make_tiles.py            # rebuild what changed
    python3 tools/make_tiles.py --force    # rebuild everything
    python3 tools/make_tiles.py --check    # also write /tmp/tiles.png, every face in one image
"""
import base64
import json
import os
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, 'web')
# The tile as the home lays it out (web/home.css: 224 x 126). The still face is baked at twice that (the home
# scales it up a little when the tile takes the focus), but the animation is not: this TV draws an animated GIF of
# 448 x 252 at 6 fps and one of 224 x 126 at 60, so the frames are captured big and stored at the size the TV shows.
TILE_W, TILE_H, SCALE = 224, 126, 2
FRAMES, DELAY_MS = 16, 66
PORT = 9344


# MARK: - A small CDP client (stdlib only: no websockets package on a clean machine)

class WS:
    def __init__(self, url):
        assert url.startswith('ws://'), url
        rest = url[5:]
        hostport, _, path = rest.partition('/')
        host, _, port = hostport.partition(':')
        self.sock = socket.create_connection((host, int(port or 80)), timeout=30)
        self.sock.settimeout(30)
        key = base64.b64encode(os.urandom(16)).decode()
        req = ('GET /%s HTTP/1.1\r\nHost: %s\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
               'Sec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n') % (path, hostport, key)
        self.sock.sendall(req.encode())
        resp = b''
        while b'\r\n\r\n' not in resp:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise IOError('handshake closed')
            resp += chunk
        head = resp.split(b'\r\n\r\n', 1)
        if b' 101 ' not in head[0].split(b'\r\n')[0]:
            raise IOError('handshake failed: %r' % head[0][:200])
        self.buf = head[1]

    def _read(self, n):
        while len(self.buf) < n:
            chunk = self.sock.recv(1 << 20)
            if not chunk:
                raise IOError('closed')
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def send(self, text):
        data = text.encode('utf-8')
        hdr = bytearray([0x81])
        n = len(data)
        if n < 126:
            hdr.append(0x80 | n)
        elif n < 65536:
            hdr.append(0x80 | 126)
            hdr += struct.pack('>H', n)
        else:
            hdr.append(0x80 | 127)
            hdr += struct.pack('>Q', n)
        mask = os.urandom(4)
        hdr += mask
        self.sock.sendall(bytes(hdr) + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def recv(self):
        while True:
            b1, b2 = self._read(2)
            opcode = b1 & 0x0F
            length = b2 & 0x7F
            if length == 126:
                length = struct.unpack('>H', self._read(2))[0]
            elif length == 127:
                length = struct.unpack('>Q', self._read(8))[0]
            payload = self._read(length)
            if opcode == 0x1:
                return payload.decode('utf-8', 'replace')
            if opcode == 0x8:
                raise IOError('closed by Chrome')


class CDP:
    def __init__(self, ws):
        self.ws = ws
        self.id = 0

    def call(self, method, params=None, timeout=60):
        self.id += 1
        wanted = self.id
        self.ws.send(json.dumps({'id': wanted, 'method': method, 'params': params or {}}))
        deadline = time.time() + timeout
        while time.time() < deadline:
            msg = json.loads(self.ws.recv())
            if msg.get('id') == wanted:
                if 'error' in msg:
                    raise RuntimeError('%s: %s' % (method, msg['error']))
                return msg.get('result', {})
        raise TimeoutError(method)

    def js(self, expression, timeout=60):
        r = self.call('Runtime.evaluate', {'expression': expression, 'returnByValue': True, 'awaitPromise': True}, timeout)
        if 'exceptionDetails' in r:
            raise RuntimeError(json.dumps(r['exceptionDetails'])[:400])
        return r.get('result', {}).get('value')


# MARK: - Chrome

CHROME_PATHS = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
]


def find_chrome():
    for p in CHROME_PATHS:
        if os.path.exists(p):
            return p
    for name in ('google-chrome', 'chrome', 'chromium', 'chromium-browser'):
        p = shutil.which(name)
        if p:
            return p
    sys.exit('Google Chrome (or Chromium) is needed to draw the tiles.')


def start_chrome():
    profile = tempfile.mkdtemp(prefix='fmtv-tiles-')
    proc = subprocess.Popen([
        find_chrome(), '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
        '--remote-debugging-port=%d' % PORT,
        '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check',
        '--disable-extensions', '--disable-background-networking', '--hide-scrollbars',
        '--force-device-scale-factor=1', '--window-size=400,240', '--allow-file-access-from-files',
        'about:blank'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(150):
        try:
            with urllib.request.urlopen('http://127.0.0.1:%d/json/list' % PORT, timeout=1) as r:
                targets = json.load(r)
            pages = [t for t in targets if t.get('type') == 'page' and 'about:blank' in t.get('url', '')]
            pages = pages or [t for t in targets if t.get('type') == 'page']
            if pages:
                return proc, profile, pages[0]
        except Exception:
            time.sleep(0.1)
    proc.kill()
    sys.exit("Chrome didn't answer on port %d." % PORT)


def brands():
    """The table the home uses, read from web/brands.js (no second copy to drift)."""
    node = shutil.which('node')
    if not node:
        sys.exit('Node is needed to read web/brands.js.')
    out = subprocess.run([node, '-e', 'var b=require("./web/brands.js");'
                          'console.log(JSON.stringify(b.BRANDS.map(function (r) { return r.slice(0, 6); })))'],
                         cwd=ROOT, capture_output=True, text=True)
    if out.returncode:
        sys.exit(out.stderr.strip())
    return json.loads(out.stdout.strip())


# MARK: - Drawing

def shoot(cdp, path):
    # The viewport is exactly the tile at twice its size (Emulation below): a clip would have to guess where the
    # window ends, and on a short headless window the bottom of the tile came out as page background.
    r = cdp.call('Page.captureScreenshot', {'format': 'png', 'captureBeyondViewport': False})
    with open(path, 'wb') as f:
        f.write(base64.b64decode(r['data']))


def build_face(cdp, index, slug, art, check, force):
    from PIL import Image

    png = os.path.join(WEB, 'icons', 'tile-%s.png' % slug)
    gif = os.path.join(WEB, 'icons', 'tile-%s.gif' % slug)
    inputs = [os.path.join(WEB, 'brands.js'), os.path.join(WEB, 'home.css'), os.path.join(ROOT, 'tools', 'tiles.html')]
    if art:
        inputs.append(os.path.join(WEB, art))
    newest = max(os.path.getmtime(p) for p in inputs if os.path.exists(p))
    if not force and os.path.exists(png) and os.path.exists(gif) and os.path.getmtime(png) >= newest:
        return 'kept'

    cdp.js('setBrand(%d)' % index)
    tmp = tempfile.mkdtemp(prefix='fmtile-')
    frames = []
    for i in range(FRAMES):
        p = i / (FRAMES - 1.0)
        cdp.js('setFrame(' + repr(round(p, 4)) + ')')
        path = os.path.join(tmp, 'f%02d.png' % i)
        shoot(cdp, path)
        frames.append(Image.open(path).convert('RGB'))
    width, height = frames[0].size
    # The animation at the size the TV draws the tile (its own pixels, no resampling per frame).
    small = [f.resize((TILE_W, TILE_H), Image.LANCZOS) for f in frames]

    # One palette for every frame, taken from the frames themselves: a palette per frame makes the flat colours
    # shimmer between frames of a GIF, which on a 55" panel is the first thing anyone notices.
    sheet = Image.new('RGB', (TILE_W, TILE_H * len(small)))
    for i, f in enumerate(small):
        sheet.paste(f, (0, i * TILE_H))
    base = sheet.quantize(colors=96, method=Image.MEDIANCUT)
    pal = [f.quantize(palette=base, dither=Image.NONE) for f in small]
    pal[0].save(gif, save_all=True, append_images=pal[1:], duration=DELAY_MS, disposal=1, optimize=True)
    frames[0].save(png, optimize=True)   # the still face keeps the bigger copy: the focus grows the tile
    shutil.rmtree(tmp, ignore_errors=True)
    return 'built %s (%d x %d still, %d x %d animation, %d frames, %d KB)' % (
        slug, width, height, TILE_W, TILE_H, FRAMES, os.path.getsize(gif) // 1024)


def montage(path):
    from PIL import Image
    faces = sorted(p for p in os.listdir(os.path.join(WEB, 'icons')) if p.startswith('tile-') and p.endswith('.png'))
    if not faces:
        return
    cols, rows = 4, (len(faces) + 3) // 4
    w, h = 224, 126
    sheet = Image.new('RGB', (cols * (w + 12) + 12, rows * (h + 30) + 12), (245, 245, 247))
    for i, name in enumerate(faces):
        img = Image.open(os.path.join(WEB, 'icons', name)).convert('RGB').resize((w, h))
        x, y = 12 + (i % cols) * (w + 12), 12 + (i // cols) * (h + 30)
        sheet.paste(img, (x, y))
    sheet.save(path)


def main():
    force = '--force' in sys.argv
    check = '--check' in sys.argv
    table = brands()
    proc, profile, target = start_chrome()
    try:
        cdp = CDP(WS(target['webSocketDebuggerUrl']))
        cdp.call('Page.enable')
        cdp.call('Runtime.enable')
        page = 'file://' + os.path.join(ROOT, 'tools', 'tiles.html')
        cdp.call('Page.navigate', {'url': page})
        cdp.call('Emulation.setDeviceMetricsOverride', {'width': TILE_W, 'height': TILE_H,
                                                        'deviceScaleFactor': SCALE, 'mobile': False})
        for _ in range(200):
            time.sleep(0.1)
            if cdp.js('document.title') == 'ready':
                break
        else:
            sys.exit('the tile page never finished loading its marks')
        built = 0
        for i, b in enumerate(table):
            result = build_face(cdp, i, b[0], b[4], check, force)
            if result != 'kept':
                built += 1
                print(result)
        print('%d face(s) built, %d kept' % (built, len(table) - built))
        if check:
            montage('/tmp/tiles.png')
            print('montage: /tmp/tiles.png')
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except Exception:
            proc.kill()
        shutil.rmtree(profile, ignore_errors=True)


if __name__ == '__main__':
    main()
