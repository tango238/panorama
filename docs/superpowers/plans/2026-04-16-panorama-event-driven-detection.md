# panorama イベント駆動検出 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude Code のセッション状態を 5 種類の hook で確定書き込みし、session ID をプライマリキーに切り替えることで、Kanban の 🟢/🟡 自動遷移の精度を向上させる。

**Architecture:** hook script が stdin JSON から session ID + cwd を抽出し `~/.config/panorama/states/{session_id}.json` に原子的書き込み。updater は全 state ファイルを読み、bySession / byCwd 2つのインデックスでカードに突合。stale（1h 超）は触らない。

**Tech Stack:** Node.js（ESM）、bash、jq、node:test（builtin test runner）。

**Spec:** `docs/superpowers/specs/2026-04-16-panorama-event-driven-detection-design.md`

---

## File Structure

**変更ファイル:**
- `hooks/notify-state.sh` — 全面書き換え（jq、atomic write、fail-open、session_id キー）
- `src/lib/tmux.js` — `readHookState` 削除、`loadAllHookStates` / `resolveCardState` 追加、`detectClaudeCodeState` をホワイトリスト検証 + stale → null に変更
- `src/update.js` — 新 API を使うように書き換え
- `install.sh` — `hooks/` ディレクトリを `~/.local/share/panorama/hooks/` にコピー、5 種類の hook を idempotent に追加、旧 state ファイル削除、jq 必須
- `bin/panorama` — doctor に jq と hooks path チェック追加

**新規テストファイル:**
- `tests/hook-state.test.js` — `loadAllHookStates` / `resolveCardState` のテスト
- `tests/notify-state.test.js` — hook script を子プロセスで呼んで検証

**更新テストファイル:**
- `test/detect-state.test.js` — stale → null、state 値ホワイトリスト、timestamp 欠損の検証を追加
- `tests/tmux.test.js` — `readHookState` テスト削除
- `tests/update.test.js` — 新 API に合わせた state 流入シナリオ
- `tests/cli.test.js` — doctor の jq/hooks チェック反映

---

## Task 1: hook script の全面書き換え

**Files:**
- Modify: `hooks/notify-state.sh`
- Test: `tests/notify-state.test.js` (create)

- [ ] **Step 1: ツールの確認**

Run: `which jq bash mktemp`
Expected: 3 つのパスが出力される（jq 必須）。なければ `brew install jq`。

- [ ] **Step 2: テストファイル `tests/notify-state.test.js` を作成**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, existsSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const HOOK = resolve('hooks/notify-state.sh');

function runHook(state, stdinJson, homeDir) {
  const env = { ...process.env, HOME: homeDir };
  return spawnSync('bash', [HOOK, state], {
    input: stdinJson,
    env,
    encoding: 'utf8',
  });
}

function readStateFiles(homeDir) {
  const dir = join(homeDir, '.config/panorama/states');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(readFileSync(join(dir, f), 'utf8')));
}

test('notify-state: writes state file with session_id from stdin', () => {
  const home = mkdtempSync(join(tmpdir(), 'panorama-hook-'));
  const stdin = JSON.stringify({
    session_id: 'abc-123-def',
    cwd: '/Users/test/repo',
    hook_event_name: 'PreToolUse',
  });
  const r = runHook('active', stdin, home);
  assert.equal(r.status, 0, `exit nonzero: ${r.stderr}`);

  const files = readStateFiles(home);
  assert.equal(files.length, 1);
  assert.equal(files[0].state, 'active');
  assert.equal(files[0].session_id, 'abc-123-def');
  assert.equal(files[0].cwd, '/Users/test/repo');
  assert.ok(typeof files[0].timestamp === 'number');
});

test('notify-state: writes waiting state', () => {
  const home = mkdtempSync(join(tmpdir(), 'panorama-hook-'));
  const stdin = JSON.stringify({ session_id: 'x1-y2', cwd: '/p' });
  const r = runHook('waiting', stdin, home);
  assert.equal(r.status, 0);
  const files = readStateFiles(home);
  assert.equal(files[0].state, 'waiting');
});

test('notify-state: no session_id means no write (fail-open)', () => {
  const home = mkdtempSync(join(tmpdir(), 'panorama-hook-'));
  const stdin = JSON.stringify({ cwd: '/p' });
  const r = runHook('active', stdin, home);
  assert.equal(r.status, 0);
  assert.equal(readStateFiles(home).length, 0);
});

test('notify-state: empty stdin means no write (fail-open)', () => {
  const home = mkdtempSync(join(tmpdir(), 'panorama-hook-'));
  const r = runHook('active', '', home);
  assert.equal(r.status, 0);
  assert.equal(readStateFiles(home).length, 0);
});

test('notify-state: unsafe session_id rejected', () => {
  const home = mkdtempSync(join(tmpdir(), 'panorama-hook-'));
  const stdin = JSON.stringify({ session_id: '../evil', cwd: '/p' });
  const r = runHook('active', stdin, home);
  assert.equal(r.status, 0);
  assert.equal(readStateFiles(home).length, 0);
});

test('notify-state: unknown state argument rejected', () => {
  const home = mkdtempSync(join(tmpdir(), 'panorama-hook-'));
  const stdin = JSON.stringify({ session_id: 'abc', cwd: '/p' });
  const r = runHook('bogus', stdin, home);
  assert.equal(r.status, 0);
  assert.equal(readStateFiles(home).length, 0);
});

test('notify-state: special chars in cwd escaped properly', () => {
  const home = mkdtempSync(join(tmpdir(), 'panorama-hook-'));
  const cwd = '/Users/test/has "quote" and \\back';
  const stdin = JSON.stringify({ session_id: 'abc', cwd });
  const r = runHook('active', stdin, home);
  assert.equal(r.status, 0);
  const files = readStateFiles(home);
  assert.equal(files[0].cwd, cwd);
});

test('notify-state: atomic write via mv (no temp file leftover)', () => {
  const home = mkdtempSync(join(tmpdir(), 'panorama-hook-'));
  const stdin = JSON.stringify({ session_id: 'abc', cwd: '/p' });
  runHook('active', stdin, home);
  const dir = join(home, '.config/panorama/states');
  const tmps = readdirSync(dir).filter(f => f.startsWith('.tmp-'));
  assert.equal(tmps.length, 0, 'temp file leaked');
});
```

- [ ] **Step 3: テスト実行 → 失敗確認**

Run: `node --test tests/notify-state.test.js`
Expected: FAIL（旧 hook script は session_id キーに対応していない）

- [ ] **Step 4: `hooks/notify-state.sh` を書き換え**

```bash
#!/usr/bin/env bash
# panorama state hook (fail-open, atomic write)
# Usage: notify-state.sh <active|waiting>
# Reads Claude Code hook JSON from stdin with session_id, cwd fields.

STATE="${1:-active}"
STATE_DIR="$HOME/.config/panorama/states"
mkdir -p "$STATE_DIR" 2>/dev/null || exit 0

# jq 不在ならフェイルオープン
command -v jq >/dev/null 2>&1 || exit 0

INPUT=$(cat 2>/dev/null || echo '{}')
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty' 2>/dev/null || echo "")
CWD=$(echo "$INPUT" | jq -r '.cwd // empty' 2>/dev/null || echo "")

[ -z "$SESSION_ID" ] && exit 0

case "$STATE" in
  active|waiting) ;;
  *) exit 0 ;;
esac

# session_id はファイル名として安全か（英数 + ハイフンのみ）
case "$SESSION_ID" in
  *[!a-zA-Z0-9-]*) exit 0 ;;
esac

STATE_FILE="$STATE_DIR/${SESSION_ID}.json"
TEMP_FILE=$(mktemp "$STATE_DIR/.tmp-XXXXXX" 2>/dev/null) || exit 0

TS=$(date +%s)
jq -n \
  --arg state "$STATE" \
  --argjson timestamp "$TS" \
  --arg session_id "$SESSION_ID" \
  --arg cwd "$CWD" \
  '{state: $state, timestamp: $timestamp, session_id: $session_id, cwd: $cwd}' \
  > "$TEMP_FILE" 2>/dev/null || { rm -f "$TEMP_FILE"; exit 0; }

mv -f "$TEMP_FILE" "$STATE_FILE" 2>/dev/null || rm -f "$TEMP_FILE"
exit 0
```

- [ ] **Step 5: 実行権限確認**

Run: `chmod +x hooks/notify-state.sh`

- [ ] **Step 6: テスト実行 → pass 確認**

Run: `node --test tests/notify-state.test.js`
Expected: 8 件全て PASS。

- [ ] **Step 7: 全テスト実行（リグレッション確認）**

Run: `node --test`
Expected: 既存テストの失敗（特に `detect-state.test.js` / `tmux.test.js` の `readHookState` 系）は後続タスクで対処するので、notify-state のみ PASS していれば次に進む。

- [ ] **Step 8: commit**

```bash
git add hooks/notify-state.sh tests/notify-state.test.js
git commit -m "feat(hook): rewrite notify-state.sh with session_id key, atomic write, fail-open"
```

---

## Task 2: detectClaudeCodeState を stale → null + ホワイトリスト検証に変更

**Files:**
- Modify: `src/lib/tmux.js:80-89` (detectClaudeCodeState)
- Test: `test/detect-state.test.js`

- [ ] **Step 1: 既存テスト `test/detect-state.test.js` を新仕様に書き換え**

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectClaudeCodeState } from '../src/lib/tmux.js';

function nowEpoch() {
  return Math.floor(Date.now() / 1000);
}

// 既定 staleThreshold は 3600s (1h)
describe('detectClaudeCodeState', () => {
  it('returns null when hookState is null', () => {
    assert.equal(detectClaudeCodeState(null), null);
  });

  it('returns state="active" verbatim when fresh', () => {
    const hookState = { state: 'active', timestamp: nowEpoch() };
    assert.equal(detectClaudeCodeState(hookState), 'active');
  });

  it('returns state="waiting" verbatim when fresh', () => {
    const hookState = { state: 'waiting', timestamp: nowEpoch() };
    assert.equal(detectClaudeCodeState(hookState), 'waiting');
  });

  it('returns null when timestamp is older than staleThreshold (1h default)', () => {
    const hookState = { state: 'active', timestamp: nowEpoch() - 3601 };
    assert.equal(detectClaudeCodeState(hookState), null);
  });

  it('returns null for stale waiting state too', () => {
    const hookState = { state: 'waiting', timestamp: nowEpoch() - 3601 };
    assert.equal(detectClaudeCodeState(hookState), null);
  });

  it('respects custom staleThreshold', () => {
    const hookState = { state: 'active', timestamp: nowEpoch() - 61 };
    assert.equal(detectClaudeCodeState(hookState, 60), null);
    assert.equal(detectClaudeCodeState(hookState, 120), 'active');
  });

  it('rejects unknown state as null', () => {
    const hookState = { state: 'bogus', timestamp: nowEpoch() };
    assert.equal(detectClaudeCodeState(hookState), null);
  });

  it('rejects missing timestamp as null', () => {
    const hookState = { state: 'active' };
    assert.equal(detectClaudeCodeState(hookState), null);
  });

  it('rejects non-number timestamp as null', () => {
    const hookState = { state: 'active', timestamp: 'now' };
    assert.equal(detectClaudeCodeState(hookState), null);
  });

  it('rejects undefined state as null', () => {
    const hookState = { timestamp: nowEpoch() };
    assert.equal(detectClaudeCodeState(hookState), null);
  });
});
```

- [ ] **Step 2: テスト実行 → 失敗確認**

Run: `node --test test/detect-state.test.js`
Expected: `rejects unknown state`, `rejects missing timestamp`, stale で waiting 返す旧挙動などが FAIL。

- [ ] **Step 3: `src/lib/tmux.js` の `detectClaudeCodeState` を書き換え**

現行（80-89 行目）を置き換え:

```javascript
const STALE_THRESHOLD_SEC = 3600; // 1h
const VALID_STATES = new Set(['active', 'waiting']);

export function detectClaudeCodeState(hookState, staleThreshold = STALE_THRESHOLD_SEC) {
  if (hookState === null || typeof hookState !== 'object') return null;
  if (!VALID_STATES.has(hookState.state)) return null;
  if (typeof hookState.timestamp !== 'number') return null;
  const elapsed = Math.floor(Date.now() / 1000) - hookState.timestamp;
  if (elapsed > staleThreshold) return null;
  return hookState.state;
}
```

既存の `DEFAULT_IDLE_THRESHOLD_SEC = 90` 定数は削除。

- [ ] **Step 4: テスト実行 → pass 確認**

Run: `node --test test/detect-state.test.js`
Expected: 10 件 PASS。

- [ ] **Step 5: commit**

```bash
git add src/lib/tmux.js test/detect-state.test.js
git commit -m "refactor(detect): stale returns null, whitelist state values"
```

---

## Task 3: loadAllHookStates を追加

**Files:**
- Modify: `src/lib/tmux.js`
- Test: `tests/hook-state.test.js` (create)

- [ ] **Step 1: テストファイル `tests/hook-state.test.js` を作成**

```javascript
import { test, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadAllHookStates } from '../src/lib/tmux.js';

function makeStateDir() {
  const home = mkdtempSync(join(tmpdir(), 'panorama-states-'));
  const dir = join(home, '.config/panorama/states');
  mkdirSync(dir, { recursive: true });
  return { home, dir };
}

function writeState(dir, sessionId, body) {
  writeFileSync(join(dir, `${sessionId}.json`), JSON.stringify(body));
}

describe('loadAllHookStates', () => {
  it('returns empty indices when state dir missing', () => {
    const home = mkdtempSync(join(tmpdir(), 'panorama-empty-'));
    const { bySession, byCwd } = loadAllHookStates(home);
    assert.equal(bySession.size, 0);
    assert.equal(byCwd.size, 0);
  });

  it('loads a single state file into bySession', () => {
    const { home, dir } = makeStateDir();
    writeState(dir, 'sess-1', { state: 'active', timestamp: 100, session_id: 'sess-1', cwd: '/a' });
    const { bySession } = loadAllHookStates(home);
    assert.equal(bySession.size, 1);
    assert.equal(bySession.get('sess-1').state, 'active');
  });

  it('loads multiple into bySession, and byCwd has arrays sorted by timestamp desc', () => {
    const { home, dir } = makeStateDir();
    writeState(dir, 'sess-a', { state: 'active', timestamp: 100, session_id: 'sess-a', cwd: '/shared' });
    writeState(dir, 'sess-b', { state: 'waiting', timestamp: 200, session_id: 'sess-b', cwd: '/shared' });
    writeState(dir, 'sess-c', { state: 'active', timestamp: 150, session_id: 'sess-c', cwd: '/other' });
    const { bySession, byCwd } = loadAllHookStates(home);
    assert.equal(bySession.size, 3);

    const shared = byCwd.get('/shared');
    assert.equal(shared.length, 2);
    assert.equal(shared[0].timestamp, 200); // 新しい方が先頭
    assert.equal(shared[1].timestamp, 100);

    const other = byCwd.get('/other');
    assert.equal(other.length, 1);
  });

  it('skips malformed JSON files', () => {
    const { home, dir } = makeStateDir();
    writeFileSync(join(dir, 'broken.json'), 'not json');
    writeState(dir, 'good', { state: 'active', timestamp: 100, session_id: 'good', cwd: '/x' });
    const { bySession } = loadAllHookStates(home);
    assert.equal(bySession.size, 1);
    assert.equal(bySession.has('good'), true);
  });

  it('skips hidden temp files', () => {
    const { home, dir } = makeStateDir();
    writeFileSync(join(dir, '.tmp-xyz'), 'partial');
    writeState(dir, 'real', { state: 'active', timestamp: 100, session_id: 'real', cwd: '/x' });
    const { bySession } = loadAllHookStates(home);
    assert.equal(bySession.size, 1);
  });

  it('skips state entries without session_id field', () => {
    const { home, dir } = makeStateDir();
    writeFileSync(join(dir, 'nosess.json'), JSON.stringify({ state: 'active', timestamp: 1, cwd: '/x' }));
    const { bySession } = loadAllHookStates(home);
    assert.equal(bySession.size, 0);
  });
});
```

- [ ] **Step 2: テスト実行 → 失敗確認**

Run: `node --test tests/hook-state.test.js`
Expected: `loadAllHookStates is not a function` で FAIL。

- [ ] **Step 3: `src/lib/tmux.js` に `loadAllHookStates` を追加**

ファイル冒頭の import に `join`、`readFileSync`、`readdirSync` が既にあるので再利用。`homedir` も既に import 済み。

`STATE_DIR` 定数行の直後に追加（48 行目の後）:

```javascript
// homeDir 引数で override 可能。未指定なら環境の HOME
export function loadAllHookStates(homeDir = homedir()) {
  const stateDir = join(homeDir, '.config/panorama/states');
  const bySession = new Map();
  const byCwd = new Map();

  let files;
  try {
    files = readdirSync(stateDir);
  } catch {
    return { bySession, byCwd };
  }

  const entries = [];
  for (const f of files) {
    if (!f.endsWith('.json') || f.startsWith('.')) continue;
    try {
      const raw = readFileSync(join(stateDir, f), 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') continue;
      if (typeof parsed.session_id !== 'string' || parsed.session_id.length === 0) continue;
      entries.push(parsed);
    } catch { /* skip unreadable/malformed */ }
  }

  for (const e of entries) {
    bySession.set(e.session_id, e);
    if (typeof e.cwd === 'string' && e.cwd.length > 0) {
      if (!byCwd.has(e.cwd)) byCwd.set(e.cwd, []);
      byCwd.get(e.cwd).push(e);
    }
  }

  for (const arr of byCwd.values()) {
    arr.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  }

  return { bySession, byCwd };
}
```

- [ ] **Step 4: テスト実行 → pass 確認**

Run: `node --test tests/hook-state.test.js`
Expected: 6 件 PASS。

- [ ] **Step 5: commit**

```bash
git add src/lib/tmux.js tests/hook-state.test.js
git commit -m "feat(tmux): add loadAllHookStates indexing by session and cwd"
```

---

## Task 4: resolveCardState を追加

**Files:**
- Modify: `src/lib/tmux.js`
- Test: `tests/hook-state.test.js` (extend)

- [ ] **Step 1: `tests/hook-state.test.js` に resolveCardState テストを追記**

ファイル末尾（最後の `});` の後）に追加:

```javascript
import { resolveCardState } from '../src/lib/tmux.js';

describe('resolveCardState', () => {
  const state1 = { state: 'active', timestamp: 100, session_id: 'sess-1', cwd: '/repo-a' };
  const state2 = { state: 'waiting', timestamp: 200, session_id: 'sess-2', cwd: '/repo-a' };
  const state3 = { state: 'active', timestamp: 150, session_id: 'sess-3', cwd: '/repo-b' };

  const indices = {
    bySession: new Map([['sess-1', state1], ['sess-2', state2], ['sess-3', state3]]),
    byCwd: new Map([
      ['/repo-a', [state2, state1]], // timestamp desc
      ['/repo-b', [state3]],
    ]),
  };

  it('matches by session_id embedded in card body', () => {
    const card = { body: '- **title**\n\t<!-- session: sess-2 -->' };
    assert.equal(resolveCardState(card, indices), state2);
  });

  it('falls back to cwd match when session not in card', () => {
    const card = { body: '- **title**\n\t- **path:** /repo-b' };
    assert.equal(resolveCardState(card, indices), state3);
  });

  it('cwd fallback returns newest when multiple sessions share cwd', () => {
    const card = { body: '- **title**\n\t- **path:** /repo-a' };
    assert.equal(resolveCardState(card, indices), state2);
  });

  it('returns null when neither matches', () => {
    const card = { body: '- **title**\n\t- **path:** /unknown' };
    assert.equal(resolveCardState(card, indices), null);
  });

  it('session_id takes priority over cwd', () => {
    const card = { body: '- **title**\n\t- **path:** /repo-a\n\t<!-- session: sess-3 -->' };
    assert.equal(resolveCardState(card, indices), state3);
  });

  it('handles blocked session marker <!-- session: X | blocked -->', () => {
    const card = { body: '- **title**\n\t<!-- session: sess-1 | blocked -->' };
    assert.equal(resolveCardState(card, indices), state1);
  });
});
```

- [ ] **Step 2: テスト実行 → 失敗確認**

Run: `node --test tests/hook-state.test.js`
Expected: `resolveCardState is not a function` で FAIL。

- [ ] **Step 3: `src/lib/tmux.js` に `resolveCardState` を追加**

`loadAllHookStates` の直後に追加:

```javascript
const CARD_SESSION_RE = /<!--\s*session:\s*([0-9a-fA-F-]+)\s*(?:\|\s*blocked\s*)?-->/;
const CARD_PATH_RE = /\*\*path:\*\*\s+(.+)/;

export function resolveCardState(card, indices) {
  const body = card.body || '';

  const sessionMatch = body.match(CARD_SESSION_RE);
  if (sessionMatch) {
    const found = indices.bySession.get(sessionMatch[1]);
    if (found) return found;
  }

  const pathMatch = body.match(CARD_PATH_RE);
  if (pathMatch) {
    const cwd = pathMatch[1].trim();
    const arr = indices.byCwd.get(cwd);
    if (arr && arr.length > 0) return arr[0];
  }

  return null;
}
```

- [ ] **Step 4: テスト実行 → pass 確認**

Run: `node --test tests/hook-state.test.js`
Expected: resolveCardState 6 件含む全 12 件 PASS。

- [ ] **Step 5: commit**

```bash
git add src/lib/tmux.js tests/hook-state.test.js
git commit -m "feat(tmux): add resolveCardState with session ID primary and cwd fallback"
```

---

## Task 5: readHookState 削除と src/update.js の書き換え

**Files:**
- Modify: `src/lib/tmux.js:51-78` (remove readHookState)
- Modify: `src/update.js:8,64,79-104`
- Modify: `tests/tmux.test.js` (remove readHookState tests if any)
- Modify: `tests/update.test.js`

- [ ] **Step 1: `tests/update.test.js` の期待を新 API 向けに更新**

まずは既存テストを確認。現在 `runUpdate` は state 遷移ロジックを含まないか、含むが readHookState 経由。state 遷移は `tests/update.test.js` では直接カバーされていないと思われるので、state 流入のテストを追加:

`tests/update.test.js` の末尾に追加:

```javascript
import { mkdirSync } from 'node:fs';

test('runUpdate: moves active state card to 🟢', () => {
  const home = mkdtempSync(join(tmpdir(), 'panorama-home-'));
  const vault = mkdtempSync(join(tmpdir(), 'panorama-vault-'));
  const dashboardPath = join(vault, 'Dashboard.md');

  // state file with session_id key
  const stateDir = join(home, '.config/panorama/states');
  mkdirSync(stateDir, { recursive: true });
  const ts = Math.floor(Date.now() / 1000);
  writeFileSync(join(stateDir, 'sess-xyz.json'), JSON.stringify({
    state: 'active', timestamp: ts, session_id: 'sess-xyz', cwd: '/nowhere',
  }));

  const dashboard = `## 🟢 対応中

## 🟡 入力待ち

- **proj / t1**
\t- **path:** /nowhere
\t- **last-commit:** x <!-- auto -->
\t- **last-activity:** x <!-- auto -->
\t<!-- session: sess-xyz -->
`;
  writeFileSync(dashboardPath, dashboard);

  const origHome = process.env.HOME;
  process.env.HOME = home;
  try {
    runUpdate({ vault_path: vault, dashboard_file: 'Dashboard.md' });
  } finally {
    process.env.HOME = origHome;
  }

  const after = readFileSync(dashboardPath, 'utf8');
  const activeIdx = after.indexOf('🟢');
  const waitingIdx = after.indexOf('🟡');
  const cardIdx = after.indexOf('proj / t1');
  assert.ok(cardIdx > activeIdx && cardIdx < waitingIdx, 'card should be in 🟢');
});

test('runUpdate: moves card without session to 🟡 when state is waiting via cwd fallback', () => {
  const home = mkdtempSync(join(tmpdir(), 'panorama-home-'));
  const vault = mkdtempSync(join(tmpdir(), 'panorama-vault-'));
  const dashboardPath = join(vault, 'Dashboard.md');

  const stateDir = join(home, '.config/panorama/states');
  mkdirSync(stateDir, { recursive: true });
  const ts = Math.floor(Date.now() / 1000);
  writeFileSync(join(stateDir, 'sess-abc.json'), JSON.stringify({
    state: 'waiting', timestamp: ts, session_id: 'sess-abc', cwd: '/nowhere',
  }));

  const dashboard = `## 🟢 対応中

- **proj / t1**
\t- **path:** /nowhere
\t- **last-commit:** x <!-- auto -->
\t- **last-activity:** x <!-- auto -->

## 🟡 入力待ち
`;
  writeFileSync(dashboardPath, dashboard);

  const origHome = process.env.HOME;
  process.env.HOME = home;
  try {
    runUpdate({ vault_path: vault, dashboard_file: 'Dashboard.md' });
  } finally {
    process.env.HOME = origHome;
  }

  const after = readFileSync(dashboardPath, 'utf8');
  const waitingIdx = after.indexOf('🟡');
  const cardIdx = after.indexOf('proj / t1');
  assert.ok(cardIdx > waitingIdx, 'card should have moved to 🟡');
});

test('runUpdate: card with no matching state is untouched', () => {
  const home = mkdtempSync(join(tmpdir(), 'panorama-home-'));
  const vault = mkdtempSync(join(tmpdir(), 'panorama-vault-'));
  const dashboardPath = join(vault, 'Dashboard.md');
  mkdirSync(join(home, '.config/panorama/states'), { recursive: true });

  const dashboard = `## 🟢 対応中

- **proj / t1**
\t- **path:** /nowhere
\t- **last-commit:** x <!-- auto -->
\t- **last-activity:** x <!-- auto -->

## 🟡 入力待ち
`;
  writeFileSync(dashboardPath, dashboard);

  const origHome = process.env.HOME;
  process.env.HOME = home;
  try {
    runUpdate({ vault_path: vault, dashboard_file: 'Dashboard.md' });
  } finally {
    process.env.HOME = origHome;
  }

  const after = readFileSync(dashboardPath, 'utf8');
  // Card should still be under 🟢 where we placed it
  const activeIdx = after.indexOf('🟢');
  const waitingIdx = after.indexOf('🟡');
  const cardIdx = after.indexOf('proj / t1');
  assert.ok(cardIdx > activeIdx && cardIdx < waitingIdx);
});
```

- [ ] **Step 2: テスト実行 → 失敗確認**

Run: `node --test tests/update.test.js`
Expected: state ファイルを正しく読まない（path キーを探している旧ロジック）ので FAIL。

- [ ] **Step 3: `src/lib/tmux.js` から `readHookState` と `STATE_DIR` と `DEFAULT_IDLE_THRESHOLD_SEC` 定数を削除**

51-78 行目（readHookState 関数）と 48 行目（STATE_DIR）、49 行目（DEFAULT_IDLE_THRESHOLD_SEC）を削除。先頭の import は Task 3 ですでに整理済み。

- [ ] **Step 4: `src/update.js` の import を差し替え**

`src/update.js:8` を:

```javascript
import { listPanes, loadAllHookStates, resolveCardState, detectClaudeCodeState } from './lib/tmux.js';
```

- [ ] **Step 5: `buildColumnTransitions` と `runUpdate` を新 API に合わせて書き換え**

`src/update.js:51-77` の `buildColumnTransitions` を:

```javascript
function buildColumnTransitions(cards, columns, indices) {
  const moves = [];
  for (const card of cards) {
    const currentCol = getCardColumn(card, columns);
    if (!currentCol) continue;

    const inAutoCol = AUTO_COLUMNS.some(c => currentCol.heading.includes(c.slice(3)));
    if (!inAutoCol) continue;

    const hookState = resolveCardState(card, indices);
    const state = detectClaudeCodeState(hookState);
    if (state === null) continue;

    const destCol = targetColumnFor(state);
    if (!destCol) continue;

    const alreadyInDest = currentCol.heading.includes(destCol.slice(3));
    if (alreadyInDest) continue;

    moves.push({ card, targetHeading: destCol });
  }
  return moves;
}
```

`runUpdate` (79-105 行目) を:

```javascript
export function runUpdate(config) {
  const dashboardPath = join(config.vault_path, config.dashboard_file);
  const text = readFileSync(dashboardPath, 'utf8');
  let lines = text.split(/\r?\n/);
  const cards = splitCards(text);

  // Phase 1: auto field updates
  for (const card of cards) {
    const updates = buildCardUpdates(card);
    applyUpdatesToLines(lines, card, updates);
  }

  // Phase 2: column transitions
  const indices = loadAllHookStates();
  const MAX_MOVES = 10;
  for (let i = 0; i < MAX_MOVES; i++) {
    const currentCards = splitCards(lines.join('\n'));
    const currentColumns = findColumns(lines);
    const moves = buildColumnTransitions(currentCards, currentColumns, indices);
    if (moves.length === 0) break;
    lines = moveCard(lines, moves[0].card, moves[0].targetHeading);
  }

  writeFileSync(dashboardPath, lines.join('\n'));
}
```

`listPanes` 呼び出しは削除（state 遷移には不要）。`listPanes` 自体は classifyAlive 用で残すが、`runUpdate` では参照しない。

また `import { execFileSync } from 'node:child_process';` は使っていないので削除。

- [ ] **Step 6: `tests/tmux.test.js` から `readHookState` テスト削除**

Run: `grep -n readHookState tests/tmux.test.js`
該当行があれば削除。`readHookState` を参照するテストブロックを丸ごと削除。

- [ ] **Step 7: 全テスト実行**

Run: `node --test`
Expected: 全 PASS。旧 detect-state (stale→waiting 前提) のテストケースは Task 2 ですでに置換済み。

- [ ] **Step 8: commit**

```bash
git add src/lib/tmux.js src/update.js tests/tmux.test.js tests/update.test.js
git commit -m "refactor(update): use loadAllHookStates/resolveCardState, drop readHookState"
```

---

## Task 6: install.sh に hooks コピーと 5 種類の hook idempotent 追加

**Files:**
- Modify: `install.sh`
- Modify: `skill/uninstall.sh` (if exists; check later)

- [ ] **Step 1: 現状の hook 登録ブロック確認**

Run: `sed -n '69,92p' install.sh`
確認: PreToolUse 単発登録、grep による重複チェック。

- [ ] **Step 2: `install.sh` の依存チェックに `jq` を追加**

17 行目の `for bin in node git tmux launchctl; do` を:

```bash
for bin in node git tmux launchctl jq; do
```

- [ ] **Step 3: hook ディレクトリコピー処理を追加**

25 行目の `mkdir -p "$CONFIG_DIR" "$CONFIG_DIR/states"` の直後に追加:

```bash
# 2.5. hooks ディレクトリを ~/.local/share/panorama/hooks/ にコピー
HOOKS_DEST="$HOME/.local/share/panorama/hooks"
mkdir -p "$HOOKS_DEST"
cp -f "$REPO_DIR/hooks/notify-state.sh" "$HOOKS_DEST/notify-state.sh"
chmod +x "$HOOKS_DEST/notify-state.sh"
echo "Installed hook to $HOOKS_DEST/notify-state.sh"
```

- [ ] **Step 4: 旧 state ファイルをクリーンアップ**

「2.5」の直後に追加:

```bash
# 2.6. 旧 state ファイル（path ベース）をクリーンアップ
STATE_DIR="$CONFIG_DIR/states"
for f in "$STATE_DIR"/*.json; do
  [ -f "$f" ] || continue
  # session_id フィールドが無い旧形式を検出して削除
  if ! jq -e '.session_id' "$f" >/dev/null 2>&1; then
    rm -f "$f"
    echo "Removed legacy state file: $(basename "$f")"
  fi
done
```

- [ ] **Step 5: 既存の hook 登録ブロック (69-92 行目) を全面書き換え**

```bash
# 7. Claude Code hook 登録
SETTINGS_FILE="$HOME/.claude/settings.json"
HOOK_CMD_ACTIVE="$HOOKS_DEST/notify-state.sh active"
HOOK_CMD_WAITING="$HOOKS_DEST/notify-state.sh waiting"

ensure_hook() {
  local event="$1"
  local cmd="$2"
  local settings="$3"

  # 既に同 command が event 配下に登録されていればスキップ
  local existing
  existing=$(jq -r --arg evt "$event" --arg cmd "$cmd" \
    '(.hooks[$evt] // [])
     | map(.hooks // [] | map(.command))
     | flatten
     | map(select(. == $cmd))
     | length' "$settings" 2>/dev/null || echo "0")
  if [ "$existing" != "0" ]; then
    echo "  $event hook already registered"
    return 0
  fi

  local tmp
  tmp=$(mktemp)
  jq --arg evt "$event" --arg cmd "$cmd" \
    '.hooks[$evt] = ((.hooks[$evt] // []) + [{"hooks":[{"type":"command","command":$cmd}]}])' \
    "$settings" > "$tmp" && mv "$tmp" "$settings"
  echo "  Registered $event hook"
}

if [ -f "$SETTINGS_FILE" ]; then
  ensure_hook "UserPromptSubmit" "$HOOK_CMD_ACTIVE"  "$SETTINGS_FILE"
  ensure_hook "PreToolUse"       "$HOOK_CMD_ACTIVE"  "$SETTINGS_FILE"
  ensure_hook "PostToolUse"      "$HOOK_CMD_ACTIVE"  "$SETTINGS_FILE"
  ensure_hook "Stop"             "$HOOK_CMD_WAITING" "$SETTINGS_FILE"
  ensure_hook "Notification"     "$HOOK_CMD_WAITING" "$SETTINGS_FILE"
else
  echo "NOTE: $SETTINGS_FILE not found. Skipping hook registration."
fi
```

- [ ] **Step 6: 古い PreToolUse 登録（旧 REPO_DIR パス）をクリーンアップ**

Step 5 のブロックの前に追加:

```bash
# 7a. 旧 hook 登録（REPO_DIR パス直接、notify-state.sh 検索）をクリーンアップ
if [ -f "$SETTINGS_FILE" ]; then
  tmp=$(mktemp)
  jq --arg old "$REPO_DIR/hooks/notify-state.sh" \
     '.hooks |= (to_entries | map(
        .value |= (
          map(.hooks |= map(select((.command // "") | (startswith($old + " ") | not))))
          | map(select((.hooks // []) | length > 0))
        )
      ) | from_entries)' \
     "$SETTINGS_FILE" > "$tmp" && mv "$tmp" "$SETTINGS_FILE"
fi
```

- [ ] **Step 7: install.sh を手動実行して確認**

Run: `bash install.sh`
Expected:
- `jq` チェック通過
- `Installed hook to ~/.local/share/panorama/hooks/notify-state.sh`
- 5 種類の hook が登録される、もしくは既存なら "already registered"

Verify:
```bash
jq '.hooks | keys' ~/.claude/settings.json
```
Expected: `["Notification","PostToolUse","PreToolUse","SessionStart","Stop","UserPromptSubmit"]` （SessionStart は gstack のもの）

- [ ] **Step 8: commit**

```bash
git add install.sh
git commit -m "chore(install): copy hooks dir, register 5 hook types idempotently, cleanup legacy"
```

---

## Task 7: doctor に jq + hooks path チェックを追加

**Files:**
- Modify: `bin/panorama:47-63`
- Modify: `tests/cli.test.js`

- [ ] **Step 1: `tests/cli.test.js` の doctor テストを更新**

現在のテスト (23-27 行目) を:

```javascript
test('pano doctor: exits 0 when all required bins and files exist', () => {
  const out = execFileSync('node', [CLI, 'doctor'], { encoding: 'utf8' });
  assert.match(out, /node:\s+OK/);
  assert.match(out, /git:\s+OK/);
  assert.match(out, /jq:\s+/);      // OK もしくは MISSING
  assert.match(out, /hooks:\s+/);   // OK もしくは MISSING
});
```

- [ ] **Step 2: テスト実行 → 失敗確認**

Run: `node --test tests/cli.test.js`
Expected: `jq:` や `hooks:` 出力がないので FAIL。

- [ ] **Step 3: `bin/panorama` の cmdDoctor を更新**

47-63 行目を:

```javascript
function cmdDoctor() {
  const checks = [
    ['node', checkBin('node')],
    ['git', checkBin('git')],
    ['tmux', checkBin('tmux')],
    ['jq', checkBin('jq')],
  ];
  let allOk = true;
  for (const [name, ok] of checks) {
    console.log(`${name}:  ${ok ? 'OK' : 'MISSING'}`);
    if (!ok && name !== 'tmux') allOk = false;
  }
  const cfgPath = defaultConfigPath();
  console.log(`config:  ${existsSync(cfgPath) ? 'OK' : 'MISSING'} (${cfgPath})`);

  const hookPath = join(homedir(), '.local/share/panorama/hooks/notify-state.sh');
  const hookOk = existsSync(hookPath);
  console.log(`hooks:   ${hookOk ? 'OK' : 'MISSING'} (${hookPath})`);
  if (!hookOk) allOk = false;

  const launchdPlist = join(homedir(), 'Library/LaunchAgents/com.user.panorama.plist');
  console.log(`launchd: ${existsSync(launchdPlist) ? 'OK' : 'MISSING'} (${launchdPlist})`);

  const settingsPath = join(homedir(), '.claude/settings.json');
  if (existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
      const required = ['UserPromptSubmit','PreToolUse','PostToolUse','Stop','Notification'];
      const missing = required.filter(evt => {
        const arr = settings.hooks && settings.hooks[evt];
        if (!Array.isArray(arr)) return true;
        return !arr.some(g => (g.hooks || []).some(h => (h.command || '').includes('notify-state.sh')));
      });
      console.log(`claude hooks: ${missing.length === 0 ? 'OK' : `MISSING (${missing.join(',')})`}`);
      if (missing.length > 0) allOk = false;
    } catch {
      console.log(`claude hooks: UNREADABLE`);
      allOk = false;
    }
  } else {
    console.log(`claude hooks: SETTINGS MISSING`);
  }

  process.exit(allOk ? 0 : 1);
}
```

`bin/panorama` 先頭の import に `readFileSync` を追加:

現行 4 行目:
```javascript
import { existsSync } from 'node:fs';
```
を:
```javascript
import { existsSync, readFileSync } from 'node:fs';
```

- [ ] **Step 4: テスト実行 → pass 確認**

Run: `node --test tests/cli.test.js`
Expected: PASS。

- [ ] **Step 5: 全テスト実行**

Run: `node --test`
Expected: 全 PASS。

- [ ] **Step 6: commit**

```bash
git add bin/panorama tests/cli.test.js
git commit -m "feat(doctor): add jq, hooks path, and claude settings hook checks"
```

---

## Task 8: エンドツーエンド手動動作確認

**Files:** なし（実環境確認のみ）

- [ ] **Step 1: 旧 state ファイル削除と再インストール**

```bash
rm -rf ~/.config/panorama/states/*
bash install.sh
```

Expected:
- `jq: OK`
- `Installed hook to ~/.local/share/panorama/hooks/notify-state.sh`
- 5 種類の hook が追加される（既存なら "already registered"）

- [ ] **Step 2: doctor 確認**

Run: `panorama doctor`
Expected: node/git/jq/hooks/claude hooks すべて OK、exit 0。

- [ ] **Step 3: hook 発火確認**

新しい Claude Code セッションで何かツールを実行（例: `pwd` bash）。

Run:
```bash
ls ~/.config/panorama/states/*.json | head
cat ~/.config/panorama/states/$(ls -t ~/.config/panorama/states/ | head -1)
```

Expected: セッション ID のファイルが生成され、`state: "active"` になっている。

- [ ] **Step 4: Stop 発火確認**

Claude の返答を待って、返答完了後すぐ:

Run: `cat ~/.config/panorama/states/<session-id>.json`
Expected: `state: "waiting"`。

- [ ] **Step 5: Dashboard 遷移確認**

Obsidian の Dashboard.md を開き、自セッションのカードが 🟢 ⇔ 🟡 で追従するか 1-2 分観察。

- [ ] **Step 6: worktree 確認**

worktree 配下で新規 Claude セッションを起動（例: `cd .worktrees/some-branch && claude`）。カードは main repo の path を指しているが、session ID 一致で 🟢 に追従するか確認。

- [ ] **Step 7: 成功ならクリーンアップと最終 commit**

手動確認で問題なければ既に commit 済みなので追加 commit なし。確認ログを PR 説明にまとめる用に記録。

---

## Self-review

**Spec coverage:**

- [x] Stop hook 発火（Task 6 settings 登録）
- [x] Notification hook 追加（Task 6）
- [x] UserPromptSubmit / PostToolUse hook 追加（Task 6）
- [x] session_id キー state ファイル（Task 1）
- [x] atomic write（Task 1）
- [x] fail-open（Task 1）
- [x] jq -n --arg エスケープ（Task 1）
- [x] session_id バリデーション（Task 1）
- [x] loadAllHookStates（Task 3）
- [x] resolveCardState（Task 4）
- [x] detectClaudeCodeState の stale → null + ホワイトリスト（Task 2）
- [x] install.sh hooks dir コピー（Task 6）
- [x] install.sh 5 種類 idempotent（Task 6）
- [x] 旧 state クリーンアップ（Task 6）
- [x] doctor に jq/hooks/claude settings チェック（Task 7）
- [x] テスト追加（各 Task 内）
- [x] 手動動作確認（Task 8）

**Placeholder scan:** TBD/TODO 無し、"similar to" 無し、全ステップに具体コード or コマンド。

**Type consistency:** `loadAllHookStates` は `{ bySession: Map, byCwd: Map<string, Array> }`、`resolveCardState` はそれを受けて state オブジェクト返却。`detectClaudeCodeState` は state オブジェクト → `'active' | 'waiting' | null`。各 Task で一貫。

---

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 1 | clean | spec review incorporated (13 issues, all resolved in spec revision) |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 0 | — | — |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

**VERDICT:** spec-level codex review done. For plan-level reviews, run `/plan-eng-review` if desired before execution.
