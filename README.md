# panorama

tmux / ghostty で 8 pane 並列作業をしていると、「どれが何の作業中か」「どこまで進んだか」「入力待ちか実行中か」「次に戻ってきたとき何をやる予定だったか」を見失いがちになる。

panorama は、これら 4 つの情報を **Obsidian Kanban ボード** に集約し、`git` / `tmux` の状態を定期的に自動で反映する macOS 向けの小さな道具です。

- **Node.js updater** が 180 秒ごとに `branch` / `last-commit` / `last-activity` / `alive` を書き換える
- **Claude Code スキル** が「ダッシュボードに追加」「次にやること書き残して」「この作業完了」の 1 会話でカード操作を行う
- **launchd** が updater を定期実行する

要件: macOS、Node.js 18 以上、`git`、`tmux`、Obsidian（Kanban プラグイン有効）。

## インストール

```bash
git clone https://github.com/tango238/panorama.git ~/.local/share/panorama
~/.local/share/panorama/install.sh
panorama doctor
```

インストーラは以下を行います:

1. `node` / `git` / `tmux` / `launchctl` の存在確認
2. `~/.config/panorama/config.yaml` を初期化（無ければ `config.example.yaml` からコピー）
3. Vault (`~/Documents/Obsidian/work-dashboard` デフォルト) を初期化し `Dashboard.md` を配置
4. `~/.claude/skills/panorama` → リポジトリの `skill/` へ symlink
5. `~/.local/bin/panorama` → `bin/panorama` へ symlink
6. `~/Library/LaunchAgents/com.user.panorama.plist` を生成して `launchctl load`
7. 初回 `panorama update` を実行

## 使い方

### 新しいタスクを登録する

ghostty/tmux で新しい pane を開きプロジェクトディレクトリに `cd` してから、Claude Code で:

> このpaneの作業をダッシュボードに追加して

スキルがカードを生成、180 秒以内に `branch` / `last-commit` / `last-activity` / `alive` が自動で埋まります。

### pane を離れるとき

> 次にやること書き残しておいて

### 1 日の終わり

Obsidian の Kanban UI で完了カードを ✅ 列に移動し、Claude Code で:

> この作業完了、アーカイブして

## 運用のコツ

- カードは pane 数 (8) を上限の目安に増やしすぎない
- `<!-- auto -->` が付いた行は手で書かない（次回 updater に上書きされる）
- 状態遷移 (🟢 ⇄ 🟡 ⇄ 🔴) は Obsidian Kanban UI で手動移動する

## 開発

```bash
git clone https://github.com/tango238/panorama.git ~/src/panorama
cd ~/src/panorama
./install.sh
npm test
```

以降、`src/` や `skill/` を編集すれば launchd の次回実行時に反映されます（symlink のため）。

## アンインストール

```bash
~/.local/share/panorama/uninstall.sh
```

launchd プロセス停止と symlink / plist の削除のみで、Vault と `~/.config/panorama/config.yaml` は残します。

## ライセンス

MIT
