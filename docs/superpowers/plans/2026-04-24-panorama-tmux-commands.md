# panorama create/attach Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 既存 `bin/panorama` Node.js CLI に `create` / `attach` サブコマンドを追加し、tmux セッションの作成と (対話ピッカー付き) attach を可能にする。

**Architecture:** tmux 呼び出しは `src/lib/tmux-session.js` にラッパー関数として分離。対話ピッカーは `src/lib/picker.js` に汎用ユーティリティとして実装 (readline + ANSI エスケープ、追加依存なし)。各サブコマンドは `src/commands/{create,attach}.js` に本体を置き、`bin/panorama` は薄いディスパッチャのまま保つ。既存 `src/lib/tmux.js` は updater 用で別責務のため分離する。

**Tech Stack:** Node.js 18+ (ESM, `node --test`), `child_process` (execFileSync / spawnSync), stdin raw mode + ANSI escape sequences for picker.

**Spec:** `docs/superpowers/specs/2026-04-24-panorama-tmux-commands-design.md`

---

## File Structure

**Create:**
- `src/lib/tmux-session.js` — tmux セッション管理ラッパー
- `src/lib/picker.js` — 矢印キー対話ピッカー
- `src/commands/create.js` — `panorama create` 実装
- `src/commands/attach.js` — `panorama attach` 実装
- `tests/tmux-session.test.js`
- `tests/picker.test.js`
- `tests/create.test.js`
- `tests/attach.test.js`

**Modify:**
- `bin/panorama` — ディスパッチャに `create` / `attach` を追加
- `README.md` — 新サブコマンドの使い方を追記

---

### Task 1: tmux-session.js の基礎関数 (isTmuxAvailable / isInsideTmux / hasSession)

**Files:**
- Create: `src/lib/tmux-session.js`
- Test: `tests/tmux-session.test.js`

- [ ] **Step 1: テスト作成** (`tests/tmux-session.test.js`)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isInsideTmux } from '../src/lib/tmux-session.js';

test('isInsideTmux: true when $TMUX is set', () => {
  const original = process.env.TMUX;
  process.env.TMUX = '/tmp/tmux-1000/default,12345,0';
  try {
    assert.equal(isInsideTmux(), true);
  } finally {
    if (original === undefined) delete process.env.TMUX;
    else process.env.TMUX = original;
  }
});

test('isInsideTmux: false when $TMUX is unset', () => {
  const original = process.env.TMUX;
  delete process.env.TMUX;
  try {
    assert.equal(isInsideTmux(), false);
  } finally {
    if (original !== undefined) process.env.TMUX = original;
  }
});

test('isInsideTmux: false when $TMUX is empty string', () => {
  const original = process.env.TMUX;
  process.env.TMUX = '';
  try {
    assert.equal(isInsideTmux(), false);
  } finally {
    if (original === undefined) delete process.env.TMUX;
    else process.env.TMUX = original;
  }
});
```

- [ ] **Step 2: 失敗確認**

Run: `node --test tests/tmux-session.test.js`
Expected: FAIL (`Cannot find module '../src/lib/tmux-session.js'`)

- [ ] **Step 3: 最小実装**

`src/lib/tmux-session.js`:

```js
import { execFileSync } from 'node:child_process';

export function isTmuxAvailable() {
  try {
    execFileSync('tmux', ['-V'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function isInsideTmux() {
  return !!process.env.TMUX;
}

export function hasSession(name) {
  try {
    execFileSync('tmux', ['has-session', '-t', `=${name}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
```

注: `has-session -t =<name>` の `=` プレフィックスは正確名前一致を指定 (prefix match 回避)。

- [ ] **Step 4: パス確認**

Run: `node --test tests/tmux-session.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: コミット**

```bash
git add src/lib/tmux-session.js tests/tmux-session.test.js
git commit -m "feat(cli): add tmux-session basics (isTmuxAvailable, isInsideTmux, hasSession)"
```

---

### Task 2: listSessions + parseSessionsOutput

**Files:**
- Modify: `src/lib/tmux-session.js`
- Modify: `tests/tmux-session.test.js`

- [ ] **Step 1: テスト追加** (`tests/tmux-session.test.js` の末尾に追加)

```js
import { parseSessionsOutput } from '../src/lib/tmux-session.js';

test('parseSessionsOutput: empty string returns []', () => {
  assert.deepEqual(parseSessionsOutput(''), []);
});

test('parseSessionsOutput: single detached session', () => {
  const stdout = 'main\t3\t0\n';
  assert.deepEqual(parseSessionsOutput(stdout), [
    { name: 'main', windows: 3, attached: false },
  ]);
});

test('parseSessionsOutput: multiple sessions, mixed attached', () => {
  const stdout = 'main\t3\t1\nfeature-xyz\t1\t0\nreview\t2\t1\n';
  assert.deepEqual(parseSessionsOutput(stdout), [
    { name: 'main', windows: 3, attached: true },
    { name: 'feature-xyz', windows: 1, attached: false },
    { name: 'review', windows: 2, attached: true },
  ]);
});

test('parseSessionsOutput: skips malformed lines', () => {
  const stdout = 'good\t1\t0\nbad-line\nalso-good\t2\t1\n';
  assert.deepEqual(parseSessionsOutput(stdout), [
    { name: 'good', windows: 1, attached: false },
    { name: 'also-good', windows: 2, attached: true },
  ]);
});

test('parseSessionsOutput: session name with spaces/dashes', () => {
  const stdout = 'my-session\t1\t0\nanother_name\t2\t1\n';
  assert.deepEqual(parseSessionsOutput(stdout), [
    { name: 'my-session', windows: 1, attached: false },
    { name: 'another_name', windows: 2, attached: true },
  ]);
});
```

- [ ] **Step 2: 失敗確認**

Run: `node --test tests/tmux-session.test.js`
Expected: FAIL (`parseSessionsOutput is not a function`)

- [ ] **Step 3: 実装追加**

`src/lib/tmux-session.js` に追記:

```js
export function parseSessionsOutput(stdout) {
  return stdout
    .split(/\r?\n/)
    .filter(line => line.length > 0)
    .map(line => {
      const parts = line.split('\t');
      if (parts.length !== 3) return null;
      const [name, windowsStr, attachedStr] = parts;
      const windows = Number(windowsStr);
      if (!Number.isInteger(windows)) return null;
      if (attachedStr !== '0' && attachedStr !== '1') return null;
      return { name, windows, attached: attachedStr === '1' };
    })
    .filter(Boolean);
}

export function listSessions() {
  try {
    const out = execFileSync(
      'tmux',
      ['list-sessions', '-F', '#{session_name}\t#{session_windows}\t#{?session_attached,1,0}'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    );
    return parseSessionsOutput(out);
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: パス確認**

Run: `node --test tests/tmux-session.test.js`
Expected: PASS (8 tests total)

- [ ] **Step 5: コミット**

```bash
git add src/lib/tmux-session.js tests/tmux-session.test.js
git commit -m "feat(cli): add listSessions and parseSessionsOutput"
```

---

### Task 3: createSession + renameWindow

**Files:**
- Modify: `src/lib/tmux-session.js`

これらは execFileSync を呼ぶだけで、純粋関数テストは困難。E2E で検証するため、最小限の実装に留める。

- [ ] **Step 1: 実装追加**

`src/lib/tmux-session.js` に追記:

```js
export function createSession(name, cwd) {
  execFileSync('tmux', ['new-session', '-d', '-s', name, '-c', cwd], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
}

export function renameWindow(session, windowName) {
  execFileSync('tmux', ['rename-window', '-t', `${session}:`, windowName], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
}
```

注: `-t <session>:` は session の現在ウィンドウを指す (インデックス未指定)。createSession 直後は window が1つなのでこれで OK。

- [ ] **Step 2: 手動検証**

```bash
node -e "import('./src/lib/tmux-session.js').then(m => { m.createSession('panorama-test-xyz', process.cwd()); m.renameWindow('panorama-test-xyz', 'test-window'); console.log('created'); })"
tmux list-sessions | grep panorama-test-xyz
tmux list-windows -t panorama-test-xyz
tmux kill-session -t panorama-test-xyz
```

Expected: セッションが作成され、ウィンドウ名が `test-window` になる。

- [ ] **Step 3: コミット**

```bash
git add src/lib/tmux-session.js
git commit -m "feat(cli): add createSession and renameWindow"
```

---

### Task 4: attachOrSwitch

**Files:**
- Modify: `src/lib/tmux-session.js`

- [ ] **Step 1: 実装追加**

`src/lib/tmux-session.js` の先頭 import を更新:

```js
import { execFileSync, spawnSync } from 'node:child_process';
```

末尾に追記:

```js
export function attachOrSwitch(name) {
  if (isInsideTmux()) {
    execFileSync('tmux', ['switch-client', '-t', name], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    return 0;
  }
  const result = spawnSync('tmux', ['attach', '-t', name], {
    stdio: 'inherit',
  });
  return result.status ?? 1;
}
```

- [ ] **Step 2: 手動検証 (tmux 外から)**

新しいターミナル (tmux 外) を開き、リポジトリで実行:

```bash
# 事前にテスト用セッション作成
tmux new-session -d -s panorama-attach-test -c "$(pwd)"

# attach テスト
node -e "import('./src/lib/tmux-session.js').then(m => { process.exit(m.attachOrSwitch('panorama-attach-test')); })"
# tmux に入る → Ctrl-b d でデタッチ

# クリーンアップ
tmux kill-session -t panorama-attach-test
```

Expected: tmux に入れる、デタッチで node が exit 0 で終了。

- [ ] **Step 3: コミット**

```bash
git add src/lib/tmux-session.js
git commit -m "feat(cli): add attachOrSwitch with inside/outside tmux branching"
```

---

### Task 5: picker.js 基礎 (純粋関数部分)

**Files:**
- Create: `src/lib/picker.js`
- Test: `tests/picker.test.js`

Picker 全体の対話処理はテスト困難なので、内部のキー入力解釈ロジックを純粋関数として切り出してテストする。

- [ ] **Step 1: テスト作成** (`tests/picker.test.js`)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpretKey, clampIndex } from '../src/lib/picker.js';

test('interpretKey: arrow up', () => {
  assert.equal(interpretKey('\x1b[A'), 'up');
});

test('interpretKey: arrow down', () => {
  assert.equal(interpretKey('\x1b[B'), 'down');
});

test('interpretKey: k -> up', () => {
  assert.equal(interpretKey('k'), 'up');
});

test('interpretKey: j -> down', () => {
  assert.equal(interpretKey('j'), 'down');
});

test('interpretKey: Enter (\\r)', () => {
  assert.equal(interpretKey('\r'), 'select');
});

test('interpretKey: Enter (\\n)', () => {
  assert.equal(interpretKey('\n'), 'select');
});

test('interpretKey: q -> quit', () => {
  assert.equal(interpretKey('q'), 'quit');
});

test('interpretKey: Esc alone -> quit', () => {
  assert.equal(interpretKey('\x1b'), 'quit');
});

test('interpretKey: Ctrl-C -> interrupt', () => {
  assert.equal(interpretKey('\x03'), 'interrupt');
});

test('interpretKey: unknown key returns null', () => {
  assert.equal(interpretKey('x'), null);
});

test('clampIndex: within range', () => {
  assert.equal(clampIndex(2, 5), 2);
});

test('clampIndex: negative -> 0', () => {
  assert.equal(clampIndex(-1, 5), 0);
});

test('clampIndex: too large -> length-1', () => {
  assert.equal(clampIndex(10, 5), 4);
});

test('clampIndex: length 0 -> 0', () => {
  assert.equal(clampIndex(0, 0), 0);
});
```

- [ ] **Step 2: 失敗確認**

Run: `node --test tests/picker.test.js`
Expected: FAIL

- [ ] **Step 3: 実装作成**

`src/lib/picker.js`:

```js
export function interpretKey(key) {
  if (key === '\x1b[A' || key === 'k') return 'up';
  if (key === '\x1b[B' || key === 'j') return 'down';
  if (key === '\r' || key === '\n') return 'select';
  if (key === 'q' || key === '\x1b') return 'quit';
  if (key === '\x03') return 'interrupt';
  return null;
}

export function clampIndex(index, length) {
  if (length <= 0) return 0;
  if (index < 0) return 0;
  if (index >= length) return length - 1;
  return index;
}
```

- [ ] **Step 4: パス確認**

Run: `node --test tests/picker.test.js`
Expected: PASS (13 tests)

- [ ] **Step 5: コミット**

```bash
git add src/lib/picker.js tests/picker.test.js
git commit -m "feat(cli): add picker key interpretation and index clamping"
```

---

### Task 6: picker.js 対話ループ (pick 関数)

**Files:**
- Modify: `src/lib/picker.js`

対話ループ本体は手動検証 (非 TTY 分岐のみテスト可能)。

- [ ] **Step 1: 非 TTY エラーテスト追加** (`tests/picker.test.js` 末尾)

```js
import { pick } from '../src/lib/picker.js';

test('pick: throws on non-TTY stdin', async () => {
  const fakeStdin = { isTTY: false };
  await assert.rejects(
    () => pick({ items: ['a', 'b'], header: 'Select', stdin: fakeStdin, stdout: process.stdout }),
    /not a tty/i
  );
});

test('pick: throws on empty items', async () => {
  const fakeStdin = { isTTY: true };
  await assert.rejects(
    () => pick({ items: [], header: 'Select', stdin: fakeStdin, stdout: process.stdout }),
    /no items/i
  );
});
```

- [ ] **Step 2: 失敗確認**

Run: `node --test tests/picker.test.js`
Expected: FAIL (`pick is not a function`)

- [ ] **Step 3: pick 実装**

`src/lib/picker.js` の末尾に追加:

```js
/**
 * 矢印キー対話ピッカー。
 * @param {object} opts
 * @param {string[]} opts.items
 * @param {string} opts.header
 * @param {number} [opts.initialIndex=0]
 * @param {NodeJS.ReadStream} [opts.stdin=process.stdin]
 * @param {NodeJS.WriteStream} [opts.stdout=process.stdout]
 * @returns {Promise<number|null>} 選択 index、キャンセル時は null、interrupt 時は例外
 */
export function pick({
  items,
  header,
  initialIndex = 0,
  stdin = process.stdin,
  stdout = process.stdout,
}) {
  if (!Array.isArray(items) || items.length === 0) {
    return Promise.reject(new Error('picker: no items to select'));
  }
  if (!stdin.isTTY) {
    return Promise.reject(new Error('picker: not a tty'));
  }

  let index = clampIndex(initialIndex, items.length);
  const ALT_SCREEN_ON = '\x1b[?1049h';
  const ALT_SCREEN_OFF = '\x1b[?1049l';
  const CURSOR_HIDE = '\x1b[?25l';
  const CURSOR_SHOW = '\x1b[?25h';
  const CLEAR_SCREEN = '\x1b[2J\x1b[H';

  const render = () => {
    stdout.write(CLEAR_SCREEN);
    stdout.write(`${header}\n\n`);
    for (let i = 0; i < items.length; i++) {
      const prefix = i === index ? '> ' : '  ';
      stdout.write(`${prefix}${items[i]}\n`);
    }
  };

  const cleanup = () => {
    stdin.setRawMode?.(false);
    stdin.pause();
    stdout.write(CURSOR_SHOW);
    stdout.write(ALT_SCREEN_OFF);
  };

  return new Promise((resolve, reject) => {
    let resolved = false;
    const finish = (value, err) => {
      if (resolved) return;
      resolved = true;
      stdin.removeListener('data', onData);
      cleanup();
      if (err) reject(err);
      else resolve(value);
    };

    const onData = (chunk) => {
      const key = chunk.toString('utf8');
      const action = interpretKey(key);
      if (action === 'up') {
        index = clampIndex(index - 1, items.length);
        render();
      } else if (action === 'down') {
        index = clampIndex(index + 1, items.length);
        render();
      } else if (action === 'select') {
        finish(index);
      } else if (action === 'quit') {
        finish(null);
      } else if (action === 'interrupt') {
        finish(null, Object.assign(new Error('interrupted'), { code: 'SIGINT' }));
      }
    };

    stdout.write(ALT_SCREEN_ON);
    stdout.write(CURSOR_HIDE);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    render();
    stdin.on('data', onData);

    const onExit = () => cleanup();
    process.once('exit', onExit);
  });
}
```

- [ ] **Step 4: パス確認**

Run: `node --test tests/picker.test.js`
Expected: PASS (15 tests total)

- [ ] **Step 5: 手動検証**

```bash
node -e "
import('./src/lib/picker.js').then(async m => {
  const idx = await m.pick({ items: ['one', 'two', 'three'], header: 'Pick one' });
  console.log('selected:', idx);
});
"
```

Expected: alternate screen に項目表示、↑/↓ で選択、Enter で index を返す、q で null を返す。

- [ ] **Step 6: コミット**

```bash
git add src/lib/picker.js tests/picker.test.js
git commit -m "feat(cli): add interactive pick() with arrow key navigation"
```

---

### Task 7: commands/create.js

**Files:**
- Create: `src/commands/create.js`
- Test: `tests/create.test.js`

- [ ] **Step 1: テスト作成** (`tests/create.test.js`)

create.js は tmux-session.js の関数を呼ぶだけなので、依存注入で mock してテストする。

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCreate } from '../src/commands/create.js';

function makeFakeTmux(overrides = {}) {
  const calls = [];
  return {
    calls,
    isTmuxAvailable: () => true,
    hasSession: (name) => !!overrides.existing?.includes(name),
    createSession: (name, cwd) => { calls.push(['createSession', name, cwd]); },
    renameWindow: (session, windowName) => { calls.push(['renameWindow', session, windowName]); },
    attachOrSwitch: (name) => { calls.push(['attachOrSwitch', name]); return 0; },
    ...overrides,
  };
}

test('runCreate: returns 2 when no session name', async () => {
  const tmux = makeFakeTmux();
  const exit = await runCreate({ args: [], tmux, cwd: '/tmp', stderr: { write: () => {} } });
  assert.equal(exit, 2);
});

test('runCreate: returns 1 when tmux not available', async () => {
  const tmux = makeFakeTmux({ isTmuxAvailable: () => false });
  const messages = [];
  const exit = await runCreate({
    args: ['foo'],
    tmux,
    cwd: '/tmp',
    stderr: { write: (s) => messages.push(s) },
  });
  assert.equal(exit, 1);
  assert.match(messages.join(''), /tmux not found/);
});

test('runCreate: returns 1 when session already exists', async () => {
  const tmux = makeFakeTmux({ existing: ['foo'] });
  const messages = [];
  const exit = await runCreate({
    args: ['foo'],
    tmux,
    cwd: '/tmp',
    stderr: { write: (s) => messages.push(s) },
  });
  assert.equal(exit, 1);
  assert.match(messages.join(''), /already exists/);
});

test('runCreate: creates session and attaches with default window name', async () => {
  const tmux = makeFakeTmux();
  const exit = await runCreate({
    args: ['foo'],
    tmux,
    cwd: '/tmp/work',
    stderr: { write: () => {} },
  });
  assert.equal(exit, 0);
  assert.deepEqual(tmux.calls, [
    ['createSession', 'foo', '/tmp/work'],
    ['renameWindow', 'foo', 'foo'],
    ['attachOrSwitch', 'foo'],
  ]);
});

test('runCreate: --task overrides window name', async () => {
  const tmux = makeFakeTmux();
  const exit = await runCreate({
    args: ['foo', '--task', 'my task'],
    tmux,
    cwd: '/tmp/work',
    stderr: { write: () => {} },
  });
  assert.equal(exit, 0);
  assert.deepEqual(tmux.calls, [
    ['createSession', 'foo', '/tmp/work'],
    ['renameWindow', 'foo', 'my task'],
    ['attachOrSwitch', 'foo'],
  ]);
});

test('runCreate: --task with no value returns 2', async () => {
  const tmux = makeFakeTmux();
  const exit = await runCreate({
    args: ['foo', '--task'],
    tmux,
    cwd: '/tmp',
    stderr: { write: () => {} },
  });
  assert.equal(exit, 2);
});
```

- [ ] **Step 2: 失敗確認**

Run: `node --test tests/create.test.js`
Expected: FAIL (`Cannot find module`)

- [ ] **Step 3: 実装作成**

`src/commands/create.js`:

```js
import * as defaultTmux from '../lib/tmux-session.js';

function parseCreateArgs(args) {
  if (args.length === 0) return { error: 'missing session name' };
  const [name, ...rest] = args;
  let task = null;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--task') {
      const value = rest[i + 1];
      if (value === undefined) return { error: '--task requires a value' };
      task = value;
      i++;
    } else {
      return { error: `unknown argument: ${rest[i]}` };
    }
  }
  return { name, task };
}

export async function runCreate({
  args,
  tmux = defaultTmux,
  cwd = process.cwd(),
  stderr = process.stderr,
}) {
  const parsed = parseCreateArgs(args);
  if (parsed.error) {
    stderr.write(`panorama create: ${parsed.error}\n`);
    stderr.write('Usage: panorama create <session-name> [--task <name>]\n');
    return 2;
  }

  if (!tmux.isTmuxAvailable()) {
    stderr.write('panorama create: tmux not found\n');
    return 1;
  }

  if (tmux.hasSession(parsed.name)) {
    stderr.write(
      `panorama create: session '${parsed.name}' already exists. Use 'panorama attach ${parsed.name}' instead.\n`
    );
    return 1;
  }

  try {
    tmux.createSession(parsed.name, cwd);
    tmux.renameWindow(parsed.name, parsed.task ?? parsed.name);
    return tmux.attachOrSwitch(parsed.name);
  } catch (err) {
    stderr.write(`panorama create: ${err.message}\n`);
    return 1;
  }
}
```

- [ ] **Step 4: パス確認**

Run: `node --test tests/create.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: コミット**

```bash
git add src/commands/create.js tests/create.test.js
git commit -m "feat(cli): add 'panorama create' subcommand"
```

---

### Task 8: commands/attach.js

**Files:**
- Create: `src/commands/attach.js`
- Test: `tests/attach.test.js`

- [ ] **Step 1: テスト作成** (`tests/attach.test.js`)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAttach, formatSessionItem } from '../src/commands/attach.js';

test('formatSessionItem: single window, detached', () => {
  assert.equal(
    formatSessionItem({ name: 'main', windows: 1, attached: false }),
    'main          1 window'
  );
});

test('formatSessionItem: multiple windows, attached', () => {
  assert.equal(
    formatSessionItem({ name: 'feat', windows: 3, attached: true }),
    'feat          3 windows (attached)'
  );
});

function makeFakeTmux(overrides = {}) {
  const calls = [];
  return {
    calls,
    isTmuxAvailable: () => true,
    hasSession: (name) => !!overrides.existing?.includes(name),
    listSessions: () => overrides.sessions ?? [],
    attachOrSwitch: (name) => { calls.push(['attachOrSwitch', name]); return 0; },
    ...overrides,
  };
}

test('runAttach: returns 1 when tmux not available', async () => {
  const tmux = makeFakeTmux({ isTmuxAvailable: () => false });
  const messages = [];
  const exit = await runAttach({
    args: ['foo'],
    tmux,
    pick: async () => null,
    stderr: { write: (s) => messages.push(s) },
  });
  assert.equal(exit, 1);
  assert.match(messages.join(''), /tmux not found/);
});

test('runAttach: with name, session not found', async () => {
  const tmux = makeFakeTmux();
  const messages = [];
  const exit = await runAttach({
    args: ['foo'],
    tmux,
    pick: async () => null,
    stderr: { write: (s) => messages.push(s) },
  });
  assert.equal(exit, 1);
  assert.match(messages.join(''), /not found/);
});

test('runAttach: with name, attaches to existing session', async () => {
  const tmux = makeFakeTmux({ existing: ['foo'] });
  const exit = await runAttach({
    args: ['foo'],
    tmux,
    pick: async () => null,
    stderr: { write: () => {} },
  });
  assert.equal(exit, 0);
  assert.deepEqual(tmux.calls, [['attachOrSwitch', 'foo']]);
});

test('runAttach: no args, no sessions -> exit 1', async () => {
  const tmux = makeFakeTmux({ sessions: [] });
  const messages = [];
  const exit = await runAttach({
    args: [],
    tmux,
    pick: async () => null,
    stderr: { write: (s) => messages.push(s) },
  });
  assert.equal(exit, 1);
  assert.match(messages.join(''), /no tmux sessions/i);
});

test('runAttach: no args, picker cancelled -> exit 0', async () => {
  const tmux = makeFakeTmux({
    sessions: [{ name: 'a', windows: 1, attached: false }],
  });
  const exit = await runAttach({
    args: [],
    tmux,
    pick: async () => null,
    stderr: { write: () => {} },
  });
  assert.equal(exit, 0);
  assert.deepEqual(tmux.calls, []);
});

test('runAttach: no args, picker selects index -> attaches', async () => {
  const tmux = makeFakeTmux({
    sessions: [
      { name: 'a', windows: 1, attached: false },
      { name: 'b', windows: 2, attached: true },
    ],
  });
  const exit = await runAttach({
    args: [],
    tmux,
    pick: async () => 1,
    stderr: { write: () => {} },
  });
  assert.equal(exit, 0);
  assert.deepEqual(tmux.calls, [['attachOrSwitch', 'b']]);
});

test('runAttach: too many args -> exit 2', async () => {
  const tmux = makeFakeTmux();
  const exit = await runAttach({
    args: ['a', 'b'],
    tmux,
    pick: async () => null,
    stderr: { write: () => {} },
  });
  assert.equal(exit, 2);
});
```

- [ ] **Step 2: 失敗確認**

Run: `node --test tests/attach.test.js`
Expected: FAIL

- [ ] **Step 3: 実装作成**

`src/commands/attach.js`:

```js
import * as defaultTmux from '../lib/tmux-session.js';
import { pick as defaultPick } from '../lib/picker.js';

export function formatSessionItem(session) {
  const namePart = session.name.padEnd(12, ' ');
  const winLabel = session.windows === 1 ? 'window' : 'windows';
  const windowsPart = `${session.windows} ${winLabel}`;
  const attachedPart = session.attached ? ' (attached)' : '';
  return `${namePart}  ${windowsPart}${attachedPart}`;
}

export async function runAttach({
  args,
  tmux = defaultTmux,
  pick = defaultPick,
  stderr = process.stderr,
}) {
  if (args.length > 1) {
    stderr.write('panorama attach: too many arguments\n');
    stderr.write('Usage: panorama attach [<session-name>]\n');
    return 2;
  }

  if (!tmux.isTmuxAvailable()) {
    stderr.write('panorama attach: tmux not found\n');
    return 1;
  }

  if (args.length === 1) {
    const name = args[0];
    if (!tmux.hasSession(name)) {
      stderr.write(`panorama attach: session '${name}' not found\n`);
      return 1;
    }
    try {
      return tmux.attachOrSwitch(name);
    } catch (err) {
      stderr.write(`panorama attach: ${err.message}\n`);
      return 1;
    }
  }

  // No args: interactive picker
  const sessions = tmux.listSessions();
  if (sessions.length === 0) {
    stderr.write('panorama attach: no tmux sessions\n');
    return 1;
  }

  const items = sessions.map(formatSessionItem);
  let index;
  try {
    index = await pick({
      items,
      header: 'Select tmux session (↑/↓ to move, Enter to select, q to quit):',
    });
  } catch (err) {
    if (err.code === 'SIGINT') return 130;
    stderr.write(`panorama attach: ${err.message}\n`);
    return 2;
  }

  if (index === null) return 0;

  try {
    return tmux.attachOrSwitch(sessions[index].name);
  } catch (err) {
    stderr.write(`panorama attach: ${err.message}\n`);
    return 1;
  }
}
```

- [ ] **Step 4: パス確認**

Run: `node --test tests/attach.test.js`
Expected: PASS (9 tests)

- [ ] **Step 5: コミット**

```bash
git add src/commands/attach.js tests/attach.test.js
git commit -m "feat(cli): add 'panorama attach' subcommand with interactive picker"
```

---

### Task 9: bin/panorama ディスパッチャ統合

**Files:**
- Modify: `bin/panorama`

- [ ] **Step 1: 現状確認**

Run: `cat bin/panorama`

確認する既存構造: `parseArgs` → switch で `update` / `doctor` を分岐、`usage` で exit 2。

- [ ] **Step 2: 実装変更**

`bin/panorama` を以下に置き換える:

```js
#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { loadConfig } from '../src/lib/config.js';
import { runUpdate } from '../src/update.js';
import { runCreate } from '../src/commands/create.js';
import { runAttach } from '../src/commands/attach.js';

const __filename = fileURLToPath(import.meta.url);
const REPO_DIR = resolve(dirname(__filename), '..');

function defaultConfigPath() {
  return join(homedir(), '.config/panorama/config.yaml');
}

function cmdUpdate(args) {
  let configPath = defaultConfigPath();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--config') {
      configPath = args[++i];
    }
  }
  if (!existsSync(configPath)) {
    console.error(`panorama: config not found at ${configPath}`);
    process.exit(1);
  }
  const cfg = loadConfig(configPath);
  runUpdate(cfg);
}

function checkBin(name) {
  try {
    execFileSync('which', [name], { stdio: 'pipe' });
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

function usage() {
  console.error('Usage:');
  console.error('  panorama update [--config PATH]');
  console.error('  panorama doctor');
  console.error('  panorama create <session-name> [--task <name>]');
  console.error('  panorama attach [<session-name>]');
  process.exit(2);
}

const [subcommand, ...rest] = process.argv.slice(2);
switch (subcommand) {
  case 'update':
    cmdUpdate(rest);
    break;
  case 'doctor':
    cmdDoctor();
    break;
  case 'create': {
    const exit = await runCreate({ args: rest });
    process.exit(exit);
  }
  case 'attach': {
    const exit = await runAttach({ args: rest });
    process.exit(exit);
  }
  default:
    usage();
}
```

注: top-level await を使う (Node 14.8+ で ESM なら OK)。既存ファイルは ESM なので問題なし。

- [ ] **Step 3: 手動検証**

```bash
# usage 表示
./bin/panorama
# Expected: 4 サブコマンドが表示される

# doctor (既存機能が壊れていない)
./bin/panorama doctor
# Expected: node/git/tmux/jq/config/hooks/launchd/claude hooks の状態が表示

# create (usage)
./bin/panorama create
# Expected: "missing session name" + usage、exit 2

# create (実行)
./bin/panorama create panorama-cli-test
# tmux に attach される → Ctrl-b d でデタッチ
tmux list-sessions | grep panorama-cli-test
# Expected: panorama-cli-test が存在

# create (既存セッション)
./bin/panorama create panorama-cli-test
# Expected: "already exists" + exit 1

# attach (name)
./bin/panorama attach panorama-cli-test
# Expected: attach → デタッチ

# attach (picker)
./bin/panorama attach
# Expected: セッション一覧が alternate screen に表示、↑/↓で選択、Enterで attach、qでキャンセル

# クリーンアップ
tmux kill-session -t panorama-cli-test
```

- [ ] **Step 4: 全テスト実行**

Run: `npm test`
Expected: 既存テスト + 新規テスト全て PASS

- [ ] **Step 5: コミット**

```bash
git add bin/panorama
git commit -m "feat(cli): wire create/attach subcommands into dispatcher"
```

---

### Task 10: README 更新

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 現状確認**

Run: `grep -n "CLI コマンド" README.md`

既存「CLI コマンド」セクションに追記する箇所を特定。

- [ ] **Step 2: 実装変更**

`README.md` の「CLI コマンド」セクション (現状の `panorama update` / `panorama doctor` 記載部分) を以下に置き換え:

```markdown
### CLI コマンド

```bash
panorama update            # ダッシュボードを手動で更新
panorama update --config PATH  # 設定ファイルを指定して更新
panorama doctor            # インストール状態のチェック
panorama create <name>     # 新しい tmux セッションを作成して attach
panorama create <name> --task <task-name>  # ウィンドウ名を指定
panorama attach            # tmux セッション一覧から対話選択して attach
panorama attach <name>     # 指定セッションに直接 attach
```
```

注: 既存の code fence は 3 バックティック、README 内の位置を変えない。

- [ ] **Step 3: コミット**

```bash
git add README.md
git commit -m "docs: add panorama create/attach to CLI commands section"
```

---

## 自己レビュー

**1. Spec coverage:**
- `create` コマンド: Task 7 で実装、Task 9 で wire-up ✓
- `attach` (引数あり/なし): Task 8 で両パターン実装 ✓
- 対話ピッカー: Task 5-6 で実装 ✓
- エラーコード表 (spec の表と一致): Task 7/8 のテストで検証 ✓
- tmux 内外の attach 分岐: Task 4 で実装 ✓
- ファイル構成 (spec に記載): Task 1-10 でカバー ✓

**2. Placeholder scan:**
- すべてのステップに具体コードあり、TBD/TODO なし ✓

**3. Type consistency:**
- `tmux` 引数の関数名: `isTmuxAvailable` / `hasSession` / `listSessions` / `createSession` / `renameWindow` / `attachOrSwitch` で全タスク統一 ✓
- `pick({ items, header, initialIndex, stdin, stdout })` で統一 ✓
- `runCreate({ args, tmux, cwd, stderr })` / `runAttach({ args, tmux, pick, stderr })` で統一 ✓
- exit code: 0 (success) / 1 (runtime error) / 2 (usage error) / 130 (SIGINT) で統一 ✓
