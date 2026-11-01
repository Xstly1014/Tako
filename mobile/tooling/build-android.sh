#!/bin/sh
set -eu
cd /app
lock_hash=$(sha256sum package-lock.json | cut -d ' ' -f 1)
if ! test -f node_modules/expo/package.json || ! test -f node_modules/.tako-lock-hash || test "$(cat node_modules/.tako-lock-hash)" != "$lock_hash"; then
  npm ci
  printf '%s' "$lock_hash" > node_modules/.tako-lock-hash
fi
npm run typecheck
npm run lint
native_hash=$(sha256sum app.json package-lock.json plugins/*.cjs assets/tako-icon.svg tooling/icons.cjs | sha256sum | cut -d ' ' -f 1)
if ! test -f android/gradlew || ! test -f .expo/tako-native-hash || test "$(cat .expo/tako-native-hash)" != "$native_hash"; then
  node tooling/icons.cjs
  npx expo prebuild --platform android --no-install
  mkdir -p .expo
  printf '%s' "$native_hash" > .expo/tako-native-hash
fi
cd android
# A bundled personal-test APK, signed with the template's debug key. Not a store release.
sh gradlew :app:assembleRelease --no-daemon --max-workers=2 --init-script /app/tooling/repositories.gradle \
  -PreactNativeArchitectures="${TAKO_ANDROID_ABIS:-arm64-v8a,armeabi-v7a}" \
  -Porg.gradle.parallel=false -Pandroid.enableMinifyInReleaseBuilds=false
mkdir -p /artifacts
cp app/build/outputs/apk/release/app-release.apk /artifacts/tako-test-0.1.0.apk
sha256sum /artifacts/tako-test-0.1.0.apk > /artifacts/tako-test-0.1.0.apk.sha256
unzip -l /artifacts/tako-test-0.1.0.apk | grep assets/index.android.bundle
"$ANDROID_HOME/build-tools/37.0.0/apksigner" verify /artifacts/tako-test-0.1.0.apk
