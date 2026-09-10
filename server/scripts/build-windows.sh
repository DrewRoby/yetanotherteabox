#!/usr/bin/env bash
# Builds a single, self-contained Windows x64 executable for Teabox, for on-site
# test deploys: compiles the server, builds the web client into it, bakes in a fresh
# empty database template, and packs everything into one .exe with @yao-pkg/pkg.
#
# Cross-built from Linux on purpose — @yao-pkg/pkg fetches a prebuilt Node binary for
# the *target* platform and patches it, so it doesn't need to run on Windows. This is
# a secondary target alongside the primary Linux one (build-linux.sh) — see root
# CLAUDE.md's packaging section and bootstrap.ts for how the Windows build's data
# layout (portable: exe/config/db together) differs from the Linux one (XDG dir).
set -euo pipefail

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
# Same reasoning as build-linux.sh: @yao-pkg/pkg's CLI needs a newer Node than this
# project targets at runtime to load one of its own dependencies. This is the build
# host's Node (still Linux — we're cross-building), unrelated to the Windows target.
BUILD_TOOLS_DIR="$SERVER_DIR/.build-tools"
NODE_FOR_PKG="$BUILD_TOOLS_DIR/node-v22.11.0-linux-x64"
if [ ! -x "$NODE_FOR_PKG/bin/node" ]; then
  echo "    downloading Node v22.11.0 into .build-tools/ (used only to run the packager)"
  mkdir -p "$BUILD_TOOLS_DIR"
  curl -sL "https://nodejs.org/dist/v22.11.0/node-v22.11.0-linux-x64.tar.xz" -o "$BUILD_TOOLS_DIR/node22.tar.xz"
  tar -xf "$BUILD_TOOLS_DIR/node22.tar.xz" -C "$BUILD_TOOLS_DIR"
  rm -f "$BUILD_TOOLS_DIR/node22.tar.xz"
fi

echo "==> [5/5] Packaging (Windows x64 only)"
mkdir -p "$ROOT_DIR/dist-bin"
# Must be invoked as `pkg .` (not `pkg dist/index.js`) — see build-linux.sh's comment;
# same @yao-pkg/pkg asset-resolution quirk applies to this target too.
"$NODE_FOR_PKG/bin/node" --experimental-require-module \
  node_modules/@yao-pkg/pkg/lib-es5/bin.js . --targets node22-win-x64 --output "$ROOT_DIR/dist-bin/teabox.exe"

echo ""
echo "Built: $ROOT_DIR/dist-bin/teabox.exe"
file "$ROOT_DIR/dist-bin/teabox.exe" || true
