# panorama

tmux / ghostty で複数の pane を開いて並列作業していると、こんなことありませんか?

- 「この pane、何の作業してたっけ?」
- 「どこまで進んだんだっけ?」
- 「あっちの pane、入力待ちだったかも...」
- 「次にやろうとしてたこと、忘れた!」

**panorama** は、これらの情報を [Obsidian](https://obsidian.md/) の Kanban ボードにまとめて見える化する **macOS 専用** の小さなツールです。git や tmux の状態を自動で拾ってきて、ダッシュボードを勝手に更新してくれます。

> **Note:** panorama は macOS 専用です。バックグラウンド実行に launchd を使用しているため、Linux / Windows では動作しません。

### しくみ

panorama は 3 つのパーツで動いています。

| パーツ | 役割 |
|---|---|
| **Node.js updater** | 180 秒ごとに `branch` / `last-commit` / `last-activity` / `alive` を自動更新 |
| **Claude Code スキル** | 「ダッシュボードに追加して」のように話しかけるだけでカード操作 |
| **launchd** | updater をバックグラウンドで定期実行 |

---

## インストール

### 必要なもの

以下のツールを事前にインストールしてください。

| ツール | 用途 | インストール |
|---|---|---|
| [Node.js](https://nodejs.org/) (v18 以上) | updater の実行 | [ダウンロード](https://nodejs.org/en/download) |
| [Git](https://git-scm.com/) | ブランチ・コミット情報の取得 | [ダウンロード](https://git-scm.com/downloads) |
| [tmux](https://github.com/tmux/tmux) | pane の状態取得 | `brew install tmux` |
| [Obsidian](https://obsidian.md/) | Kanban ダッシュボードの表示 | [ダウンロード](https://obsidian.md/download) |

Obsidian には [Kanban プラグイン](https://github.com/mgmeyers/obsidian-kanban) を入れて有効にしておいてください。

### セットアップ (3 ステップ)

```bash
# 1. リポジトリをクローン
git clone https://github.com/tango238/panorama.git ~/.local/share/panorama

# 2. インストーラを実行
~/.local/share/panorama/install.sh

# 3. 正しくインストールできたか確認
panorama doctor
```

これだけで完了です! インストーラが以下をすべて自動でやってくれます。

- 依存ツール (`node` / `git` / `tmux` / `launchctl`) の存在チェック
- 設定ファイルの初期化 (`~/.config/panorama/config.yaml`)
- Obsidian Vault に `Dashboard.md` を配置
- Claude Code スキルと CLI コマンドの symlink 作成
- launchd への登録と初回更新の実行

---

## クイックガイド

インストールが終わったら、すぐに使い始められます。

### 1. 作業を登録する

tmux の pane でプロジェクトディレクトリに移動して、Claude Code に話しかけます。

> このpaneの作業をダッシュボードに追加して

すると Obsidian の Kanban ボードにカードが作られます。180 秒以内にブランチ名やコミット情報が自動で反映されます。

### 2. 離席前にメモを残す

pane を離れるときは一言伝えておきましょう。

> 次にやること書き残しておいて

カードの「次にやること」セクションにメモが残り、戻ってきたときにすぐ思い出せます。

### 3. 作業完了!

タスクが終わったら、Obsidian の Kanban で完了カードを ✅ 列に移動してから:

> この作業完了、アーカイブして

カードがプロジェクトノートに履歴として保存され、ダッシュボードがすっきりします。

---

## 基本的な使い方

### ダッシュボードの見方

Obsidian で `Dashboard.md` を開くと、Kanban ボードとして表示されます。列は 4 つあります。

| 列 | 意味 |
|---|---|
| 🟢 **対応中** | いま取り組んでいる作業 |
| 🟡 **入力待ち** | 自分の入力やレビューを待っている作業 |
| 🔴 **ブロック中** | 外部要因で止まっている作業 |
| ✅ **完了** | 終わった作業 |

カードの列間の移動は、Obsidian の Kanban UI でドラッグ & ドロップするだけです。

### カードに自動で入る情報

各カードには以下の情報が 180 秒ごとに自動更新されます。手で書き換える必要はありません。

| フィールド | 内容 |
|---|---|
| `alive` | pane がまだ生きているか (✅ / ⚠️) |
| `branch` | 現在の git ブランチ |
| `last-commit` | 最新コミットの情報 (例: `2h ago · fix login form`) |
| `last-activity` | ファイルの最終更新時刻 |

### CLI コマンド

```bash
panorama update            # ダッシュボードを手動で更新
panorama update --config PATH  # 設定ファイルを指定して更新
panorama doctor            # インストール状態のチェック
panorama init              # ghostty ウィンドウを 2×4 grid に分割 (macOS/ghostty 専用)
panorama create <name>     # 新しい tmux セッションを作成して attach
panorama create <name> --task <task-name>  # ウィンドウ名を指定
panorama attach            # tmux セッション一覧から対話選択して attach
panorama attach <name>     # 指定セッションに直接 attach
```

---

## 便利な使い方

### プロジェクトノートを作る

プロジェクトごとにノートを作っておくと、完了した作業の履歴がそこに蓄積されていきます。

> プロジェクトノート作って

`projects/` フォルダに概要・リンク・履歴セクションを持つノートが作成されます。

### 設定をカスタマイズする

`~/.config/panorama/config.yaml` を編集すると、各種設定を変更できます。

```yaml
# Obsidian Vault のパス
vault_path: ~/Documents/Obsidian/work-dashboard

# ダッシュボードのファイル名
dashboard_file: Dashboard.md

# 自動更新の間隔(秒)
update_interval_seconds: 180
```

### 運用のコツ

- **カードは増やしすぎない** — pane の数 (8 程度) を目安にしましょう
- **`<!-- auto -->` 行は触らない** — 次回の自動更新で上書きされます
- **列の移動は Obsidian で** — 🟢 ⇄ 🟡 ⇄ 🔴 の状態遷移は Kanban UI のドラッグ & ドロップで

---

## 開発

```bash
git clone https://github.com/tango238/panorama.git ~/src/panorama
cd ~/src/panorama
./install.sh
npm test
```

symlink でインストールされるので、`src/` や `skill/` を編集すれば次回の launchd 実行時にそのまま反映されます。

## アンインストール

```bash
~/.local/share/panorama/uninstall.sh
```

launchd の停止と symlink / plist の削除を行います。Vault のデータと設定ファイル (`~/.config/panorama/config.yaml`) はそのまま残るので安心です。

## ライセンス

MIT
