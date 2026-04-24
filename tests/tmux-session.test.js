import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isInsideTmux, parseSessionsOutput } from '../src/lib/tmux-session.js';

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
