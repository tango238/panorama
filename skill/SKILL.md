---
name: panorama
description: "Obsidian Kanban ダッシュボードのタスク管理。サブコマンド: /panorama new, /panorama update, /panorama done, /panorama block, /panorama unblock"
---

# panorama — Obsidian Kanban タスク管理

サブコマンドで操作する。引数でサブコマンドを判別:

| コマンド | 動作 |
|---|---|
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

### セッションID取得

```bash
PROJECT_DIR="$HOME/.claude/projects/$(pwd | sed 's|/|-|g; s|^-||')"
SESSION_ID=$(ls -t "$PROJECT_DIR"/*.jsonl 2>/dev/null | head -1 | xargs basename | sed 's/\.jsonl$//')
```

---

## /panorama new [名前]

1. コンテキスト取得:

```bash
pwd
git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "(n/a)"
```

2. セッションID取得:

```bash
PROJECT_DIR="$HOME/.claude/projects/$(pwd | sed 's|/|-|g; s|^-||')"
SESSION_ID=$(ls -t "$PROJECT_DIR"/*.jsonl 2>/dev/null | head -1 | xargs basename | sed 's/\.jsonl$//')
```

3. `$VAULT/Dashboard.md` を読み、同じ `path` のカードを 🟢/🟠/🟡 から検索。見つかれば `/panorama done` と同じ手順で自動完了する。

4. タスク名を決定。引数があればそのまま使用。なければ会話履歴から提案して確認。

5. tmux 配下の場合、ウィンドウ名を変更:

```bash
tmux rename-window "{task}"
```

6. `## 🟢 対応中` の直下にカードを挿入:

```markdown
- **{project} / {task}**
	- **path:** {absolute-path}
	- **branch:** (n/a) <!-- auto -->
	- → [[projects/{project}]]
	<!-- session: {session-id} -->
```

7. ユーザに完了を通知。

---

## /panorama update

1. `pwd` で Dashboard.md から該当カードを特定（`path:` フィールドで突合）。見つからなければユーザに通知して終了。

2. 会話履歴からタスク名を再提案し、ユーザー確認後にカードのタイトル行を更新。

3. セッションIDを取得し、カード内の `<!-- session: ... -->` を現在のセッションIDに更新。存在しなければ追加。

4. tmux 配下の場合、ウィンドウ名を新タスク名に更新:

```bash
tmux rename-window "{task}"
```

5. コンテキスト使用量を確認。ステータスバーの使用率が 70% 以上なら `/compact` を実行。

---

## /panorama done

1. `pwd` で Dashboard.md から該当カードを特定（`path:` フィールドで突合）。見つからなければユーザに通知して終了。

2. カードからプロジェクト名とタスク名を抽出（タイトル行 `**{project} / {task}**` をパース）。

3. `$VAULT/projects/{project}.md` が存在しなければ作成:

```markdown
# {project}

## 概要


## リンク


## 履歴

```

4. `## 履歴` セクションに追記:

```markdown
### YYYY-MM-DD {task}

- session: {session-id}
- branch: {branch}
- path: {path}
```

5. Dashboard.md からカードを削除（カード開始行から次の `- **` または `##` の手前まで。`<!-- session: ... -->` 行も含む）。

6. ユーザに完了を通知。

---

## /panorama block

1. `pwd` で Dashboard.md から該当カードを特定。見つからなければユーザに通知して終了。

2. カードのテキストブロックを現在の列から切り取り、🔴 で始まる列の直下に挿入する（Edit ツールで実行）。

3. tmux ウィンドウ名を変更:

```bash
tmux rename-window "[BLOCK] {task}"
```

4. カード内の `<!-- session: {id} -->` を `<!-- session: {id} | blocked -->` に更新。

5. ユーザに通知。

---

## /panorama unblock

1. `pwd` で Dashboard.md からブロック中のカードを特定（🔴 列を検索）。見つからなければユーザに通知して終了。

2. カードのテキストブロックを 🔴 列から切り取り、`## 🟢 対応中` の直下に挿入する。

3. tmux ウィンドウ名から `[BLOCK] ` を除去:

```bash
CURRENT=$(tmux display-message -p '#W')
tmux rename-window "${CURRENT#\[BLOCK\] }"
```

4. カード内の `<!-- session: {id} | blocked -->` から `| blocked` を除去。

5. セッションIDを現在のセッションに更新。

6. ユーザに通知。

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
