---
name: panorama
description: Use when the user wants to register the current tmux pane's work into the Obsidian Kanban dashboard, add "next to do" notes for a pane, archive a completed card, or create a project note. Trigger phrases include "ダッシュボードに追加", "今の作業を登録", "次にやること", "申し送り", "この作業完了", "アーカイブして", "プロジェクトノート作って".
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

3. ユーザにタスク名を聞く（直近の会話文脈があればそれを提案して確認）。例: "project-a / feat login"

4. `$VAULT/Dashboard.md` を読み、`## 🟢 対応中` の直下に次のカードを挿入する:

```markdown
### {project} / {task}

- **tmux:** {tmux-field-or-(tmux外)}
- **path:** {absolute-path}
- **alive:** (tmux外) <!-- auto -->
- **branch:** (n/a) <!-- auto -->
- **last-commit:** (n/a) <!-- auto -->
- **last-activity:** (n/a) <!-- auto -->

### 次にやること
- [ ] 

### メモ
- 

→ [[projects/{project}]]
```

5. ファイルを保存。次回 updater 実行（最大 180 秒）で auto フィールドが埋まる旨をユーザに伝える。

## 操作 C: 「次にやること」の追記

トリガ: 「次にやること」「申し送り」

手順:

1. `pwd` を取得
2. Dashboard.md を読み、各カードの `path:` フィールドを突合してカレントパスに一致するカードを特定
3. 該当カードの `### 次にやること` セクションに `- [ ] {user-supplied-or-inferred-text}` を追記
4. 該当カードが見つからなければ、ユーザにそう伝える（勝手に新規作成しない）

## 操作 D: 完了アーカイブ

トリガ: 「この作業完了」「アーカイブして」

手順:

1. 対象カードを特定（`pwd` で突合。見つからなければユーザに確認）
2. カード全体のテキストを `$VAULT/projects/{project}.md` の `## 履歴` セクションに、見出し `### YYYY-MM-DD {task}` を添えて追記（projects ノートが存在しない場合は先に操作 E を実行）
3. Dashboard.md から該当カード（`###` 見出しから次の `##`/`###` の手前まで）を削除
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
