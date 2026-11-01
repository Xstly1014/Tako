param([ValidateSet('build','devices','connect','install')][string]$Action = 'devices')
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$adb = Join-Path $repo '.runtime/tools/android/platform-tools/adb.exe'
$artifacts = Join-Path $repo '.runtime/mobile/artifacts'
if ($Action -eq 'build') {
  New-Item -ItemType Directory -Path $artifacts -Force | Out-Null
  & docker build -t tako-android-build:local -f (Join-Path $repo 'mobile/tooling/Dockerfile.android') (Join-Path $repo 'mobile/tooling')
  if ($LASTEXITCODE -ne 0) { throw 'Android toolchain build failed' }
  & docker run --rm -v tako-mobile-android-sdk:/opt/android-sdk tako-android-build:local sdkmanager 'platform-tools' 'platforms;android-37.0' 'build-tools;37.0.0' 'cmake;3.22.1'
  if ($LASTEXITCODE -ne 0) { throw 'Android SDK installation failed' }
  & docker run --rm -v "${repo}/mobile:/app" -v tako-mobile-android-sdk:/opt/android-sdk tako-android-build:local sh tooling/install-ndk.sh
  if ($LASTEXITCODE -ne 0) { throw 'Android NDK integrity check or installation failed' }
  & docker run --rm --memory=4g --cpus=4 -e CI=1 -v "${repo}/mobile:/app" -v "${artifacts}:/artifacts" -v tako-mobile-node-modules:/app/node_modules -v tako-mobile-npm-cache:/root/.npm -v tako-mobile-gradle-cache:/root/.gradle -v tako-mobile-android-sdk:/opt/android-sdk -w /app tako-android-build:local sh tooling/build-android.sh
  if ($LASTEXITCODE -ne 0) { throw 'APK build failed' }
  exit 0
}
if (!(Test-Path -LiteralPath $adb)) { throw 'Install the official Windows Android platform-tools under .runtime/tools/android first (see mobile/README.md).' }
if ($Action -eq 'devices') { & $adb devices -l; exit $LASTEXITCODE }
$deviceState = & $adb -d get-state
if ($LASTEXITCODE -ne 0 -or $deviceState -ne 'device') { throw 'Exactly one authorized USB device is required. Connect and unlock the test phone, and allow USB debugging.' }
$serial = & $adb -d get-serialno
if ($LASTEXITCODE -ne 0 -or !$serial -or $serial -eq 'unknown') { throw 'Could not identify the USB test phone.' }
& $adb -s $serial reverse tcp:3300 tcp:3300
if ($LASTEXITCODE -ne 0) { throw 'USB API forwarding failed' }
if ($Action -eq 'connect') { & $adb -s $serial reverse --list; exit $LASTEXITCODE }
$apk = Join-Path $artifacts 'tako-test-0.1.0.apk'
if (!(Test-Path -LiteralPath $apk)) { throw 'Build the APK first.' }
& $adb -s $serial install -r $apk
if ($LASTEXITCODE -ne 0) { throw 'APK installation failed; approve the install prompt on the phone if present.' }
& $adb -s $serial shell am start -n me.takostory.app.test/.MainActivity
if ($LASTEXITCODE -ne 0) { throw 'App launch failed' }
