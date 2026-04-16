# panorama イベント駆動検出 設計仕様

## 背景

panorama は Claude Code のセッション状態（対応中 / 入力待ち）を Obsidian Kanban に反映する。現行実装は精度に問題がある:

1. `PreToolUse` フックだけで state を書いているため、ツール実行の間隙が 90s を超えると誤って「入力待ち」判定される
2. `Stop` フックを使っていないため「エージェント返答終了 = 入力待ち」を明示的に書き込めない
3. state ファイルを `{pwd-sanitized}.json` でキー化しているため worktree で作業すると state が別ファイルに分散し、カードと突合できない

本仕様は以下を目的とする:

- イベント駆動で state を確定書き込みし、タイムスタンプ推測を最小化
- session ID をプライマリキーにして worktree 問題を解消
- 推測ロジック廃止により誤判定を削減

## 目標

| 指標 | 現行 | 目標 |
|---|---|---|
| 対応中 → 入力待ち の誤移動 | 高頻度 | ほぼゼロ（Stop で確定） |
| 入力待ち → 対応中 の反映遅延 | 最大 60s + 90s | 最大 60s（次回 updater 実行） |
| worktree カードの追従 | フラジル | 設計上安定 |

## アーキテクチャ

### 3層構造（維持）

```
Claude Code hooks → state files → updater (60s周期) → Dashboard.md
```

### データフロー

```
[Claude Code]
  ├─ UserPromptSubmit ─┐
  ├─ PreToolUse        ├→ notify-state.sh active  → states/{session_id}.json
  ├─ PostToolUse       ┘
  └─ Stop               → notify-state.sh waiting → states/{session_id}.json

[updater]
  1. states/*.json を全読み込み
  2. bySession[session_id] / byCwd[cwd] の2つのインデックス構築
  3. 各カード:
     a. カード内 <!-- session: {id} --> で bySession 突合
     b. なければ path フィールドで byCwd にフォールバック
     c. STALE_THRESHOLD (1h) 超のエントリは waiting 扱い
  4. state に応じて 🟢対応中 / 🟡入力待ち へ列移動
```

## コンポーネント

### hooks/notify-state.sh

**役割:** Claude Code フックから呼ばれ、stdin JSON を読んで state ファイルを書く。

**入力:**
- 引数1: `active` または `waiting`
- stdin: Claude Code の hook payload JSON（`session_id`, `cwd`, `hook_event_name` を含む）

**出力:**
- `$HOME/.config/panorama/states/{session_id}.json` を書き込み

**挙動:**

```bash
#!/usr/bin/env bash
set -euo pipefail

STATE="${1:-active}"
STATE_DIR="$HOME/.config/panorama/states"
mkdir -p "$STATE_DIR"

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')

# session_id が取れなければ pwd フォールバック
if [ -z "$SESSION_ID" ]; then
  SESSION_ID=$(pwd | sed 's|/|_|g')
  CWD="$CWD"
fi

STATE_FILE="$STATE_DIR/${SESSION_ID}.json"
cat > "$STATE_FILE" <<EOF
{"state":"${STATE}","timestamp":$(date +%s),"session_id":"${SESSION_ID}","cwd":"${CWD}"}
EOF
```

**失敗モード:**
- jq 不在 → 実行失敗。インストーラの doctor でチェック
- stdin が空 → session_id も cwd も空。pwd フォールバック発動

### install.sh のフック登録

`~/.claude/settings.json` に4つのフックを登録:

```json
{
  "hooks": {
    "UserPromptSubmit": [{"hooks":[{"type":"command","command":"~/.local/share/panorama/hooks/notify-state.sh active"}]}],
    "PreToolUse":       [{"hooks":[{"type":"command","command":"~/.local/share/panorama/hooks/notify-state.sh active"}]}],
    "PostToolUse":      [{"hooks":[{"type":"command","command":"~/.local/share/panorama/hooks/notify-state.sh active"}]}],
    "Stop":             [{"hooks":[{"type":"command","command":"~/.local/share/panorama/hooks/notify-state.sh waiting"}]}]
  }
}
```

**idempotent:** jq で重複登録を防ぐ（既存フック配列に同一 command を追加しない）。

### src/lib/tmux.js の readHookState 書き換え

現行の `readHookState(cardPath)` は pwd キーで探索、worktree もグロブで拾っていた。

**新 API:**

```javascript
// 全 state ファイルを読み、bySession / byCwd インデックスを返す
export function loadAllHookStates() {
  // returns { bySession: Map<id, state>, byCwd: Map<cwd, state> }
}

// カードに紐づく state を解決（session ID 優先、cwd フォールバック）
export function resolveCardState(card, indices) {
  // returns state object or null
}
```

### src/lib/tmux.js の detectClaudeCodeState

**引数:** hookState オブジェクト
**戻り値:** `'active' | 'waiting' | null`

```javascript
const STALE_THRESHOLD_SEC = 3600; // 1h

export function detectClaudeCodeState(hookState, staleThreshold = STALE_THRESHOLD_SEC) {
  if (hookState === null) return null;
  const elapsed = Math.floor(Date.now() / 1000) - hookState.timestamp;
  if (elapsed > staleThreshold) return 'waiting';  // セッション死亡保険
  return hookState.state;  // 'active' or 'waiting' をそのまま
}
```

**変更点:**
- 旧: `active && elapsed < 90s` → active、それ以外 → waiting（timestamp 推測）
- 新: state フィールドをそのまま信頼。STALE_THRESHOLD (1h) だけが保険

### src/update.js のマッチングループ

```javascript
const indices = loadAllHookStates();

for (const card of cards) {
  const fields = extractCardFields(card.body);
  const hookState = resolveCardState(card, indices);
  const state = detectClaudeCodeState(hookState);
  if (state === null) continue;
  // 以降、現行通り
}
```

## データ形式

### state ファイル

パス: `$HOME/.config/panorama/states/{session_id}.json`

```json
{
  "state": "active",
  "timestamp": 1776308886,
  "session_id": "b02b3766-2624-43ef-98a9-c1777e543ca5",
  "cwd": "/Users/go/work/github/panorama"
}
```

**state 値:** `active` / `waiting`（permission は廃止済み）

### Kanban カード（既存、変更なし）

```markdown
- **panorama / リファクタリング**
	- **path:** /Users/go/work/github/panorama
	- → [[projects/panorama]]
	<!-- session: b02b3766-2624-43ef-98a9-c1777e543ca5 -->
```

## 移行手順

1. 旧 state ファイル全削除: `rm -rf ~/.config/panorama/states/*`
2. `hooks/notify-state.sh` 書き換え
3. `install.sh` のフック登録を4種類対応に更新
4. `src/lib/tmux.js` / `src/update.js` マッチング書き換え
5. テスト更新
6. 再インストール → 動作確認

## エッジケース

| ケース | 挙動 |
|---|---|
| Claude Code クラッシュ | Stop 未発火 → state="active" のまま → STALE_THRESHOLD (1h) で waiting 扱い |
| 複数セッション同 cwd | session ID で区別。cwd インデックスは新しい方を保持 |
| カードに session ID なし & path 一致 cwd あり | path フォールバック発動 |
| カードに session ID なし & path 一致もなし | updater は触らない（手動管理扱い） |
| worktree で作業中 | session ID が一致すれば state 追従 |
| 古い state ファイル蓄積 | 将来 SessionEnd hook で削除 or updater で 24h 超自動削除（本仕様スコープ外） |

## テスト戦略

### ユニットテスト

| テスト | 対象 | ケース |
|---|---|---|
| `detectClaudeCodeState` | state 判定 | active 新鮮 → active / waiting → waiting / active 1h超 → waiting / null → null |
| `loadAllHookStates` | インデックス構築 | 複数ファイル読込、重複 cwd 時の新しい方保持 |
| `resolveCardState` | カード突合 | session ID 優先、path フォールバック、両方なしで null |

### 統合テスト

| テスト | ケース |
|---|---|
| `runUpdate` | active state → 🟢 / waiting state → 🟡 / state なし → 変更なし |

### 手動動作確認

1. 新規セッション起動 → UserPromptSubmit → state=active 確認
2. ツール実行中 → state=active 維持
3. 返答完了 → state=waiting に切替
4. worktree でツール実行 → main リポジトリのカード（同 session）が 🟢 に移動

## スコープ外

- `SessionEnd` フック（クリーンアップ用、将来）
- 古 state ファイル自動削除
- 通知フック連携
- permission 列再導入

## オープンクエスチョン

なし（実装時に決定）
