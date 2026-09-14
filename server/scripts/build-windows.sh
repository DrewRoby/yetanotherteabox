#!/usr/bin/env bash
# Builds a single, self-contained Windows x64 executable for Teabox, for on-site
# test deploys: compiles the server, builds the web client into it, bakes in a fresh
# empty database template, and packs everything into one .exe with @yao-pkg/pkg.
#
# @yao-pkg/pkg fetches a prebuilt Node binary for the *target* platform (Windows) and
# patches it, so the exe it produces never depends on the build host's OS. This script
# itself, however, runs fine on either build host:
#   - From Linux (the original, still-primary path): cross-built alongside the Linux
#     target in build-linux.sh.
#   - From Windows, under Git Bash (e.g. for on-site troubleshooting without a Linux
#     box handy): also supported — see the pkg-runner-Node download below, which picks
#     the archive matching the host, not the target.
# See root CLAUDE.md's packaging section and bootstrap.ts for how the Windows build's
# data layout (portable: exe/config/db together) differs from the Linux one (XDG dir).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="$(cd "$SERVER_DIR/.." && pwd)"
WEB_DIR="$ROOT_DIR/web"

# Path resolution above depends on this file being run as *itself* (so
# ${BASH_SOURCE[0]} points at its real location) — e.g. `npm run build:windows` from
# server/, or `bash scripts/build-windows.sh` / `./scripts/build-windows.sh` from repo
# root. If invoked some other way and it lands on the wrong directory, fail loudly
# here instead of a confusing "can't find package.json" a few steps downstream.
if [ ! -f "$SERVER_DIR/package.json" ]; then
  echo "Resolved SERVER_DIR=$SERVER_DIR but no package.json there — something about how" >&2
  echo "this script was invoked confused its self-location. Run it as:" >&2
  echo "  cd server && npm run build:windows" >&2
  exit 1
fi

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
# project targets at runtime to load one of its own dependencies. This is the BUILD
# HOST's Node, unrelated to the Windows target the exe itself is built for — so which
# archive we fetch depends on what this script is running on, not on node22-win-x64.
BUILD_TOOLS_DIR="$SERVER_DIR/.build-tools"
HOST_OS="$(uname -s)"
case "$HOST_OS" in
  Linux)
    NODE_FOR_PKG="$BUILD_TOOLS_DIR/node-v22.11.0-linux-x64"
    NODE_BIN="$NODE_FOR_PKG/bin/node"
    if [ ! -x "$NODE_BIN" ]; then
      echo "    downloading Node v22.11.0 (linux-x64) into .build-tools/ (used only to run the packager)"
      mkdir -p "$BUILD_TOOLS_DIR"
      curl -sL "https://nodejs.org/dist/v22.11.0/node-v22.11.0-linux-x64.tar.xz" -o "$BUILD_TOOLS_DIR/node22.tar.xz"
      tar -xf "$BUILD_TOOLS_DIR/node22.tar.xz" -C "$BUILD_TOOLS_DIR"
      rm -f "$BUILD_TOOLS_DIR/node22.tar.xz"
    fi
    ;;
  MINGW*|MSYS*|CYGWIN*)
    # Running natively on Windows under Git Bash. A Linux ELF binary (the branch
    # above) can't execute here, so fetch the matching win-x64 archive instead.
    NODE_FOR_PKG="$BUILD_TOOLS_DIR/node-v22.11.0-win-x64"
    NODE_BIN="$NODE_FOR_PKG/node.exe"
    if [ ! -f "$NODE_BIN" ]; then
      if ! command -v unzip >/dev/null 2>&1; then
        echo "unzip is required to extract the pkg-runner Node archive but wasn't found." >&2
        echo "It normally ships with Git for Windows; reinstall/repair Git for Windows, or install unzip another way (e.g. 'choco install unzip')." >&2
        exit 1
      fi
      echo "    downloading Node v22.11.0 (win-x64) into .build-tools/ (used only to run the packager)"
      mkdir -p "$BUILD_TOOLS_DIR"
      curl -sL "https://nodejs.org/dist/v22.11.0/node-v22.11.0-win-x64.zip" -o "$BUILD_TOOLS_DIR/node22.zip"
      unzip -q "$BUILD_TOOLS_DIR/node22.zip" -d "$BUILD_TOOLS_DIR"
      rm -f "$BUILD_TOOLS_DIR/node22.zip"
    fi
    ;;
  *)
    echo "Unsupported build host OS for build-windows.sh: $HOST_OS" >&2
    echo "This script has only been taught how to fetch a pkg-runner Node for Linux and Windows (Git Bash) hosts." >&2
    exit 1
    ;;
esac

echo "==> [5/5] Packaging (Windows x64 only)"
mkdir -p "$ROOT_DIR/dist-bin"
# Must be invoked as `pkg .` (not `pkg dist/index.js`) — see build-linux.sh's comment;
# same @yao-pkg/pkg asset-resolution quirk applies to this target too.
"$NODE_BIN" --experimental-require-module \
  node_modules/@yao-pkg/pkg/lib-es5/bin.js . --targets node22-win-x64 --output "$ROOT_DIR/dist-bin/teabox.exe"

echo ""
echo "Built: $ROOT_DIR/dist-bin/teabox.exe"
file "$ROOT_DIR/dist-bin/teabox.exe" || true
