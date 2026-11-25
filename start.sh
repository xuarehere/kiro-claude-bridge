#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

NODE_BIN=""
if [ -x "$ROOT_DIR/runtime/node" ]; then
  NODE_BIN="$ROOT_DIR/runtime/node"
elif command -v node >/dev/null 2>&1; then
  NODE_BIN="$(command -v node)"
fi

if [ -z "$NODE_BIN" ]; then
  echo "[ERROR] Node.js >= 18 is required. Please install from https://nodejs.org/"
  exit 1
fi

exec "$NODE_BIN" "$ROOT_DIR/src/index.js" --open "$@"
