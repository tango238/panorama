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
