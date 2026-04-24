---
name: panorama
description: "Obsidian Kanban ダッシュボードのタスク管理。サブコマンド: /panorama init, /panorama new, /panorama update, /panorama done, /panorama block, /panorama unblock"
---

# panorama — Obsidian Kanban タスク管理

サブコマンドで操作する。引数でサブコマンドを判別:

| コマンド | 動作 |
|---|---|
| `/panorama init` | ghostty の現在ウィンドウを 2×4 grid に分割 |
| `/panorama new [名前]` | 既存タスク完了 → 新タスク作成 → 🟢 対応中 |
| `/panorama update` | タスク名・セッションID更新、コンテキスト70%超で compact |
| `/panorama done` | タスクをアーカイブして削除 |
| `/panorama block` | 🔴 ブロック中に移動 |
| `/panorama unblock` | 🟢 対応中に戻す |

引数なしの `/panorama` は `/panorama new` として扱う。

## 前提

- Vault: `~/Documents/Obsidian/work-dashboard`
- Dashboard: `$VAULT/Dashboard.md`
- プロジェクトノート: `$VAULT/projects/<name>.md`
- auto マーカー: 行末 `<!-- auto -->` は絶対に手で書かない
- セッションID: `<!-- session: {id} -->` としてHTMLコメントで埋め込み
- PC名 (`pc` フィールド): 複数PCから接続することを想定し、カード作成/更新時に現在のマシン名を記録する
- tmux セッション名 (`tmux` フィールド): tmux 配下で作業している場合のみ記録する。tmux 外では省略（フィールドごと書かない）

### セッションID取得

```bash
PROJECT_DIR="$HOME/.claude/projects/$(pwd | sed 's|/|-|g')"
SESSION_ID=$(ls -t "$PROJECT_DIR"/*.jsonl 2>/dev/null | head -1 | xargs basename | sed 's/\.jsonl$//')
```

### PC名取得

```bash
PC_NAME=$(scutil --get ComputerName 2>/dev/null || hostname -s)
```

### tmux セッション名取得

```bash
TMUX_SESSION=$(tmux display-message -p '#S' 2>/dev/null || echo "")
```

`TMUX_SESSION` が空文字の場合は tmux 外で実行されているので、カード/履歴への `tmux` フィールド追記を丸ごとスキップする。

---

## /panorama init

現在の ghostty ウィンドウを 2×4 grid（横 4・縦 2、合計 8 pane）に分割する。

1. `scripts/init_ghostty.sh` を実行:

```bash
bash "$HOME/.claude/skills/panorama/scripts/init_ghostty.sh"
```

2. スクリプトは AppleScript 経由で以下を実行（binary split で各分割を 50/50 に保つ）:
   - **Phase 1**: 横方向に 4 等分（A|C|B|D）
     1. `cmd+d` で右分割（A|B、focus=B）
     2. `cmd+opt+left` で A へ戻る
     3. `cmd+d` で A を分割（A|C|B、focus=C）
     4. `cmd+opt+right` で B へ
     5. `cmd+d` で B を分割（A|C|B|D、focus=D）
   - **Phase 2**: 各列を下方向に分割（右端 D から左へ順に）
     1. `cmd+shift+d` で D を下分割
     2. `cmd+opt+left` で B 列へ、`cmd+shift+d`
     3. `cmd+opt+left` で C 列へ、`cmd+shift+d`
     4. `cmd+opt+left` で A 列へ、`cmd+shift+d`
   - **Phase 3**: `cmd+ctrl+=` で `equalize_splits` を呼び、端数丸めの誤差を解消して全 pane を均等化

3. 注意:
   - ghostty が起動済みであること（起動していなければスクリプトはエラーで終了）
   - 初回は「システム設定 → アクセシビリティ」で osascript/ターミナルに権限付与が必要
   - ghostty の keybind がデフォルトであること（カスタマイズしている場合は動作しない）

---

## /panorama new [名前]

1. コンテキスト取得:

```bash
pwd
git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "(n/a)"
```

2. セッションID・PC名・tmux セッション名を取得:

```bash
PROJECT_DIR="$HOME/.claude/projects/$(pwd | sed 's|/|-|g')"
SESSION_ID=$(ls -t "$PROJECT_DIR"/*.jsonl 2>/dev/null | head -1 | xargs basename | sed 's/\.jsonl$//')
PC_NAME=$(scutil --get ComputerName 2>/dev/null || hostname -s)
TMUX_SESSION=$(tmux display-message -p '#S' 2>/dev/null || echo "")
```

3. `$VAULT/Dashboard.md` を読み、現在のセッションID と一致する `<!-- session: {id} -->` または `<!-- session: {id} | blocked -->` を持つカードを 🟢/🟡/🔴 から検索。見つかれば `/panorama done` のステップ2〜6を全て実行して自動完了する（アーカイブ＋✅完了へ移動）。セッションIDで見つからない場合は、同じ `path` のカードを 🟢/🟡/🔴 からフォールバック検索する。

4. タスク名を決定。引数があればそのまま使用。なければ会話履歴から提案して確認。

5. tmux 配下の場合、ウィンドウ名を変更:

```bash
tmux rename-window "{task}"
```

6. `## 🟢 対応中` の直下にカードを挿入。`TMUX_SESSION` が空文字なら `**tmux:**` 行は省略する:

```markdown
- **{project} / {task}**
	- **path:** {absolute-path}
	- **pc:** {pc-name}
	- **tmux:** {tmux-session}
	- → [[projects/{project}]]
	<!-- session: {session-id} -->
```

7. ユーザに完了を通知。

---

## /panorama update

1. セッションIDを取得し、Dashboard.md から `<!-- session: {id} -->` が一致するカードを特定。見つからなければ `pwd` の `path:` フィールドでフォールバック検索。それでも見つからなければユーザに通知して終了。

2. 会話履歴からタスク名を再提案し、ユーザー確認後にカードのタイトル行を更新。

3. カード内の `<!-- session: ... -->` を現在のセッションIDに更新。存在しなければ追加。

4. カード内の `**pc:** {old}` を現在の PC名（前提セクション「PC名取得」の `PC_NAME` に従う）に更新。`pc` フィールドが存在しない場合は `**path:**` 行の直後に `- **pc:** {pc-name}` を追加する。

5. tmux セッション名の更新（前提セクション「tmux セッション名取得」の `TMUX_SESSION` に従う）:
   - `TMUX_SESSION` が空文字（tmux 外）の場合、カードに `**tmux:**` 行があっても削除しない・追加もしない（no-op）。
   - `TMUX_SESSION` が空でない場合、カード内の `**tmux:** {old}` を更新。`tmux` フィールドが存在しない場合は `**pc:**` 行の直後に `- **tmux:** {tmux-session}` を追加する。

6. tmux 配下の場合、ウィンドウ名を新タスク名に更新:

```bash
tmux rename-window "{task}"
```

7. コンテキスト使用量を確認。ステータスバーの使用率が 70% 以上なら `/compact` を実行。

---

## /panorama done

**重要: 全ステップを順番通りに実行すること。ステップのスキップ禁止。ステップ7の `/clear` 実行は必須。**

1. セッションIDで Dashboard.md から該当カードを特定（🟢/🟡/🔴 全てを検索し、`<!-- session: {id} -->` または `<!-- session: {id} | blocked -->` で突合）。見つからなければ `pwd` の `path:` フィールドで 🟢/🟡/🔴 全列をフォールバック検索。見つからなければユーザに通知して終了。

2. カードからプロジェクト名とタスク名を抽出（タイトル行 `**{project} / {task}**` をパース）。

3. `$VAULT/projects/{project}.md` が存在しなければ作成:

```markdown
# {project}

## 概要


## リンク


## 履歴

```

4. `$VAULT/projects/{project}.md` の `## 履歴` セクションに追記。`tmux` 行はカードから抽出し、無ければ省略（tmux 外で作業したタスク）:

```markdown
### YYYY-MM-DD {task}

- session: {session-id}
- branch: {branch}
- path: {path}
- pc: {pc-name}
- tmux: {tmux-session}
```

※ `pc` はカードから抽出。無ければ前提セクション「PC名取得」の `PC_NAME` を使って補う (`scutil --get ComputerName 2>/dev/null || hostname -s`)。`tmux` もカードから抽出し、無ければその行ごと省略する。

5. Dashboard.md でカードを `## ✅ 完了` 列に移動する（削除しない）。カードのテキストブロック全体（タイトル行〜`<!-- session: ... -->` 行を含む）を現在の列から切り取り、`## ✅ 完了` の直下に挿入する。

6. ユーザに以下の形式で完了を通知:

```
panorama done 完了
- タスク: {project} / {task}
- 履歴: projects/{project}.md に追記済み
- セッション: {session-id}
- カードを ✅完了 に移動済み
```

7. **必ず** `/clear` を実行してコンテキストをリセットする。スキップ禁止。

---

## /panorama block

1. セッションIDで Dashboard.md から該当カードを特定（`<!-- session: {id} -->` で突合）。見つからなければ `pwd` の `path:` フィールドでフォールバック検索。見つからなければユーザに通知して終了。

2. カードのテキストブロック（タイトル・フィールド・セッションコメント全て）を現在の列から切り取り、🔴 で始まる列の直下に挿入する。カードのタイトルは変更しない。

3. tmux ウィンドウ名の先頭に `[BLOCK] ` を追加（元のウィンドウ名はそのまま残す）:

```bash
CURRENT=$(tmux display-message -p '#W')
tmux rename-window "[BLOCK] $CURRENT"
```

4. カード内の `<!-- session: {id} -->` を `<!-- session: {id} | blocked -->` に更新。

5. ユーザに通知。

---

## /panorama unblock

1. セッションIDで Dashboard.md からブロック中のカードを特定（🔴 列の `<!-- session: {id} | blocked -->` で突合）。見つからなければ `pwd` の `path:` フィールドで🔴列をフォールバック検索。見つからなければユーザに通知して終了。

2. カードのテキストブロックを 🔴 列から切り取り、`## 🟢 対応中` の直下に挿入する。

3. tmux ウィンドウ名から `[BLOCK] ` を除去:

```bash
CURRENT=$(tmux display-message -p '#W')
tmux rename-window "${CURRENT#\[BLOCK\] }"
```

4. カード内の `<!-- session: {id} | blocked -->` から `| blocked` を除去。

5. セッションIDを現在のセッションに更新。

6. カード内の `**pc:**` を現在の PC名（前提セクション「PC名取得」の `PC_NAME`）に更新。別PCで unblock したときに追跡できるようにするため。`pc` フィールドが無ければ `**path:**` 行の直後に追加する。

7. tmux セッション名を現在の値（前提セクション「tmux セッション名取得」の `TMUX_SESSION`）で更新。空文字なら既存の `tmux` 行には触れず追加もしない。空でなければ `**tmux:** {old}` を新しい値に置換、存在しなければ `**pc:**` 行の直後に `- **tmux:** {tmux-session}` を追加する。

8. ユーザに通知。

---

## プロジェクトノート作成

`/panorama done` で projects ノートが必要になった場合に自動実行。手動トリガ: 「プロジェクトノート作って」

1. プロジェクト名を引数で受け取る（無ければカレントディレクトリの basename）
2. `$VAULT/projects/{name}.md` が既に存在するなら上書きしない
3. 存在しない場合はテンプレートで作成

---

## 禁止事項

- `<!-- auto -->` マーカー付き行の値を手で書き換えない
- Kanban の列見出しを編集・移動しない
- updater が動いていなくてもスキル操作は完結する
- `<!-- session: ... -->` はスキルのみが管理する
