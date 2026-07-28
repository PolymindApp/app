#!/usr/bin/env bash
set -euo pipefail

PB_VERSION="0.38.2"
PB_DIR=".pocketbase"
PB_ARCHIVE="pocketbase_${PB_VERSION}_linux_amd64.zip"

mkdir -p "$PB_DIR"
curl -fL "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/${PB_ARCHIVE}" -o "$PB_DIR/$PB_ARCHIVE"
unzip -o "$PB_DIR/$PB_ARCHIVE" pocketbase -d "$PB_DIR"
rm "$PB_DIR/$PB_ARCHIVE"
chmod +x "$PB_DIR/pocketbase"

echo "PocketBase ${PB_VERSION} installed in ${PB_DIR}."
