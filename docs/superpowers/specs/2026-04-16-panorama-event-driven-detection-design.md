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
| 対応中 → 入力待ち の誤移動 | 高頻度 | 低頻度（Stop/Notification で確定） |
| 入力待ち → 対応中 の反映遅延 | 最大 60s + 90s | 最大 60s（次回 updater 実行） |
| worktree カードの追従 | フラジル | session ID 一致時は安定 |

## スコープと限界

**対応するケース:**
- 通常のターン終了（Stop フック発火）
- 許可プロンプト／ユーザー注意要求（Notification フック発火）
- ツール実行中（PreToolUse / PostToolUse）
- ユーザー送信直後（UserPromptSubmit）

**対応しないケース（既知の限界）:**
- ユーザー ESC 割り込み — Stop 未発火。state は active のまま残り、STALE_THRESHOLD (1h) まで検出されない
- API error / rate limit / token 枯渇 — Stop 未発火の可能性。同上
- Claude Code プロセスクラッシュ — 同上

**運用上の前提:**
- 新規カードは `/panorama new` で session ID が自動注入される
- 既存カードで session ID なしのものは cwd フォールバックに依存（精度劣る）
- worktree で動く Claude セッションは、そのセッション ID を持つカードが main repo path を指していても追従する（session ID 一致が主キーのため）

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
  ├─ Stop               → notify-state.sh waiting → states/{session_id}.json
  └─ Notification       → notify-state.sh waiting → states/{session_id}.json

[updater]
  1. states/*.json を全読み込み（parse error のファイルはスキップ）
  2. bySession[session_id] / byCwd[cwd] の2つのインデックス構築
  3. 各カード:
     a. カード内 <!-- session: {id} --> で bySession 突合
     b. なければ path フィールドで byCwd にフォールバック
     c. STALE_THRESHOLD (1h) 超のエントリは null 扱い（触らない）
  4. state に応じて 🟢対応中 / 🟡入力待ち へ列移動。state=null なら触らない
```

## コンポーネント

### hooks/notify-state.sh

**役割:** Claude Code フックから呼ばれ、stdin JSON を読んで state ファイルを原子的に書く。

**入力:**
- 引数1: `active` または `waiting`
- stdin: Claude Code の hook payload JSON（`session_id`, `cwd`, `hook_event_name` を含む）

**出力:**
- `$HOME/.config/panorama/states/{session_id}.json` を原子的に書き込み（temp + mv）

**設計原則:**
- **Fail-open:** hook 失敗で Claude Code のセッションを阻害しない。jq 不在や stdin 空などはサイレント終了
- **原子書き込み:** temp → mv。updater が partial JSON を読まない
- **JSON エスケープ:** 文字列補間禁止。`jq -n --arg` で組み立て

**実装:**

```bash
#!/usr/bin/env bash
# panorama state hook (fail-open, atomic write)
# Usage: notify-state.sh <active|waiting>
# Reads JSON from stdin with session_id, cwd

STATE="${1:-active}"
STATE_DIR="$HOME/.config/panorama/states"
mkdir -p "$STATE_DIR" 2>/dev/null || exit 0

# jq が無ければフェイルオープン
command -v jq >/dev/null 2>&1 || exit 0

INPUT=$(cat 2>/dev/null || echo '{}')
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty' 2>/dev/null || echo "")
CWD=$(echo "$INPUT" | jq -r '.cwd // empty' 2>/dev/null || echo "")

# session_id が取れなければ書かない（sanitized pwd は使わない）
[ -z "$SESSION_ID" ] && exit 0

# state 値バリデーション
case "$STATE" in
  active|waiting) ;;
  *) exit 0 ;;
esac

# session_id がファイル名として安全か確認（UUID 想定: 英数とハイフンのみ）
case "$SESSION_ID" in
  *[!a-zA-Z0-9-]*) exit 0 ;;
esac

STATE_FILE="$STATE_DIR/${SESSION_ID}.json"
TEMP_FILE=$(mktemp "$STATE_DIR/.tmp-XXXXXX" 2>/dev/null) || exit 0

TS=$(date +%s)
jq -n \
  --arg state "$STATE" \
  --argjson timestamp "$TS" \
  --arg session_id "$SESSION_ID" \
  --arg cwd "$CWD" \
  '{state: $state, timestamp: $timestamp, session_id: $session_id, cwd: $cwd}' \
  > "$TEMP_FILE" 2>/dev/null || { rm -f "$TEMP_FILE"; exit 0; }

mv -f "$TEMP_FILE" "$STATE_FILE" 2>/dev/null || rm -f "$TEMP_FILE"
exit 0
```

### install.sh のフック登録

**ファイル配置:**
- `install.sh` が `hooks/` ディレクトリを `~/.local/share/panorama/hooks/` にコピー（既に実装済みか要確認 → 未実装なら追加）
- 実行権限付与

**`~/.claude/settings.json` への追加:**

```json
{
  "hooks": {
    "UserPromptSubmit": [{"hooks":[{"type":"command","command":"~/.local/share/panorama/hooks/notify-state.sh active"}]}],
    "PreToolUse":       [{"hooks":[{"type":"command","command":"~/.local/share/panorama/hooks/notify-state.sh active"}]}],
    "PostToolUse":      [{"hooks":[{"type":"command","command":"~/.local/share/panorama/hooks/notify-state.sh active"}]}],
    "Stop":             [{"hooks":[{"type":"command","command":"~/.local/share/panorama/hooks/notify-state.sh waiting"}]}],
    "Notification":     [{"hooks":[{"type":"command","command":"~/.local/share/panorama/hooks/notify-state.sh waiting"}]}]
  }
}
```

**idempotency:** 各フックタイプごとに `notify-state.sh` を含む command の存在をチェック。なければ追加。既存の PreToolUse-only インストールからの upgrade でも、UserPromptSubmit/PostToolUse/Stop/Notification が追加される必要がある。

**doctor チェック項目追加:**
- `jq` のインストール確認
- `~/.local/share/panorama/hooks/notify-state.sh` の存在 + 実行権限
- `~/.claude/settings.json` に5種類の hook すべて登録されているか

### src/lib/tmux.js

**新 API:**

```javascript
// 全 state ファイルを読み、bySession / byCwd インデックスを返す
// parse error のファイルはスキップ（ログのみ）
export function loadAllHookStates() {
  // returns { bySession: Map<id, state>, byCwd: Map<cwd, state[]> }
  // byCwd は配列（複数セッション同 cwd 対応のため、timestamp 降順）
}

// カードに紐づく state を解決
export function resolveCardState(card, indices) {
  // 1. カード body から session_id を抽出 → bySession 突合
  // 2. なければ card.path → byCwd の最新 state
  // 3. どちらも無ければ null
}
```

### src/lib/tmux.js の detectClaudeCodeState

```javascript
const STALE_THRESHOLD_SEC = 3600; // 1h

const VALID_STATES = new Set(['active', 'waiting']);

export function detectClaudeCodeState(hookState, staleThreshold = STALE_THRESHOLD_SEC) {
  if (hookState === null) return null;
  if (!VALID_STATES.has(hookState.state)) return null; // 不正値は無視
  if (typeof hookState.timestamp !== 'number') return null;
  const elapsed = Math.floor(Date.now() / 1000) - hookState.timestamp;
  if (elapsed > staleThreshold) return null;  // stale は「触らない」
  return hookState.state;  // 'active' or 'waiting' をそのまま返す
}
```

**変更点（旧仕様比）:**
- 旧: stale は `waiting` 扱い → 死セッションが永久に 🟡 に固定される
- 新: stale は `null` 扱い → updater は触らない（手動管理委任）
- state 値のホワイトリスト検証追加

### src/update.js のマッチングループ

```javascript
const indices = loadAllHookStates();

for (const card of cards) {
  const fields = extractCardFields(card.body);
  const hookState = resolveCardState(card, indices);
  const state = detectClaudeCodeState(hookState);
  if (state === null) continue;
  // 以降、既存の AUTO_COLUMNS ガードと移動ロジック（現行 src/update.js:58-60）を維持
}
```

**重要:** 既存の `AUTO_COLUMNS` ガード（🟢/🟡 にあるカードのみ遷移対象）は維持する。他列（🔴/✅）にあるカードは state に関わらず触らない。

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

**state 値（ホワイトリスト）:** `active` / `waiting`
**session_id 制約:** 英数 + ハイフンのみ（UUID 想定）

### Kanban カード（既存）

```markdown
- **panorama / リファクタリング**
	- **path:** /Users/go/work/github/panorama
	- → [[projects/panorama]]
	<!-- session: b02b3766-2624-43ef-98a9-c1777e543ca5 -->
```

**session ID 注入メカニズム:**
- 新規: `/panorama new` が自動注入
- 既存: session ID 無しのまま。cwd フォールバックに依存（精度劣化を許容）
- 手動注入: ユーザーが `<!-- session: {id} -->` を直接追記する手段を残す

## 移行手順

1. 旧 state ファイル全削除: `rm -rf ~/.config/panorama/states/*`
2. `hooks/notify-state.sh` 書き換え（jq -n、atomic write、fail-open）
3. `install.sh` 更新:
   - `hooks/` を `~/.local/share/panorama/hooks/` にコピー + chmod +x
   - settings.json への5種類の hook 登録（idempotent、既存配列への追加に対応）
   - doctor に jq チェック追加
4. `src/lib/tmux.js` / `src/update.js` マッチング書き換え
5. テスト更新（下記）
6. 再インストール → 動作確認

## エッジケース

| ケース | 挙動 |
|---|---|
| Claude Code 正常終了 | Stop → state="waiting" 確定 |
| Claude Code クラッシュ / API error / user interrupt | Stop 未発火 → state="active" のまま → STALE_THRESHOLD (1h) で null → updater 触らない |
| 許可プロンプト / 注意要求 | Notification → state="waiting" 確定 |
| 複数セッション同 cwd | session ID で区別。cwd フォールバックは最新 timestamp を採用（精度劣化を許容） |
| カードに session ID なし & path 一致 cwd あり | cwd フォールバック発動（精度劣る） |
| カードに session ID なし & path 一致もなし | updater は触らない |
| worktree で作業中 | session ID が一致すれば state 追従 |
| state ファイル partial write | atomic write (temp + mv) で発生しない |
| state ファイル破損 | JSON parse error → スキップ |
| unknown state 値 | ホワイトリスト検証で弾く → null 扱い |
| missing timestamp | バリデーションで null 扱い |
| jq 不在 | hook は no-op 終了（fail-open）。installer doctor で検出 |
| hook stdin 空 | session_id 取れず no-op 終了 |
| 古い state ファイル蓄積 | stale は null 扱い。自動削除は将来 SessionEnd hook で（本仕様スコープ外、ただしログに警告） |

## テスト戦略

### ユニットテスト

| テスト | 対象 | ケース |
|---|---|---|
| `detectClaudeCodeState` | state 判定 | active 新鮮 / waiting 新鮮 / active 1h超 → null / waiting 1h超 → null / 不正 state → null / timestamp 欠損 → null / null 入力 → null |
| `loadAllHookStates` | インデックス構築 | 複数ファイル読込 / parse error スキップ / 同 cwd で timestamp 降順配列 |
| `resolveCardState` | カード突合 | session ID 一致 / session ID 無 + path 一致 / 両方なし → null / session ID 優先 |

### 統合テスト

| テスト | ケース |
|---|---|
| `runUpdate` | active → 🟢 / waiting → 🟡 / null → 変更なし / stale → 変更なし / 🔴/✅ 列のカードは触らない |

### Hook スクリプトテスト（bash）

| テスト | ケース |
|---|---|
| 正常 | session_id 入り stdin → state ファイル生成 |
| session_id 欠損 | no-op 終了、state ファイル生成されない |
| stdin 空 | no-op 終了 |
| jq 不在（シミュレート） | no-op 終了 |
| 不正 state 引数 | no-op 終了 |
| 不正 session_id（/ 含む等） | no-op 終了 |
| JSON 特殊文字（" \ 改行）含む cwd | エスケープされた state ファイル生成 |
| 並行実行 | atomic write で破損しない |

### 手動動作確認

1. 新規セッション起動 → UserPromptSubmit → state=active 確認
2. ツール実行中 → state=active 維持
3. 返答完了 → state=waiting に切替
4. 許可プロンプト発生 → Notification → state=waiting 切替
5. worktree でツール実行 → main リポジトリのカード（同 session）が 🟢 に移動
6. Claude Code を ESC で中断 → 1時間後カード触られない（現行ではない挙動）
7. PreToolUse-only の旧インストール上に再インストール → 4種類の hook が追加される

## スコープ外

- `SessionEnd` フック（古 state クリーンアップ用、将来）
- 24h 超 state ファイル自動削除
- 🟠 permission 列の再導入
- user interrupt / API error の正確な検出（Claude Code 側の限界）

## オープンクエスチョン（実装時判定）

1. **Notification hook のマッチング粒度** — `matcher` で特定 notification のみフィルタするか、全 notification を waiting 扱いにするか。初期実装は全扱い、誤移動が目立つようなら絞る
2. **STALE_THRESHOLD 値** — 1h が妥当か、短縮すべきか。ユーザー interrupt の放置時間と相談
3. **既存 hook config からの migration** — `install.sh` で旧 PreToolUse のみ→5種類への追加を確実に行うための jq クエリ実装。既存の matcher 有無で分岐が必要
4. **cwd フォールバック時の複数セッション衝突** — 同 cwd 複数セッションは最新 timestamp を採用。それで十分か要検証。最悪ケースは「別セッションの state で誤判定」の短時間発生
5. **session ID 未注入の既存カード救済策** — 手動注入のみで十分か、マイグレーションスクリプトが必要か（スコープ判断）
