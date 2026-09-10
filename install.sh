#!/usr/bin/env bash
# Installs the prebuilt Teabox executable for the current Linux user.
#
# Linux is the primary distribution target (see server/scripts/build-linux.sh, which
# packages with `--targets node22-linux-x64`) — this script is the other half of
# that: it refuses to run anywhere but Linux, rather than silently doing the wrong
# thing on macOS/WSL/etc. For a Windows test deploy, use install.bat + teabox.exe
# instead (see server/scripts/build-windows.sh and the README).
set -euo pipefail

if [ "$(uname -s)" != "Linux" ]; then
  echo "Teabox is only distributed as a Linux executable." >&2
  echo "This installer will not run on $(uname -s)." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BINARY_SRC="$SCRIPT_DIR/dist-bin/teabox"

if [ ! -f "$BINARY_SRC" ]; then
  echo "No prebuilt binary found at dist-bin/teabox." >&2
  echo "Build one first with: (cd server && npm run build:linux)" >&2
  exit 1
fi

INSTALL_DIR="$HOME/.local/bin"
mkdir -p "$INSTALL_DIR"
cp "$BINARY_SRC" "$INSTALL_DIR/teabox"
chmod +x "$INSTALL_DIR/teabox"

echo "Teabox installed to $INSTALL_DIR/teabox"
case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *)
    echo ""
    echo "NOTE: $INSTALL_DIR is not on your PATH yet. Add this to your shell profile:"
    echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
    ;;
esac

echo ""
echo "Starting Teabox for the first time..."
"$INSTALL_DIR/teabox" &
TEABOX_PID=$!

URL="http://localhost:4000"
for _ in $(seq 1 30); do
  if curl -sf "$URL/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL" >/dev/null 2>&1 &
else
  echo "Open $URL in your browser to continue."
fi

echo ""
echo "Teabox is running (pid $TEABOX_PID) at $URL"
echo "A first-time setup wizard will walk you through creating your shop."
echo ""
echo "Your data is stored at \$XDG_DATA_HOME/teabox or ~/.local/share/teabox."
echo "To run Teabox again later: $INSTALL_DIR/teabox"
