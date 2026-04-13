---
name: panorama
description: Use when the user wants to register the current tmux pane's work into the Obsidian Kanban dashboard, archive a completed card, or create a project note. Trigger phrases include "ダッシュボードに追加", "今の作業を登録", "この作業完了", "アーカイブして", "プロジェクトノート作って".
---

# panorama — Obsidian Kanban ダッシュボード操作スキル

このスキルは、macOS 上の panorama システム（`~/Documents/Obsidian/work-dashboard/Dashboard.md` を Kanban として運用する）のカード操作を行う。auto マーカー付きフィールド（alive / branch / last-commit / last-activity）は絶対に手で書かない。

## 前提

- Vault パス: `~/Documents/Obsidian/work-dashboard`（config.yaml で上書き可能だが、スキルは既定値で動く）
- Dashboard: `$VAULT/Dashboard.md`
- プロジェクトノート: `$VAULT/projects/<name>.md`
- auto 行のマーカー: 行末に `<!-- auto -->` を必ず残す

## 操作 A: 新カード追加

トリガ: 「ダッシュボードに追加」「今の作業を登録」

手順:

1. 現在のコンテキストを取得:

```bash
pwd
git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "(n/a)"
```

2. tmux コンテキストを取得（tmux 配下でない場合は `(tmux外)` を使う）:

```bash
if [ -n "$TMUX" ]; then
  S=$(tmux display-message -p '#S')
  W=$(tmux display-message -p '#W')
  I=$(tmux display-message -p '#I')
  P=$(tmux display-message -p '#P')
  echo "\`$S:$W\` (window #$I, pane #$P)"
else
  echo "(tmux外)"
fi
```

3. タスク名を決定する。引数が渡されていればそれをそのまま使う。なければ、このセッションの会話履歴から直近の作業内容を要約して短いタスク名を提案し、ユーザに確認する。例: 「panorama / Kanbanカード形式の修正」でよいですか？

4. tmux 配下の場合、現在のウィンドウ名をタスク名に設定する:

```bash
tmux rename-window "{task}"
```

5. `$VAULT/Dashboard.md` を読み、`## 🟢 対応中` の直下に次のカードを挿入する（タブでインデント）:

```markdown
- **{project} / {task}**
	- **tmux:** {tmux-field-or-(tmux外)}
	- **path:** {absolute-path}
	- **alive:** (n/a) <!-- auto -->
	- **branch:** (n/a) <!-- auto -->
	- **last-commit:** (n/a) <!-- auto -->
	- **last-activity:** (n/a) <!-- auto -->
	- → [[projects/{project}]]
```

6. ファイルを保存。次回 updater 実行（最大 180 秒）で auto フィールドが埋まる旨をユーザに伝える。

## 操作 D: 完了アーカイブ

トリガ: 「この作業完了」「アーカイブして」

手順:

1. 対象カードを特定（`pwd` で突合。見つからなければユーザに確認）
2. カード全体のテキストを `$VAULT/projects/{project}.md` の `## 履歴` セクションに、見出し `### YYYY-MM-DD {task}` を添えて追記（projects ノートが存在しない場合は先に操作 E を実行）
3. Dashboard.md から該当カード（`- **title**` から次の `- **` または `##` の手前まで）を削除
4. 変更内容をユーザに要約

## 操作 E: projects/ ノート作成

トリガ: 「プロジェクトノート作って」

手順:

1. プロジェクト名を引数で受け取る（無ければカレントディレクトリの basename）
2. `$VAULT/projects/{name}.md` が既に存在するなら上書きしない
3. 存在しない場合は以下のテンプレートで作成:

```markdown
# {name}

## 概要


## リンク


## 履歴

```

## 禁止事項

- auto マーカー付き行 (`<!-- auto -->`) の値を書き換えない
- Kanban の列見出し (`## 🟢 対応中` 等) を編集・移動しない
- updater が動いていなくてもスキル操作は完結する（auto フィールドは次回 updater で埋まる）
