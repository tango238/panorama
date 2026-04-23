#!/usr/bin/env bash
# panorama init: ghostty の現在ウィンドウを 2×4 grid に分割する。
#
# アルゴリズム (binary split で均等):
#   Phase 1: 横方向に 4 等分する (A|C|B|D)
#     1. cmd+d              : split right A → A|B, focus B
#     2. cmd+opt+left       : B → A
#     3. cmd+d              : split right A → A|C|B, focus C
#     4. cmd+opt+right      : C → B
#     5. cmd+d              : split right B → A|C|B|D, focus D
#
#   Phase 2: 各列を下方向に分割する (D 側から左に順次)
#     6. cmd+shift+d        : split down D → D_top/D_bot, focus D_bot
#     7. cmd+opt+left       : D_bot → B (左の列)
#     8. cmd+shift+d        : split down B
#     9. cmd+opt+left       : → C
#    10. cmd+shift+d        : split down C
#    11. cmd+opt+left       : → A
#    12. cmd+shift+d        : split down A
#
# 利点: phase 2 は cmd+opt+left のみで列移動できるため、
#       垂直方向 navigation のブレを回避できる。
#
# 前提:
#   - ghostty 起動済み
#   - アクセシビリティ権限付与済み
#   - ghostty キーバインドがデフォルト

set -euo pipefail

if ! osascript -e 'tell application "System Events" to return exists process "Ghostty"' >/dev/null 2>&1; then
  echo "error: ghostty is not running. launch it first." >&2
  exit 1
fi

osascript <<'APPLESCRIPT'
tell application "Ghostty" to activate
delay 0.3

tell application "System Events"
    -- Phase 1: 横方向に 4 等分
    --   A → A|B
    keystroke "d" using command down
    delay 0.25
    --   B → A へ戻る
    key code 123 using {command down, option down} -- left
    delay 0.25
    --   A → A|C|B
    keystroke "d" using command down
    delay 0.25
    --   C → B へ
    key code 124 using {command down, option down} -- right
    delay 0.25
    --   B → A|C|B|D
    keystroke "d" using command down
    delay 0.25

    -- Phase 2: 各列を下方向に分割 (右端 D から左へ順次)
    --   D 列を下分割
    keystroke "d" using {command down, shift down}
    delay 0.25
    --   左へ移動 → B 列
    key code 123 using {command down, option down}
    delay 0.25
    keystroke "d" using {command down, shift down}
    delay 0.25
    --   左へ移動 → C 列
    key code 123 using {command down, option down}
    delay 0.25
    keystroke "d" using {command down, shift down}
    delay 0.25
    --   左へ移動 → A 列
    key code 123 using {command down, option down}
    delay 0.25
    keystroke "d" using {command down, shift down}
end tell
APPLESCRIPT

echo "panorama init: ghostty を 2x4 に分割しました"
