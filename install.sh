#!/bin/sh
set -eu

repo="MisterBrookT/CodingMacro"
api="https://api.github.com/repos/$repo/releases/latest"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT INT TERM

asset_url="$(
  curl -fsSL "$api" |
    sed -n 's/.*"browser_download_url": "\([^"]*codingmacro-[^"]*\.tgz\)".*/\1/p' |
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
