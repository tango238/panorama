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

// Default IO that skips dashboard registration (config not present)
function makeNoopIO() {
  return {
    existsSync: () => false,
    readFile: () => '',
    writeFile: () => {},
    loadConfig: () => ({}),
  };
}

function makeIOFromState(state) {
  const files = new Map(Object.entries(state.files || {}));
  return {
    writes: [],
    existsSync: (p) => files.has(p),
    readFile: (p) => {
      if (!files.has(p)) throw new Error(`ENOENT: ${p}`);
      return files.get(p);
    },
    writeFile(p, t) {
      this.writes.push([p, t]);
      files.set(p, t);
    },
    loadConfig: (p) => state.config,
  };
}

test('runCreate: returns 2 when no session name', async () => {
  const tmux = makeFakeTmux();
  const exit = await runCreate({
    args: [],
    tmux,
    cwd: '/tmp',
    stderr: { write: () => {} },
    io: makeNoopIO(),
  });
  assert.equal(exit, 2);
});

test('runCreate: returns 2 when session name is empty string', async () => {
  const tmux = makeFakeTmux();
  const messages = [];
  const exit = await runCreate({
    args: [''],
    tmux,
    cwd: '/tmp',
    stderr: { write: (s) => messages.push(s) },
    io: makeNoopIO(),
  });
  assert.equal(exit, 2);
  assert.match(messages.join(''), /missing session name/);
  assert.deepEqual(tmux.calls, []);
});

test('runCreate: returns 1 when tmux not available', async () => {
  const tmux = makeFakeTmux({ isTmuxAvailable: () => false });
  const messages = [];
  const exit = await runCreate({
    args: ['foo'],
    tmux,
    cwd: '/tmp',
    stderr: { write: (s) => messages.push(s) },
    io: makeNoopIO(),
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
    io: makeNoopIO(),
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
    io: makeNoopIO(),
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
    io: makeNoopIO(),
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
    io: makeNoopIO(),
  });
  assert.equal(exit, 2);
});

test('runCreate: inserts dashboard card into 🟢 when config + dashboard exist', async () => {
  const dashboardText = [
    '## 🟢 対応中',
    '',
    '## 🟡 入力待ち',
    '',
    '## 🔴 ブロック中',
    '',
    '## ✅ 完了',
    '',
  ].join('\n');
  const io = makeIOFromState({
    config: { vault_path: '/vault', dashboard_file: 'Dashboard.md' },
    files: {
      '/cfg.yaml': '(config stub)',
      '/vault/Dashboard.md': dashboardText,
    },
  });
  const tmux = makeFakeTmux();
  const stdout = { writes: [], write(s) { this.writes.push(s); } };

  const exit = await runCreate({
    args: ['foo', '--task', 'verify'],
    tmux,
    cwd: '/workspace/panorama',
    stderr: { write: () => {} },
    stdout,
    pcName: 'TestMac',
    configPath: '/cfg.yaml',
    io,
  });

  assert.equal(exit, 0);
  assert.equal(io.writes.length, 1);
  const [writtenPath, writtenText] = io.writes[0];
  assert.equal(writtenPath, '/vault/Dashboard.md');
  assert.match(writtenText, /- \[ \] \*\*panorama \/ verify\*\*/);
  assert.match(writtenText, /\*\*path:\*\* \/workspace\/panorama/);
  assert.match(writtenText, /\*\*pc:\*\* TestMac/);
  assert.match(writtenText, /\*\*tmux:\*\* foo/);
  assert.ok(stdout.writes.join('').includes('/vault/Dashboard.md'));
  // tmux session created before dashboard write
  assert.deepEqual(tmux.calls[0], ['createSession', 'foo', '/workspace/panorama']);
});

test('runCreate: --no-register skips dashboard write', async () => {
  const io = makeIOFromState({
    config: { vault_path: '/vault', dashboard_file: 'Dashboard.md' },
    files: {
      '/cfg.yaml': '(config stub)',
      '/vault/Dashboard.md': '## 🟢 対応中\n\n',
    },
  });
  const tmux = makeFakeTmux();
  const exit = await runCreate({
    args: ['foo', '--no-register'],
    tmux,
    cwd: '/workspace/panorama',
    stderr: { write: () => {} },
    configPath: '/cfg.yaml',
    io,
  });
  assert.equal(exit, 0);
  assert.equal(io.writes.length, 0);
});

test('runCreate: errors and does not create tmux session when duplicate path card exists', async () => {
  const dashboardText = [
    '## 🟢 対応中',
    '',
    '- [ ] **panorama / existing**',
    '\t- **path:** /workspace/panorama',
    '',
    '## 🟡 入力待ち',
  ].join('\n');
  const io = makeIOFromState({
    config: { vault_path: '/vault', dashboard_file: 'Dashboard.md' },
    files: {
      '/cfg.yaml': '(config stub)',
      '/vault/Dashboard.md': dashboardText,
    },
  });
  const tmux = makeFakeTmux();
  const messages = [];
  const exit = await runCreate({
    args: ['foo'],
    tmux,
    cwd: '/workspace/panorama',
    stderr: { write: (s) => messages.push(s) },
    pcName: 'TestMac',
    configPath: '/cfg.yaml',
    io,
  });
  assert.equal(exit, 1);
  assert.match(messages.join(''), /already exists/);
  assert.deepEqual(tmux.calls, []);
  assert.equal(io.writes.length, 0);
});

test('runCreate: skips dashboard registration with warning when config missing', async () => {
  const io = makeIOFromState({
    config: {},
    files: {}, // no config file
  });
  const tmux = makeFakeTmux();
  const messages = [];
  const exit = await runCreate({
    args: ['foo'],
    tmux,
    cwd: '/workspace/panorama',
    stderr: { write: (s) => messages.push(s) },
    pcName: 'TestMac',
    configPath: '/cfg.yaml',
    io,
  });
  assert.equal(exit, 0);
  assert.match(messages.join(''), /skipping dashboard registration/);
  assert.equal(io.writes.length, 0);
  // tmux session still created
  assert.deepEqual(tmux.calls[0], ['createSession', 'foo', '/workspace/panorama']);
});

test('runCreate: skips dashboard registration with warning when dashboard missing', async () => {
  const io = makeIOFromState({
    config: { vault_path: '/vault', dashboard_file: 'Dashboard.md' },
    files: {
      '/cfg.yaml': '(config stub)',
      // Dashboard.md missing
    },
  });
  const tmux = makeFakeTmux();
  const messages = [];
  const exit = await runCreate({
    args: ['foo'],
    tmux,
    cwd: '/workspace/panorama',
    stderr: { write: (s) => messages.push(s) },
    pcName: 'TestMac',
    configPath: '/cfg.yaml',
    io,
  });
  assert.equal(exit, 0);
  assert.match(messages.join(''), /skipping dashboard registration/);
  assert.equal(io.writes.length, 0);
  assert.deepEqual(tmux.calls[0], ['createSession', 'foo', '/workspace/panorama']);
});

test('runCreate: skips dashboard registration with warning when loadConfig throws (malformed YAML)', async () => {
  const io = {
    existsSync: () => true,
    readFile: () => '## 🟢 対応中\n\n',
    writeFile: () => { throw new Error('should not be called'); },
    loadConfig: () => { throw new Error('unexpected token'); },
  };
  const tmux = makeFakeTmux();
  const messages = [];
  const exit = await runCreate({
    args: ['foo'],
    tmux,
    cwd: '/workspace/panorama',
    stderr: { write: (s) => messages.push(s) },
    pcName: 'TestMac',
    configPath: '/cfg.yaml',
    io,
  });
  assert.equal(exit, 0);
  assert.match(messages.join(''), /dashboard read failed: unexpected token/);
  // tmux session still created despite config crash
  assert.deepEqual(tmux.calls[0], ['createSession', 'foo', '/workspace/panorama']);
});

test('runCreate: skips dashboard registration with warning when readFile throws (EACCES)', async () => {
  const io = {
    existsSync: () => true,
    readFile: () => { throw new Error('EACCES: permission denied'); },
    writeFile: () => { throw new Error('should not be called'); },
    loadConfig: () => ({ vault_path: '/vault', dashboard_file: 'Dashboard.md' }),
  };
  const tmux = makeFakeTmux();
  const messages = [];
  const exit = await runCreate({
    args: ['foo'],
    tmux,
    cwd: '/workspace/panorama',
    stderr: { write: (s) => messages.push(s) },
    pcName: 'TestMac',
    configPath: '/cfg.yaml',
    io,
  });
  assert.equal(exit, 0);
  assert.match(messages.join(''), /dashboard read failed: EACCES/);
  assert.deepEqual(tmux.calls[0], ['createSession', 'foo', '/workspace/panorama']);
});

test('runCreate: --no-register is accepted as argument', async () => {
  const tmux = makeFakeTmux();
  const exit = await runCreate({
    args: ['foo', '--task', 'T', '--no-register'],
    tmux,
    cwd: '/tmp',
    stderr: { write: () => {} },
    io: makeNoopIO(),
  });
  assert.equal(exit, 0);
  assert.deepEqual(tmux.calls, [
    ['createSession', 'foo', '/tmp'],
    ['renameWindow', 'foo', 'T'],
    ['attachOrSwitch', 'foo'],
  ]);
});
