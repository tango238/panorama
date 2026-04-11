import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { getBranch, getLastCommit } from '../src/lib/git.js';

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'panorama-git-'));
  const run = (cmd, args) => execFileSync(cmd, args, { cwd: dir, stdio: 'pipe' });
  run('git', ['init', '-q', '-b', 'main']);
  run('git', ['config', 'user.email', 'test@example.com']);
  run('git', ['config', 'user.name', 'Test']);
  run('git', ['config', 'commit.gpgsign', 'false']);
  writeFileSync(join(dir, 'a.txt'), 'hello');
  run('git', ['add', 'a.txt']);
  run('git', ['commit', '-q', '-m', 'first commit']);
  return dir;
}

test('getBranch: returns current branch', () => {
  const dir = makeRepo();
  assert.equal(getBranch(dir), 'main');
});

test('getLastCommit: returns "<relative> · <subject>"', () => {
  const dir = makeRepo();
  const result = getLastCommit(dir);
  assert.match(result, / · first commit$/);
  assert.match(result, /ago|second|minute|hour|now/);
});

test('getBranch: returns null for non-git dir', () => {
  const dir = mkdtempSync(join(tmpdir(), 'panorama-nogit-'));
  assert.equal(getBranch(dir), null);
});

test('getLastCommit: returns null for non-git dir', () => {
  const dir = mkdtempSync(join(tmpdir(), 'panorama-nogit-'));
  assert.equal(getLastCommit(dir), null);
});
