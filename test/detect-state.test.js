import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectClaudeCodeState } from '../src/lib/tmux.js';

function nowEpoch() {
  return Math.floor(Date.now() / 1000);
}

// 既定 staleThreshold は 3600s (1h)
describe('detectClaudeCodeState', () => {
  it('returns null when hookState is null', () => {
    assert.equal(detectClaudeCodeState(null), null);
  });

  it('returns state="active" verbatim when fresh', () => {
    const hookState = { state: 'active', timestamp: nowEpoch() };
    assert.equal(detectClaudeCodeState(hookState), 'active');
  });

  it('returns state="waiting" verbatim when fresh', () => {
    const hookState = { state: 'waiting', timestamp: nowEpoch() };
    assert.equal(detectClaudeCodeState(hookState), 'waiting');
  });

  it('returns null when timestamp is older than staleThreshold (1h default)', () => {
    const hookState = { state: 'active', timestamp: nowEpoch() - 3601 };
    assert.equal(detectClaudeCodeState(hookState), null);
  });

  it('returns null for stale waiting state too', () => {
    const hookState = { state: 'waiting', timestamp: nowEpoch() - 3601 };
    assert.equal(detectClaudeCodeState(hookState), null);
  });

  it('respects custom staleThreshold', () => {
    const hookState = { state: 'active', timestamp: nowEpoch() - 61 };
    assert.equal(detectClaudeCodeState(hookState, 60), null);
    assert.equal(detectClaudeCodeState(hookState, 120), 'active');
  });

  it('rejects unknown state as null', () => {
    const hookState = { state: 'bogus', timestamp: nowEpoch() };
    assert.equal(detectClaudeCodeState(hookState), null);
  });

  it('rejects missing timestamp as null', () => {
    const hookState = { state: 'active' };
    assert.equal(detectClaudeCodeState(hookState), null);
  });

  it('rejects non-number timestamp as null', () => {
    const hookState = { state: 'active', timestamp: 'now' };
    assert.equal(detectClaudeCodeState(hookState), null);
  });

  it('rejects undefined state as null', () => {
    const hookState = { timestamp: nowEpoch() };
    assert.equal(detectClaudeCodeState(hookState), null);
  });
});
