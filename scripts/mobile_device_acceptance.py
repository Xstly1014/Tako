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

ROOT = Path(__file__).resolve().parent.parent
ADB = ROOT / '.runtime/tools/android/platform-tools/adb.exe'
QA = ROOT / '.runtime/mobile/qa'
PACKAGE = 'me.takostory.app.test'


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
    adb('shell', 'uiautomator', 'dump', '/data/local/tmp/tako-acceptance.xml')
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
    node = wait(label)
    tap_node(node)
    # Fixtures are generated ASCII only. Values are arguments, never interpolated shell code.
    adb('shell', 'input', 'keyevent', '123')
    adb('shell', 'input', 'keyevent', *(['67'] * min(256, max(8, len(node.get('text', ''))+2))))
    adb('shell', 'input', 'text', value)


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
    tap('轻触进入')


def main():
    fixtures = json.loads((QA/'account-fixture.json').read_text(encoding='utf-8'))
    device_user = {'email':'android-'+uuid.uuid4().hex[:12]+'@example.test',
                   'password':secrets.token_hex(16)}
    (QA/'device-account.json').write_text(json.dumps(device_user), encoding='utf-8')
    adb('reverse', 'tcp:3300', 'tcp:3300')
    cold_start()
    tap('游客访问')
    tap('进入中篇首页')
    tap_node(wait('阅读 ', contains=True))
    tap('收藏作品')
    tap('注册')
    fill('邮箱', device_user['email'])
    fill('笔名', 'AppDeviceTest')
    fill('密码', device_user['password'])
    back()  # Dismiss keyboard, not the modal.
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
    # Remove only this test app's existing USB reverse mapping; always restore it.
    try:
        adb('reverse', '--remove', 'tcp:3300')
        tap('退出登录')
        wait('连接超时或已断开', contains=True, seconds=35)
        wait('AppDeviceTest')
        capture('account-offline-logout.png')
    finally:
        adb('reverse', 'tcp:3300', 'tcp:3300')
    tap('退出登录')
    wait('游客')
    tap('登录 / 注册')
    fill('邮箱', fixtures['b']['email'])
    fill('密码', 'wrong-password')
    back()
    tap('登录账号')
    wait('邮箱或密码不正确。')
    fill('密码', fixtures['b']['password'])
    back()
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
        main()
    except Exception as error:
        print(str(error))
        raise SystemExit(1)
