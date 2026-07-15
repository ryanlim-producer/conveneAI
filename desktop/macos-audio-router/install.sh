#!/bin/bash
# Installs conveneai-audio-router: compiles the Swift tool, installs it to
# ~/.local/bin, and registers a launchd agent so it runs at login and stays up.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
BIN_DIR="$HOME/.local/bin"
BIN="$BIN_DIR/conveneai-audio-router"
PLIST="$HOME/Library/LaunchAgents/com.conveneai.audio-router.plist"
LABEL="com.conveneai.audio-router"

echo "Compiling…"
mkdir -p "$BIN_DIR"
swiftc -O -o "$BIN" "$DIR/main.swift" -framework CoreAudio -framework Foundation

echo "Writing launchd agent (persistent mode — watches for device changes)…"
mkdir -p "$(dirname "$PLIST")"
cat > "$PLIST" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$BIN</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/conveneai-audio-router.log</string>
  <key>StandardErrorPath</key><string>/tmp/conveneai-audio-router.log</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

echo "Installed. Log: /tmp/conveneai-audio-router.log"
echo "Uninstall: launchctl bootout gui/\$(id -u)/$LABEL && rm '$PLIST' '$BIN'"
