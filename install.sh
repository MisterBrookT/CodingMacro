#!/bin/sh
set -eu

repo="MisterBrookT/CodingMacro"
api="https://api.github.com/repos/$repo/releases/latest"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT INT TERM

curl -fsSL "$api" -o "$tmp_dir/release.json"

asset_url="$(
  sed -n 's/.*"browser_download_url": "\([^"]*codingmacro-[^"]*\.tgz\)".*/\1/p' \
    "$tmp_dir/release.json" |
    head -n 1
)"
app_url="$(
  sed -n 's/.*"browser_download_url": "\([^"]*CodingMacro-macOS\.zip\)".*/\1/p' \
    "$tmp_dir/release.json" |
    head -n 1
)"

if [ -z "$asset_url" ]; then
  echo "CodingMacro: latest release tarball not found" >&2
  exit 1
fi

curl -fsSL "$asset_url" -o "$tmp_dir/codingmacro.tgz"
npm install -g "$tmp_dir/codingmacro.tgz"
bin_dir="$(npm prefix -g)/bin"
"$bin_dir/codingmacro" --version
mkdir -p "$HOME/.codingmacro"
printf '%s\n' "$bin_dir/codingmacro" > "$HOME/.codingmacro/cli-path"

if [ "$(uname -s)" = "Darwin" ] && [ -n "$app_url" ]; then
  app_root="$HOME/Applications"
  mkdir -p "$app_root"
  curl -fsSL "$app_url" -o "$tmp_dir/CodingMacro-macOS.zip"
  ditto -x -k "$tmp_dir/CodingMacro-macOS.zip" "$app_root"
  xattr -dr com.apple.quarantine "$app_root/CodingMacro.app" 2>/dev/null || true
  open "$app_root/CodingMacro.app"
  echo "CodingMacro app installed at $app_root/CodingMacro.app"
fi
