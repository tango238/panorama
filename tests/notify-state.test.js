import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const HOOK = resolve('hooks/notify-state.sh');

function runHook(state, stdinJson, homeDir) {
  const env = { ...process.env, HOME: homeDir };
  return spawnSync('bash', [HOOK, state], {
    input: stdinJson,
    env,
    encoding: 'utf8',
  });
}

function readStateFiles(homeDir) {
  const dir = join(homeDir, '.config/panorama/states');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith('.json') && !f.startsWith('.'))
    .map(f => JSON.parse(readFileSync(join(dir, f), 'utf8')));
}

test('notify-state: writes state file with session_id from stdin', () => {
  const home = mkdtempSync(join(tmpdir(), 'panorama-hook-'));
  const stdin = JSON.stringify({
    session_id: 'abc-123-def',
    cwd: '/Users/test/repo',
    hook_event_name: 'PreToolUse',
  });
  const r = runHook('active', stdin, home);
  assert.equal(r.status, 0, `exit nonzero: ${r.stderr}`);

  const files = readStateFiles(home);
  assert.equal(files.length, 1);
  assert.equal(files[0].state, 'active');
  assert.equal(files[0].session_id, 'abc-123-def');
  assert.equal(files[0].cwd, '/Users/test/repo');
  assert.ok(typeof files[0].timestamp === 'number');
});

test('notify-state: writes waiting state', () => {
  const home = mkdtempSync(join(tmpdir(), 'panorama-hook-'));
  const stdin = JSON.stringify({ session_id: 'x1-y2', cwd: '/p' });
  const r = runHook('waiting', stdin, home);
  assert.equal(r.status, 0);
  const files = readStateFiles(home);
  assert.equal(files[0].state, 'waiting');
});

test('notify-state: no session_id means no write (fail-open)', () => {
  const home = mkdtempSync(join(tmpdir(), 'panorama-hook-'));
  const stdin = JSON.stringify({ cwd: '/p' });
  const r = runHook('active', stdin, home);
  assert.equal(r.status, 0);
  assert.equal(readStateFiles(home).length, 0);
});

test('notify-state: empty stdin means no write (fail-open)', () => {
  const home = mkdtempSync(join(tmpdir(), 'panorama-hook-'));
  const r = runHook('active', '', home);
  assert.equal(r.status, 0);
  assert.equal(readStateFiles(home).length, 0);
});

test('notify-state: unsafe session_id rejected', () => {
  const home = mkdtempSync(join(tmpdir(), 'panorama-hook-'));
  const stdin = JSON.stringify({ session_id: '../evil', cwd: '/p' });
  const r = runHook('active', stdin, home);
  assert.equal(r.status, 0);
  assert.equal(readStateFiles(home).length, 0);
});

test('notify-state: unknown state argument rejected', () => {
  const home = mkdtempSync(join(tmpdir(), 'panorama-hook-'));
  const stdin = JSON.stringify({ session_id: 'abc', cwd: '/p' });
  const r = runHook('bogus', stdin, home);
  assert.equal(r.status, 0);
  assert.equal(readStateFiles(home).length, 0);
});

test('notify-state: special chars in cwd escaped properly', () => {
  const home = mkdtempSync(join(tmpdir(), 'panorama-hook-'));
  const cwd = '/Users/test/has "quote" and \\back';
  const stdin = JSON.stringify({ session_id: 'abc', cwd });
  const r = runHook('active', stdin, home);
  assert.equal(r.status, 0);
  const files = readStateFiles(home);
  assert.equal(files[0].cwd, cwd);
});

test('notify-state: atomic write via mv (no temp file leftover)', () => {
  const home = mkdtempSync(join(tmpdir(), 'panorama-hook-'));
  const stdin = JSON.stringify({ session_id: 'abc', cwd: '/p' });
  runHook('active', stdin, home);
  const dir = join(home, '.config/panorama/states');
  const tmps = readdirSync(dir).filter(f => f.startsWith('.tmp-'));
  assert.equal(tmps.length, 0, 'temp file leaked');
});
