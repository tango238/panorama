# panorama Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 8-pane tmux/ghostty 並列作業の識別・進捗・状態・再開文脈を Obsidian Kanban に集約する panorama ツール（Node.js updater + Claude Code skill + launchd）を実装する。

**Architecture:** Node.js (Zero 依存、ESM、`node:test` + `node:assert`) で Markdown Kanban を解析し `<!-- auto -->` マーカー付きフィールドだけを書き換える updater を中心に据える。CLI は `bin/panorama`、定期実行は macOS launchd、カード作成・追記・アーカイブは Claude Code Skill（Markdown 指示書）。install.sh が Vault 初期化・symlink・launchd 登録を一括で行う。

**Tech Stack:** Node.js 18+（`node:test`, `node:assert`, `child_process.execFileSync`, `fs/promises`）、bash（install.sh / uninstall.sh）、macOS launchd、Obsidian + Kanban プラグイン（利用側）。

**Spec:** `docs/design.md`

---

## File Structure

すべての Node.js モジュールは ESM（`"type": "module"`、`.js` 拡張子）。各モジュールは 1 つの責務のみ持つ。

| ファイル | 責務 |
|---|---|
| `package.json` | `name`, `version`, `type: module`, `bin`, `scripts.test` |
| `.gitignore` | `node_modules/`, `.DS_Store` |
| `src/lib/config.js` | `config.yaml` の最小パーサ（我々のスキーマ専用、外部依存なし） |
| `src/lib/parse-dashboard.js` | Dashboard.md を「カード単位」に分割し、`tmux:` / `path:` / `<!-- auto -->` 行を抽出/置換 |
| `src/lib/git.js` | `getBranch(cwd)`, `getLastCommit(cwd)` — `execFileSync` 経由 |
| `src/lib/fs-activity.js` | `getLastActivity(cwd)` — ディレクトリ直下ファイルの最終 mtime を人間可読な相対時刻で返す |
| `src/lib/tmux.js` | `listPanes()`, `classifyAlive(tmuxField, panes)` |
| `src/lib/relative-time.js` | `formatRelative(date)` — `"10 minutes ago"` 等を生成 |
| `src/update.js` | 全モジュールを繋ぐオーケストレータ。`main(configPath)` を export |
| `bin/panorama` | `pano update` / `pano doctor` の CLI ディスパッチャ（shebang: `#!/usr/bin/env node`） |
| `templates/Dashboard.md` | 初期 Kanban ボード（列ヘッダのみ） |
| `templates/project-note.md` | `projects/<name>.md` のひな型 |
| `launchd/com.user.panorama.plist.template` | `{{INTERVAL}}` / `{{REPO_DIR}}` / `{{LOG_PATH}}` をプレースホルダに持つ plist |
| `skill/SKILL.md` | Claude Code スキル（カード作成・追記・アーカイブ・projects ノート作成の指示書） |
| `config.example.yaml` | 初期 config.yaml のひな型 |
| `install.sh` | 依存チェック → config 初期化 → Vault 初期化 → symlink → launchd 登録 → 初回 update |
| `uninstall.sh` | launchd unload → plist / symlink 削除（Vault/config は残す） |
| `README.md` | インストール手順と運用メモ |
| `tests/*.test.js` | 各モジュールのユニットテスト（`node --test`） |

**テスト方針:** ロジックを含む Node モジュールはすべて `node:test` でテスト。Git / tmux を呼ぶモジュールは temp dir に本物の git リポジトリを作ってテスト（mock しない）。シェルスクリプトは bash の `set -euo pipefail` と `panorama doctor` の結合テストで検証する。

---

## Task 1: リポジトリの骨組みと package.json

**Files:**
- Create: `/Users/gotanaka/tmp/panorama/package.json`
- Create: `/Users/gotanaka/tmp/panorama/.gitignore`
- Create: `/Users/gotanaka/tmp/panorama/src/lib/.gitkeep`
- Create: `/Users/gotanaka/tmp/panorama/tests/.gitkeep`
- Create: `/Users/gotanaka/tmp/panorama/bin/.gitkeep`
- Create: `/Users/gotanaka/tmp/panorama/templates/.gitkeep`
- Create: `/Users/gotanaka/tmp/panorama/skill/.gitkeep`
- Create: `/Users/gotanaka/tmp/panorama/launchd/.gitkeep`

- [ ] **Step 1: package.json を作成**

```json
{
  "name": "panorama",
  "version": "0.1.0",
  "description": "Obsidian Kanban dashboard for parallel tmux/ghostty panes",
  "type": "module",
  "bin": {
    "panorama": "./bin/panorama"
  },
  "scripts": {
    "test": "node --test tests/"
  },
  "engines": {
    "node": ">=18"
  },
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/tango238/panorama.git"
  }
}
```

- [ ] **Step 2: .gitignore を作成**

```
node_modules/
.DS_Store
*.log
```

- [ ] **Step 3: 空ディレクトリに .gitkeep を配置**

```bash
cd /Users/gotanaka/tmp/panorama
mkdir -p src/lib tests bin templates skill launchd
touch src/lib/.gitkeep tests/.gitkeep bin/.gitkeep templates/.gitkeep skill/.gitkeep launchd/.gitkeep
```

- [ ] **Step 4: 動作確認**

```bash
cd /Users/gotanaka/tmp/panorama && node --test tests/ 2>&1 | head -5
```
Expected: `# tests 0 / # pass 0 / # fail 0`（テスト 0 件で正常終了）

- [ ] **Step 5: コミット**

```bash
cd /Users/gotanaka/tmp/panorama
git add package.json .gitignore src/ tests/ bin/ templates/ skill/ launchd/
git commit -m "chore: scaffold repository structure"
```

---

## Task 2: config.js — 最小 YAML パーサ

`config.yaml` のスキーマは極めて限定的（`key: value` と `columns: [list]` のみ）。外部依存を避けるため専用パーサを書く。

**Files:**
- Create: `/Users/gotanaka/tmp/panorama/src/lib/config.js`
- Create: `/Users/gotanaka/tmp/panorama/tests/config.test.js`

- [ ] **Step 1: 失敗するテストを書く**

```javascript
// tests/config.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { parseConfig, loadConfig } from '../src/lib/config.js';

test('parseConfig: scalar values', () => {
  const text = `
vault_path: ~/Documents/Obsidian/work-dashboard
dashboard_file: Dashboard.md
update_interval_seconds: 180
`;
  const cfg = parseConfig(text);
  assert.equal(cfg.vault_path, join(homedir(), 'Documents/Obsidian/work-dashboard'));
  assert.equal(cfg.dashboard_file, 'Dashboard.md');
  assert.equal(cfg.update_interval_seconds, 180);
});

test('parseConfig: list values', () => {
  const text = `
columns:
  - active
  - waiting
  - blocked
  - done
`;
  const cfg = parseConfig(text);
  assert.deepEqual(cfg.columns, ['active', 'waiting', 'blocked', 'done']);
});

test('parseConfig: ignores comments and blanks', () => {
  const text = `
# panorama config
vault_path: /tmp/vault

# interval
update_interval_seconds: 60
`;
  const cfg = parseConfig(text);
  assert.equal(cfg.vault_path, '/tmp/vault');
  assert.equal(cfg.update_interval_seconds, 60);
});

test('loadConfig: reads file from disk', () => {
  const dir = mkdtempSync(join(tmpdir(), 'panorama-cfg-'));
  const path = join(dir, 'config.yaml');
  writeFileSync(path, 'vault_path: /tmp/x\ndashboard_file: D.md\nupdate_interval_seconds: 30\n');
  const cfg = loadConfig(path);
  assert.equal(cfg.vault_path, '/tmp/x');
  assert.equal(cfg.dashboard_file, 'D.md');
  assert.equal(cfg.update_interval_seconds, 30);
});
```

- [ ] **Step 2: テストが失敗することを確認**

```bash
cd /Users/gotanaka/tmp/panorama && node --test tests/config.test.js 2>&1 | tail -20
```
Expected: FAIL（`Cannot find module '../src/lib/config.js'`）

- [ ] **Step 3: config.js を実装**

```javascript
// src/lib/config.js
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

function expandHome(value) {
  if (typeof value !== 'string') return value;
  if (value === '~') return homedir();
  if (value.startsWith('~/')) return join(homedir(), value.slice(2));
  return value;
}

function coerce(raw) {
  const trimmed = raw.trim();
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
  return expandHome(trimmed);
}

export function parseConfig(text) {
  const result = {};
  const lines = text.split(/\r?\n/);
  let currentListKey = null;

  for (const line of lines) {
    if (line.trim() === '' || line.trim().startsWith('#')) {
      continue;
    }
    const listItem = line.match(/^\s+-\s+(.+)$/);
    if (listItem && currentListKey) {
      result[currentListKey].push(coerce(listItem[1]));
      continue;
    }
    const kv = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
    if (kv) {
      const key = kv[1];
      const value = kv[2];
      if (value === '') {
        result[key] = [];
        currentListKey = key;
      } else {
        result[key] = coerce(value);
        currentListKey = null;
      }
    }
  }
  return result;
}

export function loadConfig(path) {
  return parseConfig(readFileSync(path, 'utf8'));
}
```

- [ ] **Step 4: テストが通ることを確認**

```bash
cd /Users/gotanaka/tmp/panorama && node --test tests/config.test.js 2>&1 | tail -10
```
Expected: `# pass 4 / # fail 0`

- [ ] **Step 5: コミット**

```bash
cd /Users/gotanaka/tmp/panorama
git add src/lib/config.js tests/config.test.js
git commit -m "feat(config): minimal YAML parser for panorama config"
```

---

## Task 3: relative-time.js — 相対時刻フォーマッタ

last-commit / last-activity の両方で使うヘルパ。

**Files:**
- Create: `/Users/gotanaka/tmp/panorama/src/lib/relative-time.js`
- Create: `/Users/gotanaka/tmp/panorama/tests/relative-time.test.js`

- [ ] **Step 1: 失敗するテストを書く**

```javascript
// tests/relative-time.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatRelative } from '../src/lib/relative-time.js';

test('formatRelative: just now', () => {
  const now = new Date('2026-04-11T10:00:00Z');
  const d = new Date('2026-04-11T09:59:30Z');
  assert.equal(formatRelative(d, now), 'just now');
});

test('formatRelative: minutes ago', () => {
  const now = new Date('2026-04-11T10:00:00Z');
  const d = new Date('2026-04-11T09:50:00Z');
  assert.equal(formatRelative(d, now), '10 minutes ago');
});

test('formatRelative: 1 minute ago (singular)', () => {
  const now = new Date('2026-04-11T10:00:00Z');
  const d = new Date('2026-04-11T09:59:00Z');
  assert.equal(formatRelative(d, now), '1 minute ago');
});

test('formatRelative: hours ago', () => {
  const now = new Date('2026-04-11T10:00:00Z');
  const d = new Date('2026-04-11T08:00:00Z');
  assert.equal(formatRelative(d, now), '2 hours ago');
});

test('formatRelative: days ago', () => {
  const now = new Date('2026-04-11T10:00:00Z');
  const d = new Date('2026-04-08T10:00:00Z');
  assert.equal(formatRelative(d, now), '3 days ago');
});
```

- [ ] **Step 2: テストが失敗することを確認**

```bash
cd /Users/gotanaka/tmp/panorama && node --test tests/relative-time.test.js 2>&1 | tail -10
```
Expected: FAIL（モジュールが存在しない）

- [ ] **Step 3: relative-time.js を実装**

```javascript
// src/lib/relative-time.js
export function formatRelative(date, now = new Date()) {
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} ${diffMin === 1 ? 'minute' : 'minutes'} ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} ${diffHour === 1 ? 'hour' : 'hours'} ago`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay} ${diffDay === 1 ? 'day' : 'days'} ago`;
}
```

- [ ] **Step 4: テストが通ることを確認**

```bash
cd /Users/gotanaka/tmp/panorama && node --test tests/relative-time.test.js 2>&1 | tail -10
```
Expected: `# pass 5 / # fail 0`

- [ ] **Step 5: コミット**

```bash
cd /Users/gotanaka/tmp/panorama
git add src/lib/relative-time.js tests/relative-time.test.js
git commit -m "feat(relative-time): add human-readable duration formatter"
```

---

## Task 4: git.js — branch と last-commit の取得

**Files:**
- Create: `/Users/gotanaka/tmp/panorama/src/lib/git.js`
- Create: `/Users/gotanaka/tmp/panorama/tests/git.test.js`

- [ ] **Step 1: 失敗するテストを書く**

```javascript
// tests/git.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { getBranch, getLastCommit } from '../src/lib/git.js';

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'panorama-git-'));
  const run = (cmd, args) => execFileSync(cmd, args, { cwd: dir, stdio: 'pipe' });
  run('git', ['init', '-q', '-b', 'main']);
  run('git', ['config', 'user.email', 'test@example.com']);
  run('git', ['config', 'user.name', 'Test']);
  run('git', ['config', 'commit.gpgsign', 'false']);
  writeFileSync(join(dir, 'a.txt'), 'hello');
  run('git', ['add', 'a.txt']);
  run('git', ['commit', '-q', '-m', 'first commit']);
  return dir;
}

test('getBranch: returns current branch', () => {
  const dir = makeRepo();
  assert.equal(getBranch(dir), 'main');
});

test('getLastCommit: returns "<relative> · <subject>"', () => {
  const dir = makeRepo();
  const result = getLastCommit(dir);
  assert.match(result, / · first commit$/);
  assert.match(result, /ago|second|minute|hour|now/);
});

test('getBranch: returns null for non-git dir', () => {
  const dir = mkdtempSync(join(tmpdir(), 'panorama-nogit-'));
  assert.equal(getBranch(dir), null);
});

test('getLastCommit: returns null for non-git dir', () => {
  const dir = mkdtempSync(join(tmpdir(), 'panorama-nogit-'));
  assert.equal(getLastCommit(dir), null);
});
```

- [ ] **Step 2: テストが失敗することを確認**

```bash
cd /Users/gotanaka/tmp/panorama && node --test tests/git.test.js 2>&1 | tail -10
```
Expected: FAIL（モジュールが存在しない）

- [ ] **Step 3: git.js を実装**

```javascript
// src/lib/git.js
import { execFileSync } from 'node:child_process';

function runGit(cwd, args) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

export function getBranch(cwd) {
  return runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
}

export function getLastCommit(cwd) {
  return runGit(cwd, ['log', '-1', '--format=%ar · %s']);
}
```

- [ ] **Step 4: テストが通ることを確認**

```bash
cd /Users/gotanaka/tmp/panorama && node --test tests/git.test.js 2>&1 | tail -10
```
Expected: `# pass 4 / # fail 0`

- [ ] **Step 5: コミット**

```bash
cd /Users/gotanaka/tmp/panorama
git add src/lib/git.js tests/git.test.js
git commit -m "feat(git): add branch and last-commit getters"
```

---

## Task 5: fs-activity.js — ディレクトリ最終活動時刻

**Files:**
- Create: `/Users/gotanaka/tmp/panorama/src/lib/fs-activity.js`
- Create: `/Users/gotanaka/tmp/panorama/tests/fs-activity.test.js`

- [ ] **Step 1: 失敗するテストを書く**

```javascript
// tests/fs-activity.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, utimesSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getLastActivity } from '../src/lib/fs-activity.js';

test('getLastActivity: returns most recent mtime among top-level files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'panorama-fs-'));
  const oldTime = new Date('2026-04-01T00:00:00Z');
  const newTime = new Date('2026-04-11T09:00:00Z');
  writeFileSync(join(dir, 'a.txt'), 'a');
  writeFileSync(join(dir, 'b.txt'), 'b');
  utimesSync(join(dir, 'a.txt'), oldTime, oldTime);
  utimesSync(join(dir, 'b.txt'), newTime, newTime);

  const result = getLastActivity(dir);
  assert.equal(result.getTime(), newTime.getTime());
});

test('getLastActivity: ignores subdirectories (non-recursive)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'panorama-fs-'));
  const oldTime = new Date('2026-04-01T00:00:00Z');
  const newTime = new Date('2026-04-11T09:00:00Z');
  writeFileSync(join(dir, 'a.txt'), 'a');
  utimesSync(join(dir, 'a.txt'), oldTime, oldTime);
  mkdirSync(join(dir, 'sub'));
  writeFileSync(join(dir, 'sub', 'b.txt'), 'b');
  utimesSync(join(dir, 'sub', 'b.txt'), newTime, newTime);

  const result = getLastActivity(dir);
  assert.equal(result.getTime(), oldTime.getTime());
});

test('getLastActivity: returns null for empty dir', () => {
  const dir = mkdtempSync(join(tmpdir(), 'panorama-fs-'));
  assert.equal(getLastActivity(dir), null);
});

test('getLastActivity: returns null for non-existent dir', () => {
  assert.equal(getLastActivity('/nonexistent/panorama-xyz'), null);
});
```

- [ ] **Step 2: テストが失敗することを確認**

```bash
cd /Users/gotanaka/tmp/panorama && node --test tests/fs-activity.test.js 2>&1 | tail -10
```
Expected: FAIL

- [ ] **Step 3: fs-activity.js を実装**

```javascript
// src/lib/fs-activity.js
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export function getLastActivity(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  let latest = null;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    try {
      const stat = statSync(join(dir, entry.name));
      if (latest === null || stat.mtime > latest) {
        latest = stat.mtime;
      }
    } catch {
      continue;
    }
  }
  return latest;
}
```

- [ ] **Step 4: テストが通ることを確認**

```bash
cd /Users/gotanaka/tmp/panorama && node --test tests/fs-activity.test.js 2>&1 | tail -10
```
Expected: `# pass 4 / # fail 0`

- [ ] **Step 5: コミット**

```bash
cd /Users/gotanaka/tmp/panorama
git add src/lib/fs-activity.js tests/fs-activity.test.js
git commit -m "feat(fs-activity): add non-recursive directory mtime getter"
```

---

## Task 6: tmux.js — pane 生存判定

`tmux list-panes -a -F '#S:#W:#I.#P'` の出力行を扱う。
- カードの `tmux:` 形式: `` `<session>:<window-name>` (window #<window-index>, pane #<pane-index>) ``
- `(tmux外)` はそのままにする
- 判定は `session + window-name + pane-index` の一致、`window-index` は表示のみ

**Files:**
- Create: `/Users/gotanaka/tmp/panorama/src/lib/tmux.js`
- Create: `/Users/gotanaka/tmp/panorama/tests/tmux.test.js`

- [ ] **Step 1: 失敗するテストを書く**

```javascript
// tests/tmux.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTmuxField, parsePanesOutput, classifyAlive } from '../src/lib/tmux.js';

test('parseTmuxField: extracts session/window/pane', () => {
  const field = '`work:feat-login` (window #2, pane #1)';
  assert.deepEqual(parseTmuxField(field), {
    session: 'work',
    windowName: 'feat-login',
    windowIndex: 2,
    paneIndex: 1,
  });
});

test('parseTmuxField: returns null for (tmux外)', () => {
  assert.equal(parseTmuxField('(tmux外)'), null);
});

test('parseTmuxField: returns null for unparseable', () => {
  assert.equal(parseTmuxField('garbage'), null);
});

test('parsePanesOutput: splits lines into panes', () => {
  const stdout = 'work:feat-login:2.0\nwork:feat-login:2.1\nidle:main:0.0\n';
  assert.deepEqual(parsePanesOutput(stdout), [
    { session: 'work', windowName: 'feat-login', windowIndex: 2, paneIndex: 0 },
    { session: 'work', windowName: 'feat-login', windowIndex: 2, paneIndex: 1 },
    { session: 'idle', windowName: 'main', windowIndex: 0, paneIndex: 0 },
  ]);
});

test('classifyAlive: alive match', () => {
  const panes = [
    { session: 'work', windowName: 'feat-login', windowIndex: 2, paneIndex: 1 },
  ];
  const card = { session: 'work', windowName: 'feat-login', windowIndex: 2, paneIndex: 1 };
  assert.equal(classifyAlive(card, panes), '✅');
});

test('classifyAlive: window renamed', () => {
  const panes = [
    { session: 'work', windowName: 'feat-login-v2', windowIndex: 2, paneIndex: 1 },
  ];
  const card = { session: 'work', windowName: 'feat-login', windowIndex: 2, paneIndex: 1 };
  assert.equal(classifyAlive(card, panes), '⚠️ window renamed?');
});

test('classifyAlive: pane closed', () => {
  const panes = [];
  const card = { session: 'work', windowName: 'feat-login', windowIndex: 2, paneIndex: 1 };
  assert.equal(classifyAlive(card, panes), '⚠️ pane closed');
});

test('classifyAlive: null card (tmux外) keeps (tmux外)', () => {
  assert.equal(classifyAlive(null, []), '(tmux外)');
});
```

- [ ] **Step 2: テストが失敗することを確認**

```bash
cd /Users/gotanaka/tmp/panorama && node --test tests/tmux.test.js 2>&1 | tail -10
```
Expected: FAIL

- [ ] **Step 3: tmux.js を実装**

```javascript
// src/lib/tmux.js
import { execFileSync } from 'node:child_process';

export function parseTmuxField(text) {
  const trimmed = text.trim();
  if (trimmed === '(tmux外)') return null;
  const m = trimmed.match(/^`([^:`]+):([^`]+)`\s*\(window\s*#(\d+),\s*pane\s*#(\d+)\)$/);
  if (!m) return null;
  return {
    session: m[1],
    windowName: m[2],
    windowIndex: Number(m[3]),
    paneIndex: Number(m[4]),
  };
}

export function parsePanesOutput(stdout) {
  return stdout
    .split(/\r?\n/)
    .filter(line => line.length > 0)
    .map(line => {
      const m = line.match(/^([^:]+):([^:]+):(\d+)\.(\d+)$/);
      if (!m) return null;
      return {
        session: m[1],
        windowName: m[2],
        windowIndex: Number(m[3]),
        paneIndex: Number(m[4]),
      };
    })
    .filter(Boolean);
}

export function listPanes() {
  try {
    const out = execFileSync('tmux', ['list-panes', '-a', '-F', '#S:#W:#I.#P'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return parsePanesOutput(out);
  } catch {
    return null;
  }
}

export function classifyAlive(card, panes) {
  if (card === null) return '(tmux外)';
  const sameSessionAndPane = panes.filter(
    p => p.session === card.session && p.paneIndex === card.paneIndex
  );
  if (sameSessionAndPane.length === 0) return '⚠️ pane closed';
  const exact = sameSessionAndPane.find(p => p.windowName === card.windowName);
  if (exact) return '✅';
  return '⚠️ window renamed?';
}
```

- [ ] **Step 4: テストが通ることを確認**

```bash
cd /Users/gotanaka/tmp/panorama && node --test tests/tmux.test.js 2>&1 | tail -10
```
Expected: `# pass 8 / # fail 0`

- [ ] **Step 5: コミット**

```bash
cd /Users/gotanaka/tmp/panorama
git add src/lib/tmux.js tests/tmux.test.js
git commit -m "feat(tmux): parse list-panes and classify pane alive state"
```

---

## Task 7: parse-dashboard.js — Kanban マークダウン解析

Dashboard.md を「カード単位」に分割し、各カードの `tmux:` / `path:` / `<!-- auto -->` 行を抽出・置換する。

カードは `## <title>` 見出しで始まり、次の `## ` または `### ` より上位の見出し（`# ` や列見出し `## 🟢 対応中` など）で終わる。ただし本ツールでは **Kanban プラグインの列見出しは `## 🟢 対応中` 形式で、カード見出しは `### <title>` 形式** として扱う（Kanban プラグインの既定フォーマットに準拠）。

**Files:**
- Create: `/Users/gotanaka/tmp/panorama/src/lib/parse-dashboard.js`
- Create: `/Users/gotanaka/tmp/panorama/tests/parse-dashboard.test.js`

- [ ] **Step 1: 失敗するテストを書く**

```javascript
// tests/parse-dashboard.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitCards, extractCardFields, rewriteAutoField } from '../src/lib/parse-dashboard.js';

const sampleDashboard = `---
kanban-plugin: basic
---

## 🟢 対応中

### project-a / feat login

- **tmux:** \`work:feat-login\` (window #2, pane #1)
- **path:** /tmp/project-a
- **alive:** ✅ <!-- auto -->
- **branch:** main <!-- auto -->
- **last-commit:** (n/a) <!-- auto -->
- **last-activity:** (n/a) <!-- auto -->

### 次にやること
- [ ] hook up API

### project-b / refactor

- **tmux:** (tmux外)
- **path:** /tmp/project-b
- **alive:** (tmux外) <!-- auto -->
- **branch:** (n/a) <!-- auto -->
- **last-commit:** (n/a) <!-- auto -->
- **last-activity:** (n/a) <!-- auto -->

## 🟡 入力待ち

## ✅ 完了
`;

test('splitCards: returns one block per card', () => {
  const cards = splitCards(sampleDashboard);
  assert.equal(cards.length, 2);
  assert.match(cards[0].body, /project-a \/ feat login/);
  assert.match(cards[1].body, /project-b \/ refactor/);
});

test('splitCards: records start/end line indices', () => {
  const cards = splitCards(sampleDashboard);
  assert.ok(cards[0].endLine > cards[0].startLine);
  assert.ok(cards[1].startLine > cards[0].endLine);
});

test('extractCardFields: tmux and path', () => {
  const cards = splitCards(sampleDashboard);
  const fields = extractCardFields(cards[0].body);
  assert.equal(fields.tmux, '`work:feat-login` (window #2, pane #1)');
  assert.equal(fields.path, '/tmp/project-a');
});

test('extractCardFields: (tmux外) card', () => {
  const cards = splitCards(sampleDashboard);
  const fields = extractCardFields(cards[1].body);
  assert.equal(fields.tmux, '(tmux外)');
  assert.equal(fields.path, '/tmp/project-b');
});

test('rewriteAutoField: replaces marked value in-place', () => {
  const before = '- **branch:** main <!-- auto -->';
  const after = rewriteAutoField(before, 'branch', 'feature/login');
  assert.equal(after, '- **branch:** feature/login <!-- auto -->');
});

test('rewriteAutoField: leaves non-auto line alone', () => {
  const before = '- **branch:** main';
  const after = rewriteAutoField(before, 'branch', 'feature/login');
  assert.equal(after, '- **branch:** main');
});

test('rewriteAutoField: leaves unrelated key alone', () => {
  const before = '- **alive:** ✅ <!-- auto -->';
  const after = rewriteAutoField(before, 'branch', 'feature/login');
  assert.equal(after, '- **alive:** ✅ <!-- auto -->');
});
```

- [ ] **Step 2: テストが失敗することを確認**

```bash
cd /Users/gotanaka/tmp/panorama && node --test tests/parse-dashboard.test.js 2>&1 | tail -10
```
Expected: FAIL

- [ ] **Step 3: parse-dashboard.js を実装**

```javascript
// src/lib/parse-dashboard.js
const CARD_HEADING = /^### (?!次にやること|メモ)(.+)$/;
const COLUMN_HEADING = /^## /;

export function splitCards(text) {
  const lines = text.split(/\r?\n/);
  const cards = [];
  let currentStart = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (CARD_HEADING.test(line)) {
      if (currentStart !== -1) {
        cards.push({
          startLine: currentStart,
          endLine: i - 1,
          body: lines.slice(currentStart, i).join('\n'),
        });
      }
      currentStart = i;
    } else if (COLUMN_HEADING.test(line) && currentStart !== -1) {
      cards.push({
        startLine: currentStart,
        endLine: i - 1,
        body: lines.slice(currentStart, i).join('\n'),
      });
      currentStart = -1;
    }
  }
  if (currentStart !== -1) {
    cards.push({
      startLine: currentStart,
      endLine: lines.length - 1,
      body: lines.slice(currentStart).join('\n'),
    });
  }
  return cards;
}

const FIELD_LINE = /^-\s+\*\*([a-z-]+):\*\*\s+(.*?)(\s+<!--\s*auto\s*-->)?\s*$/;

export function extractCardFields(body) {
  const result = {};
  for (const line of body.split(/\r?\n/)) {
    const m = line.match(FIELD_LINE);
    if (m) {
      result[m[1]] = m[2];
    }
  }
  return result;
}

export function rewriteAutoField(line, key, newValue) {
  const m = line.match(/^(\s*-\s+\*\*([a-z-]+):\*\*\s+)(.*?)(\s+<!--\s*auto\s*-->)\s*$/);
  if (!m) return line;
  if (m[2] !== key) return line;
  return `${m[1]}${newValue}${m[4]}`;
}
```

- [ ] **Step 4: テストが通ることを確認**

```bash
cd /Users/gotanaka/tmp/panorama && node --test tests/parse-dashboard.test.js 2>&1 | tail -10
```
Expected: `# pass 7 / # fail 0`

- [ ] **Step 5: コミット**

```bash
cd /Users/gotanaka/tmp/panorama
git add src/lib/parse-dashboard.js tests/parse-dashboard.test.js
git commit -m "feat(parse-dashboard): split cards and rewrite auto-marked fields"
```

---

## Task 8: update.js — オーケストレータ

全モジュールを繋ぎ、Dashboard.md を読み込み、各カードの auto フィールドだけを書き換えて保存する。

**Files:**
- Create: `/Users/gotanaka/tmp/panorama/src/update.js`
- Create: `/Users/gotanaka/tmp/panorama/tests/update.test.js`

- [ ] **Step 1: 失敗するテストを書く**

```javascript
// tests/update.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { runUpdate } from '../src/update.js';

function makeProjectRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'panorama-proj-'));
  const run = (cmd, args) => execFileSync(cmd, args, { cwd: dir, stdio: 'pipe' });
  run('git', ['init', '-q', '-b', 'feature/login']);
  run('git', ['config', 'user.email', 'test@example.com']);
  run('git', ['config', 'user.name', 'Test']);
  run('git', ['config', 'commit.gpgsign', 'false']);
  writeFileSync(join(dir, 'x.txt'), 'x');
  run('git', ['add', 'x.txt']);
  run('git', ['commit', '-q', '-m', 'initial']);
  return dir;
}

test('runUpdate: rewrites branch and last-commit for a card', () => {
  const projectDir = makeProjectRepo();
  const vault = mkdtempSync(join(tmpdir(), 'panorama-vault-'));
  const dashboardPath = join(vault, 'Dashboard.md');

  const dashboard = `---
kanban-plugin: basic
---

## 🟢 対応中

### project-a / feat login

- **tmux:** (tmux外)
- **path:** ${projectDir}
- **alive:** (tmux外) <!-- auto -->
- **branch:** (n/a) <!-- auto -->
- **last-commit:** (n/a) <!-- auto -->
- **last-activity:** (n/a) <!-- auto -->

## ✅ 完了
`;
  writeFileSync(dashboardPath, dashboard);

  runUpdate({ vault_path: vault, dashboard_file: 'Dashboard.md' });

  const after = readFileSync(dashboardPath, 'utf8');
  assert.match(after, /- \*\*branch:\*\* feature\/login <!-- auto -->/);
  assert.match(after, /- \*\*last-commit:\*\* .+ · initial <!-- auto -->/);
  assert.match(after, /- \*\*last-activity:\*\* .+ <!-- auto -->/);
  assert.match(after, /- \*\*alive:\*\* \(tmux外\) <!-- auto -->/);
});

test('runUpdate: non-existent path gets (n/a)', () => {
  const vault = mkdtempSync(join(tmpdir(), 'panorama-vault-'));
  const dashboardPath = join(vault, 'Dashboard.md');
  const dashboard = `## 🟢 対応中

### broken card

- **tmux:** (tmux外)
- **path:** /nonexistent/xyz-panorama-test
- **alive:** (tmux外) <!-- auto -->
- **branch:** old <!-- auto -->
- **last-commit:** old <!-- auto -->
- **last-activity:** old <!-- auto -->
`;
  writeFileSync(dashboardPath, dashboard);

  runUpdate({ vault_path: vault, dashboard_file: 'Dashboard.md' });

  const after = readFileSync(dashboardPath, 'utf8');
  assert.match(after, /- \*\*branch:\*\* \(n\/a\) <!-- auto -->/);
  assert.match(after, /- \*\*last-commit:\*\* \(n\/a\) <!-- auto -->/);
  assert.match(after, /- \*\*last-activity:\*\* \(n\/a\) <!-- auto -->/);
});

test('runUpdate: does not touch non-auto lines', () => {
  const projectDir = makeProjectRepo();
  const vault = mkdtempSync(join(tmpdir(), 'panorama-vault-'));
  const dashboardPath = join(vault, 'Dashboard.md');
  const dashboard = `## 🟢 対応中

### project-a / feat login

- **tmux:** (tmux外)
- **path:** ${projectDir}
- **alive:** (tmux外) <!-- auto -->
- **branch:** (n/a) <!-- auto -->
- **last-commit:** (n/a) <!-- auto -->
- **last-activity:** (n/a) <!-- auto -->

### 次にやること
- [ ] don't touch me

### メモ
- also don't touch me
`;
  writeFileSync(dashboardPath, dashboard);

  runUpdate({ vault_path: vault, dashboard_file: 'Dashboard.md' });

  const after = readFileSync(dashboardPath, 'utf8');
  assert.match(after, /don't touch me/);
  assert.match(after, /also don't touch me/);
});
```

- [ ] **Step 2: テストが失敗することを確認**

```bash
cd /Users/gotanaka/tmp/panorama && node --test tests/update.test.js 2>&1 | tail -10
```
Expected: FAIL

- [ ] **Step 3: update.js を実装**

```javascript
// src/update.js
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { splitCards, extractCardFields, rewriteAutoField } from './lib/parse-dashboard.js';
import { getBranch, getLastCommit } from './lib/git.js';
import { getLastActivity } from './lib/fs-activity.js';
import { formatRelative } from './lib/relative-time.js';
import { listPanes, parseTmuxField, classifyAlive } from './lib/tmux.js';

const AUTO_KEYS = ['alive', 'branch', 'last-commit', 'last-activity'];

function buildCardUpdates(card, panes) {
  const fields = extractCardFields(card.body);
  const updates = {
    alive: '(tmux外)',
    branch: '(n/a)',
    'last-commit': '(n/a)',
    'last-activity': '(n/a)',
  };

  if (fields.path) {
    try {
      const branch = getBranch(fields.path);
      if (branch !== null) updates.branch = branch;
      const commit = getLastCommit(fields.path);
      if (commit !== null) updates['last-commit'] = commit;
      const activity = getLastActivity(fields.path);
      if (activity !== null) updates['last-activity'] = formatRelative(activity);
    } catch {
      /* leave defaults */
    }
  }

  if (fields.tmux !== undefined) {
    const parsed = parseTmuxField(fields.tmux);
    if (panes === null) {
      updates.alive = '(tmux外)';
    } else {
      updates.alive = classifyAlive(parsed, panes);
    }
  }

  return updates;
}

function applyUpdatesToLines(lines, card, updates) {
  for (let i = card.startLine; i <= card.endLine; i++) {
    for (const key of AUTO_KEYS) {
      lines[i] = rewriteAutoField(lines[i], key, updates[key]);
    }
  }
}

export function runUpdate(config) {
  const dashboardPath = join(config.vault_path, config.dashboard_file);
  const text = readFileSync(dashboardPath, 'utf8');
  const lines = text.split(/\r?\n/);
  const cards = splitCards(text);
  const panes = listPanes();

  for (const card of cards) {
    const updates = buildCardUpdates(card, panes);
    applyUpdatesToLines(lines, card, updates);
  }

  writeFileSync(dashboardPath, lines.join('\n'));
}
```

- [ ] **Step 4: テストが通ることを確認**

```bash
cd /Users/gotanaka/tmp/panorama && node --test tests/update.test.js 2>&1 | tail -10
```
Expected: `# pass 3 / # fail 0`

- [ ] **Step 5: フルテストを実行**

```bash
cd /Users/gotanaka/tmp/panorama && node --test tests/ 2>&1 | tail -10
```
Expected: 全テストがパス（Task 2〜8 の合計件数）

- [ ] **Step 6: コミット**

```bash
cd /Users/gotanaka/tmp/panorama
git add src/update.js tests/update.test.js
git commit -m "feat(update): orchestrator that rewrites auto fields per card"
```

---

## Task 9: bin/panorama — CLI ディスパッチャ

サブコマンド: `update`, `doctor`。どちらも失敗時は非ゼロ終了する。

**Files:**
- Create: `/Users/gotanaka/tmp/panorama/bin/panorama`
- Create: `/Users/gotanaka/tmp/panorama/tests/cli.test.js`

- [ ] **Step 1: 失敗するテストを書く**

```javascript
// tests/cli.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CLI = resolve('bin/panorama');

test('pano update: reads config and updates dashboard', () => {
  const vault = mkdtempSync(join(tmpdir(), 'panorama-cli-'));
  const cfgPath = join(vault, 'config.yaml');
  const dashboardPath = join(vault, 'Dashboard.md');
  writeFileSync(cfgPath, `vault_path: ${vault}\ndashboard_file: Dashboard.md\nupdate_interval_seconds: 180\n`);
  writeFileSync(dashboardPath, `## 🟢 対応中\n\n### empty card\n\n- **tmux:** (tmux外)\n- **path:** /nonexistent/xyz-panorama\n- **alive:** old <!-- auto -->\n- **branch:** old <!-- auto -->\n- **last-commit:** old <!-- auto -->\n- **last-activity:** old <!-- auto -->\n`);

  execFileSync('node', [CLI, 'update', '--config', cfgPath], { stdio: 'pipe' });

  const after = readFileSync(dashboardPath, 'utf8');
  assert.match(after, /- \*\*branch:\*\* \(n\/a\) <!-- auto -->/);
});

test('pano doctor: exits 0 when node and git exist', () => {
  const out = execFileSync('node', [CLI, 'doctor'], { encoding: 'utf8' });
  assert.match(out, /node:\s+OK/);
  assert.match(out, /git:\s+OK/);
});

test('pano: unknown subcommand exits non-zero', () => {
  assert.throws(() => {
    execFileSync('node', [CLI, 'bogus'], { stdio: 'pipe' });
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

```bash
cd /Users/gotanaka/tmp/panorama && node --test tests/cli.test.js 2>&1 | tail -10
```
Expected: FAIL

- [ ] **Step 3: bin/panorama を実装**

```javascript
#!/usr/bin/env node
// bin/panorama
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { loadConfig } from '../src/lib/config.js';
import { runUpdate } from '../src/update.js';

const __filename = fileURLToPath(import.meta.url);
const REPO_DIR = resolve(dirname(__filename), '..');

function defaultConfigPath() {
  return join(homedir(), '.config/panorama/config.yaml');
}

function parseArgs(argv) {
  const [subcommand, ...rest] = argv;
  const opts = {};
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--config') {
      opts.config = rest[++i];
    }
  }
  return { subcommand, opts };
}

function cmdUpdate(opts) {
  const cfgPath = opts.config || defaultConfigPath();
  if (!existsSync(cfgPath)) {
    console.error(`panorama: config not found at ${cfgPath}`);
    process.exit(1);
  }
  const cfg = loadConfig(cfgPath);
  runUpdate(cfg);
}

function checkBin(name) {
  try {
    execFileSync(name, ['--version'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function cmdDoctor() {
  const checks = [
    ['node', checkBin('node')],
    ['git', checkBin('git')],
    ['tmux', checkBin('tmux')],
  ];
  let allOk = true;
  for (const [name, ok] of checks) {
    console.log(`${name}:  ${ok ? 'OK' : 'MISSING'}`);
    if (!ok && name !== 'tmux') allOk = false;
  }
  const cfgPath = defaultConfigPath();
  console.log(`config: ${existsSync(cfgPath) ? 'OK' : 'MISSING'} (${cfgPath})`);
  const launchdPlist = join(homedir(), 'Library/LaunchAgents/com.user.panorama.plist');
  console.log(`launchd: ${existsSync(launchdPlist) ? 'OK' : 'MISSING'} (${launchdPlist})`);
  process.exit(allOk ? 0 : 1);
}

function usage() {
  console.error('Usage: panorama <update|doctor> [--config PATH]');
  process.exit(2);
}

const { subcommand, opts } = parseArgs(process.argv.slice(2));
switch (subcommand) {
  case 'update':
    cmdUpdate(opts);
    break;
  case 'doctor':
    cmdDoctor();
    break;
  default:
    usage();
}
```

- [ ] **Step 4: 実行権限を付与**

```bash
chmod +x /Users/gotanaka/tmp/panorama/bin/panorama
```

- [ ] **Step 5: テストが通ることを確認**

```bash
cd /Users/gotanaka/tmp/panorama && node --test tests/cli.test.js 2>&1 | tail -10
```
Expected: `# pass 3 / # fail 0`

- [ ] **Step 6: 全テスト確認**

```bash
cd /Users/gotanaka/tmp/panorama && node --test tests/ 2>&1 | tail -5
```
Expected: 全テストがパス

- [ ] **Step 7: コミット**

```bash
cd /Users/gotanaka/tmp/panorama
git add bin/panorama tests/cli.test.js
git commit -m "feat(cli): add pano update and pano doctor subcommands"
```

---

## Task 10: テンプレート — Dashboard.md と project-note.md

**Files:**
- Create: `/Users/gotanaka/tmp/panorama/templates/Dashboard.md`
- Create: `/Users/gotanaka/tmp/panorama/templates/project-note.md`

- [ ] **Step 1: Dashboard.md テンプレートを作成**

```markdown
---
kanban-plugin: basic
---

## 🟢 対応中

## 🟡 入力待ち

## 🔴 ブロック中

## ✅ 完了

%% kanban:settings
```
{"kanban-plugin":"basic"}
```
%%
```

- [ ] **Step 2: project-note.md テンプレートを作成**

```markdown
# {{project}}

## 概要


## リンク


## 履歴

```

- [ ] **Step 3: コミット**

```bash
cd /Users/gotanaka/tmp/panorama
git add templates/Dashboard.md templates/project-note.md
git commit -m "feat(templates): initial Dashboard and project-note templates"
```

---

## Task 11: skill/SKILL.md — Claude Code スキル

Claude Code が `~/.claude/skills/panorama/SKILL.md` として読み込む指示書。description に自動起動トリガを含める。

**Files:**
- Create: `/Users/gotanaka/tmp/panorama/skill/SKILL.md`

- [ ] **Step 1: SKILL.md を作成**

````markdown
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
````

- [ ] **Step 2: コミット**

```bash
cd /Users/gotanaka/tmp/panorama
git add skill/SKILL.md
git commit -m "feat(skill): add Claude Code skill for dashboard operations"
```

---

## Task 12: launchd plist テンプレート

**Files:**
- Create: `/Users/gotanaka/tmp/panorama/launchd/com.user.panorama.plist.template`

- [ ] **Step 1: plist テンプレートを作成**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.user.panorama</string>
    <key>ProgramArguments</key>
    <array>
        <string>{{NODE_BIN}}</string>
        <string>{{REPO_DIR}}/bin/panorama</string>
        <string>update</string>
    </array>
    <key>StartInterval</key>
    <integer>{{INTERVAL}}</integer>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>{{LOG_PATH}}</string>
    <key>StandardErrorPath</key>
    <string>{{LOG_PATH}}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    </dict>
</dict>
</plist>
```

- [ ] **Step 2: コミット**

```bash
cd /Users/gotanaka/tmp/panorama
git add launchd/com.user.panorama.plist.template
git commit -m "feat(launchd): add plist template with placeholders"
```

---

## Task 13: config.example.yaml

**Files:**
- Create: `/Users/gotanaka/tmp/panorama/config.example.yaml`

- [ ] **Step 1: サンプル config を作成**

```yaml
# panorama config
vault_path: ~/Documents/Obsidian/work-dashboard
dashboard_file: Dashboard.md
update_interval_seconds: 180

# 列定義（現時点では表示専用、Dashboard.md に合わせる）
columns:
  - active
  - waiting
  - blocked
  - done
```

- [ ] **Step 2: コミット**

```bash
cd /Users/gotanaka/tmp/panorama
git add config.example.yaml
git commit -m "feat(config): add example config"
```

---

## Task 14: install.sh

自分自身のあるディレクトリを `REPO_DIR` として動く。依存チェック → config 初期化 → Vault 初期化 → symlink → launchd 登録 → 初回 update。

**Files:**
- Create: `/Users/gotanaka/tmp/panorama/install.sh`

- [ ] **Step 1: install.sh を作成**

```bash
#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_DIR="$HOME/.config/panorama"
CONFIG_FILE="$CONFIG_DIR/config.yaml"
SKILL_LINK="$HOME/.claude/skills/panorama"
CLI_LINK="$HOME/.local/bin/panorama"
LAUNCHD_DIR="$HOME/Library/LaunchAgents"
LAUNCHD_PLIST="$LAUNCHD_DIR/com.user.panorama.plist"
LOG_PATH="$HOME/Library/Logs/panorama.log"

echo "panorama installer"
echo "  REPO_DIR: $REPO_DIR"

# 1. 依存チェック
for bin in node git tmux launchctl; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "ERROR: $bin is required but not installed" >&2
    exit 1
  fi
done
NODE_BIN="$(command -v node)"

# 2. config 初期化
mkdir -p "$CONFIG_DIR"
if [ ! -f "$CONFIG_FILE" ]; then
  cp "$REPO_DIR/config.example.yaml" "$CONFIG_FILE"
  echo "Created $CONFIG_FILE"
else
  echo "Keeping existing $CONFIG_FILE"
fi

# 3. Vault 初期化
VAULT_PATH="$(grep '^vault_path:' "$CONFIG_FILE" | sed -E 's/vault_path:\s*//' | sed "s|~|$HOME|")"
DASHBOARD_FILE="$(grep '^dashboard_file:' "$CONFIG_FILE" | sed -E 's/dashboard_file:\s*//')"
mkdir -p "$VAULT_PATH/projects"
if [ ! -f "$VAULT_PATH/$DASHBOARD_FILE" ]; then
  cp "$REPO_DIR/templates/Dashboard.md" "$VAULT_PATH/$DASHBOARD_FILE"
  echo "Created $VAULT_PATH/$DASHBOARD_FILE"
else
  echo "Keeping existing $VAULT_PATH/$DASHBOARD_FILE"
fi

# 4. スキル設置
mkdir -p "$(dirname "$SKILL_LINK")"
ln -sfn "$REPO_DIR/skill" "$SKILL_LINK"
echo "Linked $SKILL_LINK -> $REPO_DIR/skill"

# 5. CLI 設置
mkdir -p "$(dirname "$CLI_LINK")"
ln -sfn "$REPO_DIR/bin/panorama" "$CLI_LINK"
echo "Linked $CLI_LINK -> $REPO_DIR/bin/panorama"

# 6. launchd 登録
INTERVAL="$(grep '^update_interval_seconds:' "$CONFIG_FILE" | awk '{print $2}')"
INTERVAL="${INTERVAL:-180}"
mkdir -p "$LAUNCHD_DIR"
sed \
  -e "s|{{NODE_BIN}}|$NODE_BIN|g" \
  -e "s|{{REPO_DIR}}|$REPO_DIR|g" \
  -e "s|{{INTERVAL}}|$INTERVAL|g" \
  -e "s|{{LOG_PATH}}|$LOG_PATH|g" \
  "$REPO_DIR/launchd/com.user.panorama.plist.template" > "$LAUNCHD_PLIST"
launchctl unload "$LAUNCHD_PLIST" 2>/dev/null || true
launchctl load "$LAUNCHD_PLIST"
echo "Loaded launchd plist $LAUNCHD_PLIST"

# 7. 初回 update
"$CLI_LINK" update --config "$CONFIG_FILE" || true

echo
echo "panorama installed."
echo "Run 'panorama doctor' to verify."
```

- [ ] **Step 2: 実行権限を付与**

```bash
chmod +x /Users/gotanaka/tmp/panorama/install.sh
```

- [ ] **Step 3: 構文チェック**

```bash
bash -n /Users/gotanaka/tmp/panorama/install.sh && echo OK
```
Expected: `OK`

- [ ] **Step 4: コミット**

```bash
cd /Users/gotanaka/tmp/panorama
git add install.sh
git commit -m "feat(install): add one-shot installer for macOS"
```

---

## Task 15: uninstall.sh

**Files:**
- Create: `/Users/gotanaka/tmp/panorama/uninstall.sh`

- [ ] **Step 1: uninstall.sh を作成**

```bash
#!/usr/bin/env bash
set -euo pipefail

SKILL_LINK="$HOME/.claude/skills/panorama"
CLI_LINK="$HOME/.local/bin/panorama"
LAUNCHD_PLIST="$HOME/Library/LaunchAgents/com.user.panorama.plist"

echo "panorama uninstaller"
echo "  (leaves Vault and ~/.config/panorama/config.yaml intact)"

if [ -f "$LAUNCHD_PLIST" ]; then
  launchctl unload "$LAUNCHD_PLIST" 2>/dev/null || true
  rm -f "$LAUNCHD_PLIST"
  echo "Removed $LAUNCHD_PLIST"
fi

if [ -L "$SKILL_LINK" ]; then
  rm "$SKILL_LINK"
  echo "Removed symlink $SKILL_LINK"
fi

if [ -L "$CLI_LINK" ]; then
  rm "$CLI_LINK"
  echo "Removed symlink $CLI_LINK"
fi

echo "Done."
```

- [ ] **Step 2: 実行権限を付与**

```bash
chmod +x /Users/gotanaka/tmp/panorama/uninstall.sh
```

- [ ] **Step 3: 構文チェック**

```bash
bash -n /Users/gotanaka/tmp/panorama/uninstall.sh && echo OK
```
Expected: `OK`

- [ ] **Step 4: コミット**

```bash
cd /Users/gotanaka/tmp/panorama
git add uninstall.sh
git commit -m "feat(uninstall): add uninstaller that leaves user data intact"
```

---

## Task 16: README.md

**Files:**
- Create: `/Users/gotanaka/tmp/panorama/README.md`

- [ ] **Step 1: README.md を作成**

````markdown
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
````

- [ ] **Step 2: コミット**

```bash
cd /Users/gotanaka/tmp/panorama
git add README.md
git commit -m "docs: add README"
```

---

## Task 17: LICENSE + 最終確認

**Files:**
- Create: `/Users/gotanaka/tmp/panorama/LICENSE`

- [ ] **Step 1: MIT LICENSE を作成**

```
MIT License

Copyright (c) 2026 tango238

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 2: 全テストを最終確認**

```bash
cd /Users/gotanaka/tmp/panorama && node --test tests/ 2>&1 | tail -10
```
Expected: 全テストがパス（0 fail）

- [ ] **Step 3: `panorama doctor` を手動実行して結合確認**

```bash
cd /Users/gotanaka/tmp/panorama && node bin/panorama doctor || true
```
Expected: `node: OK` / `git: OK` / `tmux: OK`（ローカル環境に依存）

- [ ] **Step 4: 最終コミット**

```bash
cd /Users/gotanaka/tmp/panorama
git add LICENSE
git commit -m "docs: add MIT license"
```

- [ ] **Step 5: コミット履歴確認**

```bash
cd /Users/gotanaka/tmp/panorama && git log --oneline
```
Expected: 16 以上のコミット（design.md + 各 Task のコミット）

---

## 検証チェックリスト（仕様との突合せ）

| 仕様セクション | 実装タスク |
|---|---|
| §2 アーキテクチャ（updater + skill + launchd） | Task 8, 11, 12 |
| §3 Vault 構成 (Dashboard.md, projects/) | Task 10, 14 |
| §4.1 列構成 (🟢🟡🔴✅) | Task 10 |
| §4.2 カードテンプレート | Task 11 (skill), Task 10 (templates) |
| §4.3 auto マーカー | Task 7, 8 |
| §5.1 Node.js | Task 1〜9 |
| §5.2 動作（branch / last-commit / last-activity / alive） | Task 4, 5, 6, 8 |
| §5.3 エラー処理（存在しないパス、tmux 未起動） | Task 4, 5, 6, 8 の null 処理 |
| §5.4 冪等性（auto 行のみ書換） | Task 7 `rewriteAutoField`, Task 8 |
| §5.5 launchd 180 秒 | Task 12, 14 |
| §6 Claude Code スキル A/C/D/E | Task 11 |
| §7 運用フロー | Task 16 (README) |
| §8 リポジトリ構成 | Task 1〜17 全体 |
| §9 実行時ファイル配置 | Task 14 (install.sh) |
| §10 config.yaml | Task 2, 13 |
| §11 install.sh の動作 (依存〜初回 update) | Task 14 |
| §11.1 uninstall.sh | Task 15 |
| §12 CLI (update / doctor) | Task 9 |
| §13 配布と開発 | Task 16 (README) |
| §14 スコープ外 | 実装しない（YAGNI） |
| §15 成功基準 | 最終 doctor 実行 + 手動運用で確認 |

