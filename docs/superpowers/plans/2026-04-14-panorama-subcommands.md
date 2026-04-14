# panorama サブコマンド実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** panorama スキルを new/update/done/block/unblock の5サブコマンドに分割し、セッションID管理を追加する

**Architecture:** SKILL.md を書き換えてサブコマンドのルーティングと各操作手順を定義。既存の parse-dashboard.js (moveCard) を block/unblock で再利用。セッションIDは `~/.claude/projects/` から取得しHTMLコメントでカードに埋め込む。

**Tech Stack:** Node.js, Claude Code Skills (SKILL.md), Obsidian Kanban

---

## ファイル構成

- `skill/SKILL.md` — 全面書き換え。5サブコマンドの手順定義
- `test/skill-integration.test.js` — 新規。セッションID取得・カードテンプレート生成のテスト (※スキル自体はClaude Codeが実行するためユニットテスト範囲は限定的)

---

### Task 1: SKILL.md 書き換え — フロントマターとルーティング

**Files:**
- Modify: `skill/SKILL.md:1-16`

- [ ] **Step 1: フロントマター更新**

```yaml
---
name: panorama
description: "Obsidian Kanban ダッシュボードのタスク管理。サブコマンド: /panorama new, /panorama update, /panorama done, /panorama block, /panorama unblock"
---
```

- [ ] **Step 2: ルーティングセクション追加**

SKILL.md の冒頭（フロントマター直後）に以下を記載:

```markdown
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
```

- [ ] **Step 3: 前提セクション**

```markdown
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
```

- [ ] **Step 4: コミット**

```bash
git add skill/SKILL.md
git commit -m "feat(skill): add subcommand routing and session ID docs"
```

---

### Task 2: SKILL.md — `/panorama new` 操作

**Files:**
- Modify: `skill/SKILL.md`

- [ ] **Step 1: new 操作を記載**

```markdown
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
```

- [ ] **Step 2: コミット**

```bash
git add skill/SKILL.md
git commit -m "feat(skill): add /panorama new subcommand"
```

---

### Task 3: SKILL.md — `/panorama update` 操作

**Files:**
- Modify: `skill/SKILL.md`

- [ ] **Step 1: update 操作を記載**

```markdown
## /panorama update

1. `pwd` で Dashboard.md から該当カードを特定（`path:` フィールドで突合）。見つからなければユーザに通知して終了。

2. 会話履歴からタスク名を再提案し、ユーザー確認後にカードのタイトル行を更新。

3. セッションIDを取得し、カード内の `<!-- session: ... -->` を現在のセッションIDに更新。存在しなければ追加。

4. tmux 配下の場合、ウィンドウ名を新タスク名に更新:

```bash
tmux rename-window "{task}"
```

5. コンテキスト使用量を確認。ステータスバーの使用率が 70% 以上なら `/compact` を実行:

```bash
# ステータスバーから使用率を読み取る (例: 🪙 197.4K 25%)
# 70%以上の場合のみ /compact を実行
```

注: コンテキスト使用量はClaude Codeのシステム情報から取得する。プログラム的に取得できない場合はユーザーに確認する。
```

- [ ] **Step 2: コミット**

```bash
git add skill/SKILL.md
git commit -m "feat(skill): add /panorama update subcommand"
```

---

### Task 4: SKILL.md — `/panorama done` 操作

**Files:**
- Modify: `skill/SKILL.md`

- [ ] **Step 1: done 操作を記載**

```markdown
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

5. Dashboard.md からカードを削除（カード開始行から次の `- **` または `##` の手前まで）。

6. ユーザに完了を通知。
```

- [ ] **Step 2: コミット**

```bash
git add skill/SKILL.md
git commit -m "feat(skill): add /panorama done subcommand"
```

---

### Task 5: SKILL.md — `/panorama block` と `/panorama unblock` 操作

**Files:**
- Modify: `skill/SKILL.md`

- [ ] **Step 1: block 操作を記載**

```markdown
## /panorama block

1. `pwd` で Dashboard.md から該当カードを特定。見つからなければユーザに通知して終了。

2. カードのテキストブロックを現在の列から切り取り、🔴 で始まる列の直下に挿入する（Edit ツールで実行）。

3. tmux ウィンドウ名を変更:

```bash
tmux rename-window "[BLOCK] {task}"
```

4. カード内の `<!-- session: {id} -->` を `<!-- session: {id} | blocked -->` に更新。

5. ユーザに通知。
```

- [ ] **Step 2: unblock 操作を記載**

```markdown
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
```

- [ ] **Step 3: コミット**

```bash
git add skill/SKILL.md
git commit -m "feat(skill): add /panorama block and unblock subcommands"
```

---

### Task 6: SKILL.md — 禁止事項と旧操作の削除

**Files:**
- Modify: `skill/SKILL.md`

- [ ] **Step 1: 禁止事項セクション**

```markdown
## 禁止事項

- `<!-- auto -->` マーカー付き行の値を手で書き換えない
- Kanban の列見出しを編集・移動しない
- updater が動いていなくてもスキル操作は完結する
- `<!-- session: ... -->` はスキルのみが管理する
```

- [ ] **Step 2: 旧操作 (A/D/E) とtmuxコンテキスト取得の削除**

旧SKILL.mdの操作A・D・E・tmuxコンテキスト取得セクションを削除。新しいサブコマンドに置き換え済み。

- [ ] **Step 3: コミット**

```bash
git add skill/SKILL.md
git commit -m "refactor(skill): remove legacy operations, finalize subcommand structure"
```

---

### Task 7: インストール先に反映 + 動作確認

**Files:**
- No code changes — operational steps

- [ ] **Step 1: インストール先 pull**

```bash
cd ~/.local/share/panorama && git checkout -- . && git clean -fd && git pull origin main
```

- [ ] **Step 2: install.sh 実行**

```bash
~/.local/share/panorama/install.sh
```

- [ ] **Step 3: panorama doctor**

```bash
~/.local/bin/panorama doctor
```

全項目 OK を確認。

- [ ] **Step 4: `/panorama new` の動作確認**

Claude Code で `/panorama new テスト` を実行し:
- 既存カードがあれば自動完了されることを確認
- 新カードが 🟢 に追加されることを確認
- `<!-- session: ... -->` が埋め込まれることを確認
- tmux ウィンドウ名が変更されることを確認

- [ ] **Step 5: テスト完了後のクリーンアップ**

テスト用カードを `/panorama done` で削除。
