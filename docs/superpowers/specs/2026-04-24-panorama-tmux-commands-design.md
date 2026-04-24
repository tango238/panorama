# panorama tmux サブコマンド設計

**日付**: 2026-04-24
**スコープ**: 既存 `bin/panorama` CLI に `create` / `attach` サブコマンドを追加する

## 背景

`panorama` は tmux / ghostty の複数 pane で並列作業する開発フローを Obsidian Kanban で可視化するツール。現在の `bin/panorama` (Node.js) は `update` / `doctor` の 2 サブコマンドを持つ。symlink で `~/.local/bin/panorama` にインストールされているため、`npm install -g` は不要。

このスペックは、tmux セッションの作成と attach を panorama CLI から直接行えるようにする機能追加を定義する。

## 目的

- 新しい作業を始めるときに `panorama create <session-name>` で tmux セッションを作成・attach したい
- セッションを切り替えるとき `panorama attach` で対話的にセッション一覧から選びたい
- セッション名を覚えているときは `panorama attach <session-name>` で直接 attach したい

## 非目的

- Dashboard.md への書き込み（それは既存の `/panorama new` スキルが担当）
- tmux 設定ファイルの生成・変更
- セッションの削除・リネーム（`tmux kill-session` などは直接使えば十分）
- 複数ウィンドウ・pane の事前作成

## 採用案

既存 Node.js `bin/panorama` にサブコマンドとして追加する。

**理由**:
- 既に symlink 方式でインストール済みのため、ファイル編集だけで即反映
- ユーザーは絶対パスを意識せず `panorama create` / `panorama attach` と打てる
- 既存の `update` / `doctor` と同じディスパッチャに相乗り
- Node.js 標準 `readline` + ANSI エスケープで対話ピッカーを実装できるため追加依存なし

## コマンド仕様

### `panorama create <session-name> [--task <name>]`

**引数**:
- `<session-name>` (必須): 作成する tmux セッション名
- `--task <name>` (任意): セッション内の最初のウィンドウ名。省略時はセッション名を使用

**動作**:
1. `<session-name>` が空文字・未指定ならエラー終了 (exit code 2)
2. `tmux has-session -t <session-name>` で既存チェック
   - 既に存在する場合、`panorama attach <session-name>` を案内してエラー終了 (exit code 1)
3. カレントディレクトリを作業ディレクトリとして detached で新規セッション起動:
   `tmux new-session -d -s <session-name> -c "$(pwd)"`
4. ウィンドウ名を設定:
   `tmux rename-window -t <session-name> <window-name>`
   （`window-name` は `--task` 値、無ければ `<session-name>`）
5. attach または switch-client:
   - 環境変数 `$TMUX` 未設定 (tmux 外) → `tmux attach -t <session-name>` を `spawnSync` で stdio: 'inherit' 実行、終了後に同じ exit code で自身も終了
   - `$TMUX` 設定済み (tmux 内) → `tmux switch-client -t <session-name>` (即座に制御が tmux に移る)
6. tmux コマンドが見つからない場合は「tmux not found」でエラー終了 (exit code 1)

### `panorama attach [<session-name>]`

**引数**:
- `<session-name>` (任意): attach 先 tmux セッション名

**引数ありの動作**:
1. `tmux has-session -t <session-name>` で存在確認
   - 存在しなければ「session not found」でエラー終了 (exit code 1)
2. attach または switch-client (`create` と同じロジック)

**引数なし (対話ピッカー) の動作**:
1. `tmux list-sessions -F '#{session_name}\t#{session_windows}\t#{?session_attached,1,0}'` でセッション一覧取得
2. セッション 0 件なら「No tmux sessions」と出力してエラー終了 (exit code 1)
3. 非 TTY (stdin/stdout がパイプ等) なら「not a tty, specify session name」でエラー終了 (exit code 2)
4. ターミナルを raw mode + alternate screen に切り替えてピッカー描画:
   ```
   Select tmux session (↑/↓ to move, Enter to select, q to quit):

   > main          3 windows  (attached)
     feature-xyz   1 window
     review        2 windows
   ```
5. キー入力処理:
   - ↑ (`\x1b[A`) / `k`: カーソル上
   - ↓ (`\x1b[B`) / `j`: カーソル下
   - `Enter` (`\r` または `\n`): 選択確定
   - `q` / `Esc` (`\x1b`) / `Ctrl-C` (`\x03`): キャンセル終了 (exit code 130 for Ctrl-C, 0 for q/Esc)
6. 終了処理 (正常・異常・シグナル全て): alternate screen 解除、raw mode 復元。`process.on('exit')` と `process.on('SIGINT')` / `SIGTERM` で確実に実行
7. 選択確定したら attach/switch-client

## ファイル構成

```
bin/panorama                # ディスパッチャ拡張 (create/attach 追加)
src/commands/
  create.js                 # panorama create 本体
  attach.js                 # panorama attach 本体 (ピッカー制御込み)
src/lib/
  tmux.js                   # tmux 呼び出しラッパー
  picker.js                 # 汎用対話ピッカー (readline + ANSI)
tests/
  tmux.test.js
  picker.test.js
  create.test.js
  attach.test.js
```

### `src/lib/tmux.js` (インターフェース)

```js
export function isTmuxAvailable()          // boolean
export function hasSession(name)           // boolean
export function listSessions()             // [{name, windows, attached}]
export function createSession(name, cwd)   // void, throws on error
export function renameWindow(session, name) // void
export function attachOrSwitch(name)       // spawns tmux, returns child exit code; caller should process.exit with it
export function isInsideTmux()             // boolean (== !!process.env.TMUX)
```

実装は `child_process.execFileSync` / `spawnSync` を使い、stderr を握りつぶさずエラー時に throw する。

### `src/lib/picker.js` (インターフェース)

```js
/**
 * @param {object} opts
 * @param {string[]} opts.items         表示項目 (事前整形済み文字列)
 * @param {string}   opts.header        ヘッダメッセージ
 * @param {number}   [opts.initialIndex=0]
 * @returns {Promise<number|null>}      選択された index、キャンセル時は null
 */
export function pick({items, header, initialIndex})
```

- readline を使わず、`process.stdin.setRawMode(true)` で生キー入力を受ける
- `process.stdout.write` で ANSI エスケープ（alternate screen `\x1b[?1049h`、カーソル移動 `\x1b[H`、クリア `\x1b[2J` 等）を発行
- 終了時クリーンアップを `finally` と `process.on('exit')` の両方で保証

### `bin/panorama` への変更

```js
// 既存 switch に以下を追加
case 'create':
  await cmdCreate(rest);
  break;
case 'attach':
  await cmdAttach(rest);
  break;
```

`parseArgs` は `create` / `attach` の引数パターンに対応するよう拡張。

## エラーハンドリング

| ケース | exit code | 挙動 |
|---|---|---|
| `create` でセッション名未指定 | 2 | usage 表示 |
| `create` でセッション既存 | 1 | 「session already exists, use `panorama attach`」 |
| `attach <name>` でセッション不在 | 1 | 「session 'X' not found」 |
| ピッカーで該当セッション 0 件 | 1 | 「No tmux sessions」 |
| ピッカー呼び出しが非 TTY | 2 | 「not a tty, specify session name」 |
| tmux コマンド不在 | 1 | 「tmux not found」 |
| ピッカー中 Ctrl-C | 130 | raw mode 復元してから SIGINT 相当 |
| ピッカー中 q/Esc | 0 | 正常キャンセル |

## テスト戦略

**単体テスト** (Node.js 標準 `node --test`):

- `tmux.test.js`: `child_process` をモックして各ラッパー関数の分岐テスト
  - `hasSession` の存在/不在
  - `listSessions` のパース (空出力・複数セッション・attached/detached)
  - `createSession` の引数組み立て
  - `isInsideTmux` の環境変数判定
- `picker.test.js`: stdin を差し替え、キー入力シーケンスで矢印キー処理を検証
  - 初期描画、↑/↓移動、Enter 確定、q キャンセル、範囲外移動がクランプされる
- `create.test.js` / `attach.test.js`: `tmux.js` を差し替えて分岐テスト
  - create: セッション既存時のエラー、正常作成後の attach 呼び出し
  - attach: 引数あり/なし、セッション不在、ピッカーキャンセル

**スコープ外**:
- 実際の tmux コマンドを使った E2E (テスト環境に tmux を立てるのは重い)
- ターミナル描画の視覚的検証

## インストールへの影響

- `install.sh` に変更は不要 (symlink なのでファイル編集だけで反映)
- `package.json` の `bin` エントリはそのまま
- launchd plist に影響なし (launchd は `panorama update` しか呼ばない)

## マイグレーション

新機能追加のみで破壊的変更なし。既存ユーザーは `git pull` するだけで `create` / `attach` が使えるようになる。
