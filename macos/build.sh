#!/bin/sh
set -eu

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
repo_dir="$(dirname "$script_dir")"
output_dir="$repo_dir/dist-macos"
app_dir="$output_dir/CodingMacro.app"

mkdir -p "$app_dir/Contents/MacOS" "$app_dir/Contents/Resources"

clang -fobjc-arc -O2 -Wall -Wextra -arch arm64 -arch x86_64 \
  -o "$app_dir/Contents/MacOS/CodingMacro" \
  "$script_dir/main.m" \
  -framework Cocoa \
  -framework ApplicationServices

cp "$script_dir/Info.plist" "$app_dir/Contents/Info.plist"
codesign --force --deep --sign - "$app_dir"

echo "$app_dir"
