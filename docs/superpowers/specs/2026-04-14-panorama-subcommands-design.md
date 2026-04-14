# panorama サブコマンド設計

## 概要

panorama スキルを5つのサブコマンドに分割し、セッションIDによるタスク管理を追加する。

## サブコマンド一覧

| コマンド | 動作 |
|---|---|
| `/panorama new [名前]` | 同じ path の既存カードを完了 → 新カード作成 → 🟢 対応中 |
| `/panorama update` | タスク名・セッションID更新、コンテキスト70%超で `/compact` |
| `/panorama done` | カードを projects ノートにアーカイブして Dashboard から削除 |
| `/panorama block` | 🔴 ブロック中に移動、ウィンドウ名に `[BLOCK]` 付与 |
| `/panorama unblock` | 🟢 対応中に戻す、ウィンドウ名から `[BLOCK]` 除去 |

## カードテンプレート

```markdown
- **{project} / {task}**
	- **path:** {absolute-path}
	- **branch:** (n/a) <!-- auto -->
	- → [[projects/{project}]]
	<!-- session: {session-id} -->
```

- `path`: 作業ディレクトリの絶対パス。hook 状態ファイルのキーとしても使用。
- `branch`: updater が自動更新 (`<!-- auto -->` マーカー付き)。
- `→ [[projects/{project}]]`: Obsidian のプロジェクトノートへのリンク。
- `<!-- session: {id} -->`: HTMLコメントとして非表示。Kanban 表示に影響しない。

## セッションID

### 取得方法

`~/.claude/projects/` 配下のプロジェクトディレクトリから最新の `.jsonl` ファイル名（拡張子除去）を取得する。

```bash
PROJECT_DIR="$HOME/.claude/projects/$(pwd | sed 's|/|-|g; s|^-||')"
SESSION_ID=$(ls -t "$PROJECT_DIR"/*.jsonl 2>/dev/null | head -1 | xargs basename | sed 's/\.jsonl$//')
```

### 用途

- タスクとセッションの関連付け
- 後からセッションの会話ログを参照可能にする

## 各コマンド詳細

### `/panorama new [名前]`

1. `pwd` と `git rev-parse --abbrev-ref HEAD` でコンテキスト取得
2. Dashboard.md を読み、同じ `path` のカードを 🟢/🟠/🟡 から検索
3. 見つかれば操作 D (完了アーカイブ) を実行して自動完了
4. タスク名を決定: 引数があればそのまま使用、なければ会話履歴から提案して確認
5. tmux ウィンドウ名をタスク名に変更: `tmux rename-window "{task}"`
6. 🟢 対応中 の直下にカードを挿入（テンプレートに従う）
7. セッションIDをHTMLコメントで埋め込み

### `/panorama update`

1. `pwd` で Dashboard.md から該当カードを特定
2. 会話履歴からタスク名を再提案し、ユーザー確認後に更新
3. セッションIDを現在のセッションに更新
4. tmux ウィンドウ名を新タスク名に更新
5. コンテキスト使用量を確認し、70%以上なら `/compact` を実行

### `/panorama done`

1. `pwd` で該当カードを特定
2. カード全体を `$VAULT/projects/{project}.md` の `## 履歴` に `### YYYY-MM-DD {task}` として追記
3. projects ノートが存在しなければ先に作成
4. Dashboard.md からカードを削除

### `/panorama block`

1. `pwd` で該当カードを特定
2. カードを 🔴 ブロック中 レーンに移動 (moveCard)
3. tmux ウィンドウ名を `[BLOCK] {task}` に変更
4. セッションIDコメントに blocked を追記: `<!-- session: {id} | blocked -->`

### `/panorama unblock`

1. `pwd` で該当カードを特定 (🔴 レーンを検索)
2. カードを 🟢 対応中 レーンに移動
3. tmux ウィンドウ名から `[BLOCK] ` を除去
4. セッションIDコメントから `| blocked` を除去

## コンテキスト自動 compact

`/panorama update` 実行時にコンテキスト使用量を確認する。
Claude Code のステータスバーに表示される使用率 (例: `🪙 197.4K 25%`) が 70% 以上の場合、`/compact` を実行してコンテキストを圧縮する。

## 変更対象ファイル

- `skill/SKILL.md`: 5つのサブコマンドの手順を記載
- `src/lib/parse-dashboard.js`: moveCard を block/unblock で再利用
- テスト追加: サブコマンドごとのカード操作テスト

## 禁止事項 (既存から継続)

- `<!-- auto -->` マーカー付き行の値を手で書き換えない
- Kanban の列見出しを編集・移動しない
- updater が動いていなくてもスキル操作は完結する
