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
