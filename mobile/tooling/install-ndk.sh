#!/bin/sh
set -eu
version=27.1.12297006
target="$ANDROID_HOME/ndk/$version"
if test -f "$target/source.properties"; then exit 0; fi
cache="$ANDROID_HOME/download-cache"
mkdir -p "$cache" "$ANDROID_HOME/ndk"
archive="$cache/android-ndk-r27b-linux.zip"
# SHA-1 and size are published by Google's repository2-3.xml for this fixed SDK package.
curl --fail --silent --show-error --location --retry 5 --retry-all-errors --continue-at - \
  https://dl.google.com/android/repository/android-ndk-r27b-linux.zip -o "$archive"
test "$(stat -c %s "$archive")" = 663976775
echo "6fc476b2e57d7c01ac0c95817746b927035b9749  $archive" | sha1sum -c -
unzip -tq "$archive"
unzip -q -o "$archive" -d "$cache/unpacked"
if test -d "$target"; then
  mv "$target" "$cache/incomplete-$version-$(date +%s)"
fi
mv "$cache/unpacked/android-ndk-r27b" "$target"
test -f "$target/source.properties"
