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

test('runCreate: returns 2 when session name is empty string', async () => {
  const tmux = makeFakeTmux();
  const messages = [];
  const exit = await runCreate({
    args: [''],
    tmux,
    cwd: '/tmp',
    stderr: { write: (s) => messages.push(s) },
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
