#!/usr/bin/env bash
# Builds a single, self-contained Linux executable for Teabox: compiles the server,
# builds the web client into it, bakes in a fresh empty database template, and packs
# everything into one binary with @yao-pkg/pkg. Deliberately Linux-only — see the
# --targets line below, which never lists a win/macos target.
set -euo pipefail

if [ "$(uname -s)" != "Linux" ]; then
  echo "This project only ships a Linux executable. Building on $(uname -s) is not supported." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="$(cd "$SERVER_DIR/.." && pwd)"
WEB_DIR="$ROOT_DIR/web"

cd "$SERVER_DIR"

echo "==> [1/5] Compiling server TypeScript"
npm run build

echo "==> [2/5] Building web client and copying it into server/public/"
(cd "$WEB_DIR" && npm run build)
rm -rf "$SERVER_DIR/public"
mkdir -p "$SERVER_DIR/public"
cp -r "$WEB_DIR/dist/." "$SERVER_DIR/public/"

echo "==> [3/5] Baking a fresh, migrated, empty database template"
TEMPLATE_TMP="$SERVER_DIR/prisma/.template-build.db"
rm -f "$TEMPLATE_TMP"
DATABASE_URL="file:.template-build.db" npx prisma migrate deploy
mv "$SERVER_DIR/prisma/.template-build.db" "$SERVER_DIR/prisma/template.db"

echo "==> [4/5] Fetching a pinned Node runtime to run the packager itself"
# @yao-pkg/pkg's CLI needs a Node new enough to synchronously require() one of its
# own ESM dependencies (into-stream) — this repo's runtime Node (18.x, see server's
# engines/tsconfig) doesn't have that support, so the packager runs under its own
# pinned, verified-working Node instead. This is purely a build-time tool: it never
# touches the app's runtime Node version or the target executable's Node version
# (that's controlled entirely by --targets below).
BUILD_TOOLS_DIR="$SERVER_DIR/.build-tools"
NODE_FOR_PKG="$BUILD_TOOLS_DIR/node-v22.11.0-linux-x64"
if [ ! -x "$NODE_FOR_PKG/bin/node" ]; then
  echo "    downloading Node v22.11.0 into .build-tools/ (used only to run the packager)"
  mkdir -p "$BUILD_TOOLS_DIR"
  curl -sL "https://nodejs.org/dist/v22.11.0/node-v22.11.0-linux-x64.tar.xz" -o "$BUILD_TOOLS_DIR/node22.tar.xz"
  tar -xf "$BUILD_TOOLS_DIR/node22.tar.xz" -C "$BUILD_TOOLS_DIR"
  rm -f "$BUILD_TOOLS_DIR/node22.tar.xz"
fi

echo "==> [5/5] Packaging (Linux x64 only)"
mkdir -p "$ROOT_DIR/dist-bin"
# Must be invoked as `pkg .` (not `pkg dist/index.js`) — @yao-pkg/pkg only reads the
# "pkg" config block (our asset list: the Prisma engine, public/, template.db) from
# package.json when the entry is resolved via its "bin" field; an explicit file path
# silently skips that config and ships a binary missing those files. The flag is
# passed directly to this one process rather than via NODE_OPTIONS, which pkg's
# spawned sub-processes don't reliably accept.
"$NODE_FOR_PKG/bin/node" --experimental-require-module \
  node_modules/@yao-pkg/pkg/lib-es5/bin.js . --targets node22-linux-x64 --output "$ROOT_DIR/dist-bin/teabox"
chmod +x "$ROOT_DIR/dist-bin/teabox"

echo ""
echo "Built: $ROOT_DIR/dist-bin/teabox"
file "$ROOT_DIR/dist-bin/teabox" || true
