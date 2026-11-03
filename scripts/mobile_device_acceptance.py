"""Developer-operated Android regression, restricted to Tako's foreground UI.

Requires the test APK, USB forwarding and mobile_account_acceptance.cjs fixtures.
Never prints passwords, tokens, XML, email addresses, or personal device screens.
"""
from pathlib import Path
import json
import re
import secrets
import subprocess
import time
import uuid
import xml.etree.ElementTree as ET
import http.client
import http.server
import socket
import threading
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
ADB = ROOT / '.runtime/tools/android/platform-tools/adb.exe'
QA = ROOT / '.runtime/mobile/qa'
PACKAGE = 'me.takostory.app.test'


class TestNetwork:
    """Loopback-only real API forwarding with an observable connection fault."""
    def __enter__(self):
        with urllib.request.urlopen('http://127.0.0.1:3300/api/community', timeout=10) as response:
            if response.status != 200 or response.headers.get('X-Tako-Environment') != 'test':
                raise RuntimeError('Local test API required')
        network = self
        self.offline = threading.Event()
        self.blocked = 0

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass  # Never log URLs, headers, credentials or bodies.

            def forward(self):
                if network.offline.is_set():
                    network.blocked += 1
                    self.connection.shutdown(socket.SHUT_RDWR)
                    self.connection.close()
                    return
                connection = http.client.HTTPConnection('127.0.0.1', 3300, timeout=20)
                try:
                    data = self.rfile.read(int(self.headers.get('Content-Length', '0')))
                    connection.request(self.command, self.path, data, dict(self.headers))
                    response = connection.getresponse()
                    body = response.read()
                    self.send_response(response.status)
                    for key, value in response.getheaders():
                        if key.lower() not in ('transfer-encoding', 'connection', 'content-length'):
                            self.send_header(key, value)
                    self.send_header('Content-Length', str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                except (OSError, http.client.HTTPException):
                    self.close_connection = True
                finally:
                    connection.close()

            do_GET = do_POST = do_PATCH = do_DELETE = forward

        self.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        return self

    def __exit__(self, *args):
        self.offline.clear()
        try:
            adb('reverse', 'tcp:3300', 'tcp:3300')
        finally:
            self.server.shutdown()
            self.server.server_close()
            self.thread.join(timeout=5)


def adb(*args):
    try:
        result = subprocess.run([str(ADB), '-d', *map(str, args)], capture_output=True, timeout=30)
    except subprocess.TimeoutExpired:
        raise RuntimeError('Android operation timed out; command arguments are not printed') from None
    if result.returncode:
        raise RuntimeError('Android operation failed; check USB authorization')
    return result.stdout.decode('utf-8', errors='replace')


def screen():
    focus = adb('shell', 'dumpsys', 'window')
    if not re.search(r'mCurrentFocus=.*' + re.escape(PACKAGE), focus):
        raise RuntimeError('Tako is not foreground; unlock the phone and open Tako')
    dumped = adb('shell', 'uiautomator', 'dump', '/data/local/tmp/tako-acceptance.xml')
    if 'UI hierchary dumped to:' not in dumped:
        raise RuntimeError('Android did not produce a fresh UI snapshot; dismiss the keyboard before retrying')
    return ET.fromstring(adb('shell', 'cat', '/data/local/tmp/tako-acceptance.xml'))


def find(label, contains=False):
    for node in screen().iter('node'):
        values = (node.get('text', ''), node.get('content-desc', ''))
        if any((label in value if contains else label == value) for value in values):
            return node
    return None


def wait(label, contains=False, seconds=25):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        node = find(label, contains)
        if node is not None:
            return node
        time.sleep(.4)
    raise RuntimeError('Expected Tako control did not appear: ' + label)


def tap_node(node):
    points = list(map(int, re.findall(r'\d+', node.get('bounds', ''))))
    if len(points) != 4:
        raise RuntimeError('Invalid control bounds')
    adb('shell', 'input', 'tap', (points[0]+points[2])//2, (points[1]+points[3])//2)


def tap(label, contains=False):
    tap_node(wait(label, contains))


def fill(label, value):
    if not re.fullmatch(r'[A-Za-z0-9@._+ -]+', value):
        raise RuntimeError('Device fixture input contains unsupported characters; values are not printed')
    # A visible form label can have the same text as the field's accessibility
    # label. Target the editable control, never the preceding TextView.
    node = next((n for n in screen().iter('node')
                 if n.get('class') == 'android.widget.EditText'
                 and n.get('content-desc') == label), None)
    if node is None:
        raise RuntimeError('Expected editable Tako field did not appear: ' + label)
    tap_node(node)
    # Fixtures are generated ASCII only. Values are arguments, never interpolated shell code.
    # Empty inputs expose their placeholder as text. Do not send hardware END:
    # some Android OEM text widgets crash while moving selection in an empty field.
    adb('shell', 'input', 'keycombination', '113', '29')  # Ctrl+A
    adb('shell', 'input', 'keyevent', '67')
    # Pace synthetic key events so a controlled RN input can acknowledge changes.
    # A single fast adb `input text` can lose characters on this OEM keyboard.
    for character in value:
        adb('shell', 'input', 'text', '%s' if character == ' ' else character)
        time.sleep(.08)
    back()  # Stabilize the layout before locating the next field.
    actual = next((n for n in screen().iter('node')
                   if n.get('class') == 'android.widget.EditText'
                   and n.get('content-desc') == label), None)
    if actual is None or (actual.get('password') != 'true' and actual.get('text') != value):
        raise RuntimeError('Android fixture input was not applied; field values are not printed')


def back():
    adb('shell', 'input', 'keyevent', '4')
    time.sleep(.5)


def capture(name):
    screen()  # Refuse to capture any other app, including the personal launcher.
    adb('shell', 'screencap', '-p', '/data/local/tmp/tako-acceptance.png')
    adb('pull', '/data/local/tmp/tako-acceptance.png', QA / name)


def cold_start():
    adb('shell', 'am', 'force-stop', PACKAGE)
    adb('shell', 'am', 'start', '-n', PACKAGE + '/.MainActivity')
    # Activity launch returns before Android transfers focus. Wait on metadata;
    # never inspect or capture the launcher/another app while it is transitioning.
    deadline = time.monotonic() + 25
    while time.monotonic() < deadline:
        focus = adb('shell', 'dumpsys', 'window')
        if re.search(r'mCurrentFocus=.*' + re.escape(PACKAGE), focus):
            break
        time.sleep(.4)
    else:
        raise RuntimeError('Tako did not become foreground after launch')
    tap('轻触进入')


def main(network):
    fixtures = json.loads((QA/'account-fixture.json').read_text(encoding='utf-8'))
    device_user = {'email':'android-'+uuid.uuid4().hex[:12]+'@example.test',
                   'password':secrets.token_hex(16)}
    (QA/'device-account.json').write_text(json.dumps(device_user), encoding='utf-8')
    adb('reverse', 'tcp:3300', 'tcp:' + str(network.server.server_port))
    cold_start()
    tap('游客访问')
    tap('进入中篇首页')
    tap_node(wait('阅读 ', contains=True))
    tap('收藏作品')
    tap('注册')
    fill('邮箱', device_user['email'])
    fill('笔名', 'AppDeviceTest')
    fill('密码', device_user['password'])
    tap('创建账号')
    wait('收藏作品')  # Registration returned to the original reading page without auto-writing.
    tap('收藏作品')
    wait('取消收藏')
    capture('account-reader-favorited.png')
    back()
    tap('我的')
    wait('AppDeviceTest')
    tap('我的收藏')
    tap_node(wait('阅读收藏 ', contains=True))
    wait('取消收藏')
    back()
    tap('返回我的')
    capture('account-profile.png')
    # Verify real OS-backed credential persistence, not just an in-memory mock.
    cold_start()
    tap('进入社区')
    tap('我的')
    wait('AppDeviceTest')
    # Removing a reverse listener can leave pooled TCP connections alive. Refuse
    # requests in the forwarding server and require evidence of a blocked request.
    try:
        network.offline.set()
        tap('退出登录')
        wait('连接超时或已断开', contains=True, seconds=35)
        if not network.blocked:
            raise RuntimeError('Offline fault did not intercept a native request')
        wait('AppDeviceTest')
        capture('account-offline-logout.png')
    finally:
        network.offline.clear()
    tap('退出登录')
    wait('游客')
    tap('登录 / 注册')
    fill('邮箱', fixtures['b']['email'])
    fill('密码', 'wrong-password')
    tap('登录账号')
    wait('邮箱或密码不正确。')
    fill('密码', fixtures['b']['password'])
    tap('登录账号')
    wait('App自动验收乙')
    tap('我的收藏')
    wait('还没有收藏作品')
    capture('account-b-empty-favorites.png')
    tap('返回我的')
    tap('退出登录')
    wait('游客')
    print('PASS: Android guest -> real registration -> original reader -> favorite -> my favorites -> reader; cold-start secure session; offline logout failure/retry; account B sees no account A favorites; final state guest.')


if __name__ == '__main__':
    try:
        with TestNetwork() as network:
            main(network)
    except Exception as error:
        print(str(error))
        raise SystemExit(1)
