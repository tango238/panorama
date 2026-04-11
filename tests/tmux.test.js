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
