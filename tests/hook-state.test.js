import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadAllHookStates } from '../src/lib/tmux.js';

function makeStateDir() {
  const home = mkdtempSync(join(tmpdir(), 'panorama-states-'));
  const dir = join(home, '.config/panorama/states');
  mkdirSync(dir, { recursive: true });
  return { home, dir };
}

function writeState(dir, sessionId, body) {
  writeFileSync(join(dir, `${sessionId}.json`), JSON.stringify(body));
}

describe('loadAllHookStates', () => {
  it('returns empty indices when state dir missing', () => {
    const home = mkdtempSync(join(tmpdir(), 'panorama-empty-'));
    const { bySession, byCwd } = loadAllHookStates(home);
    assert.equal(bySession.size, 0);
    assert.equal(byCwd.size, 0);
  });

  it('loads a single state file into bySession', () => {
    const { home, dir } = makeStateDir();
    writeState(dir, 'sess-1', { state: 'active', timestamp: 100, session_id: 'sess-1', cwd: '/a' });
    const { bySession } = loadAllHookStates(home);
    assert.equal(bySession.size, 1);
    assert.equal(bySession.get('sess-1').state, 'active');
  });

  it('loads multiple into bySession, and byCwd has arrays sorted by timestamp desc', () => {
    const { home, dir } = makeStateDir();
    writeState(dir, 'sess-a', { state: 'active', timestamp: 100, session_id: 'sess-a', cwd: '/shared' });
    writeState(dir, 'sess-b', { state: 'waiting', timestamp: 200, session_id: 'sess-b', cwd: '/shared' });
    writeState(dir, 'sess-c', { state: 'active', timestamp: 150, session_id: 'sess-c', cwd: '/other' });
    const { bySession, byCwd } = loadAllHookStates(home);
    assert.equal(bySession.size, 3);

    const shared = byCwd.get('/shared');
    assert.equal(shared.length, 2);
    assert.equal(shared[0].timestamp, 200);
    assert.equal(shared[1].timestamp, 100);

    const other = byCwd.get('/other');
    assert.equal(other.length, 1);
  });

  it('skips malformed JSON files', () => {
    const { home, dir } = makeStateDir();
    writeFileSync(join(dir, 'broken.json'), 'not json');
    writeState(dir, 'good', { state: 'active', timestamp: 100, session_id: 'good', cwd: '/x' });
    const { bySession } = loadAllHookStates(home);
    assert.equal(bySession.size, 1);
    assert.equal(bySession.has('good'), true);
  });

  it('skips hidden temp files', () => {
    const { home, dir } = makeStateDir();
    writeFileSync(join(dir, '.tmp-xyz'), 'partial');
    writeState(dir, 'real', { state: 'active', timestamp: 100, session_id: 'real', cwd: '/x' });
    const { bySession } = loadAllHookStates(home);
    assert.equal(bySession.size, 1);
  });

  it('skips state entries without session_id field', () => {
    const { home, dir } = makeStateDir();
    writeFileSync(join(dir, 'nosess.json'), JSON.stringify({ state: 'active', timestamp: 1, cwd: '/x' }));
    const { bySession } = loadAllHookStates(home);
    assert.equal(bySession.size, 0);
  });
});
