#!/bin/bash
set -euo pipefail
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ ! -x "$SOURCE_DIR/whisprlocal-app" ]]; then
  echo 'Run resources/install.sh from an extracted WhisprLocal archive.' >&2; exit 1
fi
VERSION=$(ELECTRON_RUN_AS_NODE=1 "$SOURCE_DIR/whisprlocal-app" -e 'process.stdout.write(require(process.argv[1]).version)' "$SOURCE_DIR/resources/app.asar/package.json")
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || exit 1
INSTALL_ROOT="${WHISPRLOCAL_INSTALL_DIR:-$HOME/.local/opt/WhisprLocal}"
TARGET="$INSTALL_ROOT/versions/$VERSION"
mkdir -p "$INSTALL_ROOT/versions" "$HOME/.local/bin" "$HOME/.local/share/applications" "$HOME/.local/share/icons/hicolor/512x512/apps"
if [[ -e "$TARGET" ]]; then echo "Version already installed: $TARGET" >&2; exit 1; fi
cp -a "$SOURCE_DIR" "$TARGET"
printf '{"format":"unpacked"}\n' > "$INSTALL_ROOT/install.json"
if [[ -L "$INSTALL_ROOT/current" ]]; then ln -sfn "$(readlink -f "$INSTALL_ROOT/current")" "$INSTALL_ROOT/previous"; fi
ln -s "$TARGET" "$INSTALL_ROOT/.current-new"
mv -Tf "$INSTALL_ROOT/.current-new" "$INSTALL_ROOT/current"
ln -sfn "$INSTALL_ROOT/current/whisprlocal" "$HOME/.local/bin/whisprlocal"
cat > "$HOME/.local/share/applications/whisprlocal.desktop" <<DESKTOP
[Desktop Entry]
Name=WhisprLocal
Comment=Local and self-hosted dictation
Exec="$INSTALL_ROOT/current/whisprlocal"
Icon=whisprlocal
Type=Application
Categories=Utility;Audio;
Terminal=false
StartupWMClass=whisprlocal
DESKTOP
cp "$TARGET/resources/src/assets/icon.png" "$HOME/.local/share/icons/hicolor/512x512/apps/whisprlocal.png"
command -v gtk-update-icon-cache >/dev/null && gtk-update-icon-cache -f -t "$HOME/.local/share/icons/hicolor" >/dev/null 2>&1 || true
command -v update-desktop-database >/dev/null && update-desktop-database "$HOME/.local/share/applications" || true
command -v kbuildsycoca6 >/dev/null && kbuildsycoca6 --noincremental >/dev/null 2>&1 || true
printf 'Installed WhisprLocal %s. Your profile and model cache were preserved.\n' "$VERSION"
