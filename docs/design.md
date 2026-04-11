---
name: panorama design
date: 2026-04-11
status: draft
---

# panorama — 並列pane作業ダッシュボードシステム

## 1. 目的と背景

tmux / ghostty で複数のwindow・paneを開き、8pane並列でClaude Codeを中心とした作業を行っていると、以下の情報を見失いがちになる:

1. **識別**: そのpaneがどのプロジェクト/タスクなのか
2. **進捗**: 今どのステップまで進んでいるか
3. **状態**: 自分の入力待ちなのか実行中なのか
4. **再開時の文脈**: 次に戻ってきたとき何をやる予定だったか

panorama は、これら4つの情報を Obsidian Vault 上のKanbanボードに集約し、`git` / `tmux` の状態を定期的に自動で反映することで「全paneの全景を一望できる」ダッシュボードを提供する。

## 2. 全体アーキテクチャ

```
┌──────────────────────────────────────────────────────────┐
│ Obsidian Vault: ~/Documents/Obsidian/work-dashboard      │
│                                                           │
│   Dashboard.md  (Kanban)                                  │
│   projects/<name>.md  (プロジェクト別の詳細ノート)         │
└──────────▲───────────────────────────▲───────────────────┘
           │ 手動編集                   │ 自動更新
           │                           │
   ┌───────┴────────┐          ┌───────┴──────────┐
   │ Claude Code    │          │ panorama updater │
   │ Skill          │          │ (launchd 180s)   │
   │ (~/.claude/    │          │                  │
   │   skills/      │          │  tmux list-panes │
   │   panorama)    │          │  git rev-parse   │
   │                │          │  git log         │
   │  "ダッシュボード  │          │                  │
   │   に追加"で     │          │                  │
   │   カード生成    │          │                  │
   └────────────────┘          └──────────────────┘
```

データの流れ:

- **手動入力（スキル経由）**: 新カード追加・次にやること追記・完了アーカイブ・projects/ノート作成
- **自動更新（launchd定期実行）**: branch / last-commit / last-activity / alive

## 3. Obsidian Vault 構成

```
~/Documents/Obsidian/work-dashboard/
├── Dashboard.md              # Kanbanボード本体（起動時の基本画面）
├── projects/
│   ├── <project-name>.md     # プロジェクト別の詳細メモ・履歴
│   └── ...
└── .obsidian/                # Obsidian設定（自動生成）
```

- Dashboard.md は Obsidian Kanban プラグインで表示する
- projects/ 配下のノートはKanbanカードから `[[projects/<name>]]` でリンクする
- スクリプト本体は Vault の外（リポジトリ側）に置くため Vault はデータだけを含む

## 4. Kanban ボード設計

### 4.1 列構成

| 列 | 意味 |
|---|---|
| 🟢 対応中 | Claude Codeが実行中、または自分が手を動かしている |
| 🟡 入力待ち | Claude Codeが自分の返答を待っている |
| 🔴 ブロック中 | 外部依存（レビュー待ち・調査中・疑問点あり）で止まっている |
| ✅ 完了 | 今日クローズした分（翌朝アーカイブ） |

### 4.2 カードテンプレート

```markdown
## <project> / <短いタスク名>

- **tmux:** `work:feat-login` (window #2, pane #1)
- **path:** ~/src/project-a-worktrees/feat-login
- **alive:** <!-- auto -->
- **branch:** <!-- auto -->
- **last-commit:** <!-- auto -->
- **last-activity:** <!-- auto -->

### 次にやること
- [ ] ...

### メモ
- ...

→ [[projects/<project>]]
```

**フィールドの意味:**

| フィールド | 値の例 | 誰が書くか |
|---|---|---|
| `tmux:` | `work:feat-login` (window #2, pane #1) | スキル（カード作成時のみ） |
| `path:` | `~/src/project-a-worktrees/feat-login`（絶対パス、worktreeの場合はworktreeのパス） | スキル（カード作成時のみ） |
| `alive:` | `✅` / `⚠️ pane closed` / `⚠️ window renamed?` / `(tmux外)` | updater（定期） |
| `branch:` | `feature/login` | updater（定期） |
| `last-commit:` | `2 hours ago · Add login form validation` | updater（定期） |
| `last-activity:` | `10 minutes ago` (pathのディレクトリ内ファイル最終更新) | updater（定期） |

### 4.3 自動フィールドのマーカー

updater が書き換えるフィールドは、行末（または値の位置）に `<!-- auto -->` コメントを残す。この行以外は updater が触らない。

**alive の判定:**
- updater は `tmux list-panes -a -F '#S:#W:#I.#P'` を実行して全tmuxセッション横断の生pane一覧を取得
- カードの `tmux:` フィールドから `session + window-name + pane-index` を抽出して照合
- `window-index` は表示のみに使う（tmuxは詰めて振り直すことがあるため判定基準にしない）

| alive | 判定条件 |
|---|---|
| `✅` | 生pane一覧に `session + window-name + pane-index` が一致するものがある |
| `⚠️ window renamed?` | session と pane-index は一致するが window-name が違う |
| `⚠️ pane closed` | 一致するものがない |
| `(tmux外)` | カード作成時にtmux外だったため、tmuxフィールドがこの値 |

## 5. panorama updater (定期スクリプト)

### 5.1 言語

Node.js。Markdown の行単位パースと文字列操作を安全に行うため、シェルではなく Node.js を採用する。

### 5.2 動作

1. `~/.config/panorama/config.yaml` を読み込む
2. `vault_path/dashboard_file` を読み込む
3. Kanban のカードを1つずつ走査し、各カードの `path:` を抽出
4. そのパスで以下を実行:
   - `git rev-parse --abbrev-ref HEAD` → branch
   - `git log -1 --format='%ar · %s'` → last-commit
   - ディレクトリ内ファイルの最終更新時刻（再帰しない。ルート直下のみ） → last-activity
5. `tmux list-panes -a -F '#S:#W:#I.#P'` → 生pane一覧
6. 各カードの `tmux:` フィールドと照合して alive を決定
7. `<!-- auto -->` マーカーの付いたフィールドだけを書き換えて保存

### 5.3 エラー処理

- `path:` が存在しない / gitリポジトリでない → 対応フィールドに `(n/a)` を書き込んで次へ
- tmuxが動いていない → alive は全カード `(tmux外)` のままにする
- スクリプト全体が落ちないよう、try/catch で各カードを独立処理

### 5.4 冪等性

- 何度実行しても結果は同じ
- Obsidian で編集中でも競合しにくい（Obsidian は外部からのファイル変更を検知して再読込する）
- updater は手書き領域（タスク名・次にやること・メモ・列の並び）には一切触れない

### 5.5 トリガ

macOS `launchd` で 180 秒間隔実行。`~/Library/LaunchAgents/com.user.panorama.plist` を配置。

手動実行は `pano update` で可能。

## 6. Claude Code スキル (work-dashboard 操作)

### 6.1 スキル名

`panorama`（配置: `~/.claude/skills/panorama/SKILL.md`）

### 6.2 起動トリガ

SKILL.md の description に以下を含めて自動起動させる:

- 「ダッシュボードに追加」「今の作業を登録」 → A. 新カード追加
- 「次にやること」「申し送り」 → C. 次にやること追記
- 「この作業完了」「アーカイブして」 → D. 完了アーカイブ
- 「プロジェクトノート作って」 → E. projects/ ノート作成

（B. 列移動はスキルに含めない。Obsidian Kanban UI で手動操作する）

### 6.3 各操作の動作

#### A. 新カード追加

1. `pwd` で現在のパスを取得
2. `git rev-parse --abbrev-ref HEAD` でブランチ取得（初期値、以後はupdaterが上書き）
3. tmuxコンテキストを取得:
   ```bash
   tmux display-message -p '#S'   # セッション名
   tmux display-message -p '#W'   # ウィンドウ名
   tmux display-message -p '#I'   # ウィンドウ番号
   tmux display-message -p '#P'   # pane番号
   ```
   tmux外で起動された場合は `(tmux外)` をtmuxフィールドに記録
4. タスク名をユーザに聞く、または直近のClaude Code会話文脈から推論して確認
5. Dashboard.md の 🟢対応中 列に新カードを追加

#### C. 「次にやること」の追記

1. `pwd` で Dashboard.md 内のカードを `path:` フィールド突合で特定
2. 該当カードの「### 次にやること」セクションに追記
3. 内容はユーザに聞くか、会話文脈から推論して確認

#### D. 完了アーカイブ

1. ✅完了列のカード、または `pwd` で特定したカードを対象にする
2. カード内容を `projects/<name>.md` の「## 履歴」セクションに日付付きで追記
3. Dashboard.md から該当カードを削除

#### E. projects/ ノート作成

1. プロジェクト名を引数で受け取る（なければカレントディレクトリ名）
2. `projects/<name>.md` を `templates/project-note.md` をもとに作成

### 6.4 スキルの依存

- スキル自体は Dashboard.md を直接編集する
- 自動フィールド（branch / last-commit / last-activity / alive）はスキルが書き込まず、次の updater 実行で埋まる
- updater が動いていなくてもスキルは動作する

## 7. 運用フロー

### 7.1 新しいタスクを始める

1. ghostty/tmux で新しいpaneを開いてプロジェクトに `cd`
2. Claude Code で「このpaneの作業をダッシュボードに追加して」と依頼
3. スキルがカードを生成、Obsidian 側でKanbanが更新される

### 7.2 paneを離れるとき

1. 「次にやること書き残して」とClaude Codeに依頼、または自分でObsidianで追記
2. 状態が変わっていれば列を手動移動（🟢対応中 → 🟡入力待ち など）

### 7.3 作業に戻るとき

1. Dashboard を開いて全体を眺める
2. 🟡入力待ちの中から優先度の高いものを選ぶ
3. カードの「次にやること」を読んで文脈を復元してからpaneに入る

### 7.4 1日の終わり

- ✅完了 のカードを `pano archive` または スキルでアーカイブ
- `projects/<name>.md` の履歴に追記される

### 7.5 運用のコツ

- カードを増やしすぎない（paneの数 = 8 を上限の目安に）
- 「次にやること」は未来の自分への申し送りなので、思考を止めずに書く
- updater が自動更新する4フィールド (alive / branch / last-commit / last-activity) は手で書かない（上書きされる）

## 8. リポジトリ構成

```
panorama/
├── README.md
├── LICENSE
├── install.sh                    # インストーラー
├── uninstall.sh
├── config.example.yaml           # 設定のひな型
├── bin/
│   └── panorama                  # CLIエントリ
├── src/
│   ├── update.js                 # 定期実行される本体
│   └── lib/
│       ├── parse-dashboard.js
│       ├── git.js
│       └── tmux.js
├── skill/
│   └── SKILL.md                  # Claude Code skill 本体
├── templates/
│   ├── Dashboard.md              # 初期Kanbanボード
│   └── project-note.md           # projects/配下のひな型
├── launchd/
│   └── com.user.panorama.plist.template
└── docs/
    └── design.md                 # この文書
```

## 9. 実行時ファイル配置

リポジトリ（コード）とユーザ設定（データ）を分離する。

| 種類 | パス | 内容 |
|---|---|---|
| リポジトリ本体 | `~/.local/share/panorama`（通常）/ `~/src/panorama`（開発時） | `git clone` 先。読み取り専用扱い |
| 設定ファイル | `~/.config/panorama/config.yaml` | ユーザが編集する唯一の場所 |
| Vault | `config.yaml` の `vault_path` | デフォルト `~/Documents/Obsidian/work-dashboard` |
| Claude Code スキル | `~/.claude/skills/panorama` | リポジトリの `skill/` への symlink |
| CLI | `~/.local/bin/panorama` | リポジトリの `bin/panorama` への symlink |
| launchd plist | `~/Library/LaunchAgents/com.user.panorama.plist` | テンプレから生成 |
| ログ | `~/Library/Logs/panorama.log` | 定期実行の出力 |

**分離の理由:**

- `git pull` で更新するたびに「ローカル変更あり」と警告されない
- 再インストール時にリポジトリを捨てても、ユーザデータは残る
- バックアップ対象を Vault と config.yaml だけに絞れる

## 10. config.yaml

```yaml
# panorama config
vault_path: ~/Documents/Obsidian/work-dashboard
dashboard_file: Dashboard.md
update_interval_seconds: 180

# Dashboardに表示する列（将来拡張用）
columns:
  - active
  - waiting
  - blocked
  - done
```

## 11. install.sh の動作

install.sh は自分自身の場所を基準に動く:

```bash
REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
```

これにより、リポジトリのクローン先がどこであっても（`~/.local/share/panorama` でも `~/src/panorama` でも）同じコマンドで動作する。

1. **依存チェック**: `node`, `git`, `tmux`, `launchctl` の有無を確認。無ければエラーで終了
2. **config読み込み**: `~/.config/panorama/config.yaml` が無ければ `config.example.yaml` からコピーして初期化
3. **Vault初期化**: `vault_path` が無ければ作成し、`templates/Dashboard.md` を配置（既存ならスキップ）
4. **スキル設置**: `~/.claude/skills/panorama` → `$REPO_DIR/skill` の symlink
5. **CLI設置**: `~/.local/bin/panorama` → `$REPO_DIR/bin/panorama` の symlink
6. **launchd登録**: `launchd/com.user.panorama.plist.template` の `{{INTERVAL}}` / `{{REPO_DIR}}` を置換し、`~/Library/LaunchAgents/` に配置 → `launchctl load`
7. **初回更新**: `pano update` を1回実行してDashboardの自動フィールドを埋める

### 11.1 uninstall.sh

- launchctl unload → plist 削除
- symlink 削除
- リポジトリ本体 (`~/.local/share/panorama`) は削除しない（ユーザが手動で）
- **Vault と `config.yaml` には触れない**（ユーザデータのため）

## 12. pano CLI のサブコマンド

初期リリースは最小セットに絞る:

| サブコマンド | 動作 |
|---|---|
| `pano update` | Dashboard.md の自動フィールドを更新 |
| `pano doctor` | 依存 / symlink / launchd / Vault / config.yaml の状態を点検 |

将来追加候補（YAGNI、必要になってから）:
- `pano add` — 現在のpaneから新カードを追加（シェルから呼び出す場合）
- `pano archive` — 完了列のカードをアーカイブ
- `pano logs` — launchd ログ表示
- `pano reload` — launchd 再読み込み

## 13. 配布と開発

### 13.1 公開リポジトリ

- GitHub: `https://github.com/tango238/panorama`
- 通常ユーザの手順は README に記載

### 13.2 通常インストール手順（README抜粋）

```bash
git clone https://github.com/tango238/panorama.git ~/.local/share/panorama
mkdir -p ~/.config/panorama
cp ~/.local/share/panorama/config.example.yaml ~/.config/panorama/config.yaml
$EDITOR ~/.config/panorama/config.yaml
~/.local/share/panorama/install.sh
pano doctor
```

### 13.3 ローカル開発手順

```bash
git clone https://github.com/tango238/panorama.git ~/src/panorama
cd ~/src/panorama
./install.sh
# 以降、src/ や skill/ を編集すれば launchd の次回実行時に反映される
```

開発中は `install.sh` を1回だけ走らせれば、以降は編集→保存で反映される（symlink 経由のため）。

## 14. スコープ外（今回は作らない）

- 列移動の自動化（Obsidian Kanban の UI で手動で行う）
- Claude Code の会話状態（「入力待ち」など）の自動検出
- Windows / Linux 対応（macOS launchd 前提）
- 複数Vaultの切り替え
- Web UI / リモートダッシュボード

## 15. 成功基準

- 8pane並列で作業していても、Dashboard を開けば識別・進捗・状態・再開文脈の4つが一目で把握できる
- スキル経由でカード作成・追記・アーカイブが1会話で完了する
- updater が3分以内に状態を反映する
- install.sh が新しいマシンでも1コマンドで動く
