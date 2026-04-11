#!/usr/bin/env bash
set -euo pipefail

SKILL_LINK="$HOME/.claude/skills/panorama"
CLI_LINK="$HOME/.local/bin/panorama"
LAUNCHD_PLIST="$HOME/Library/LaunchAgents/com.user.panorama.plist"

echo "panorama uninstaller"
echo "  (leaves Vault and ~/.config/panorama/config.yaml intact)"

if [ -f "$LAUNCHD_PLIST" ]; then
  launchctl unload "$LAUNCHD_PLIST" 2>/dev/null || true
  rm -f "$LAUNCHD_PLIST"
  echo "Removed $LAUNCHD_PLIST"
fi

if [ -L "$SKILL_LINK" ]; then
  rm "$SKILL_LINK"
  echo "Removed symlink $SKILL_LINK"
fi

if [ -L "$CLI_LINK" ]; then
  rm "$CLI_LINK"
  echo "Removed symlink $CLI_LINK"
fi

echo "Done."
