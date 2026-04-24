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
