import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpretKey, clampIndex, pick } from '../src/lib/picker.js';

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
